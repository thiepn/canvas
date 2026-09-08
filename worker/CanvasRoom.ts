import { DurableObject } from 'cloudflare:workers'
import { DurableObjectSqliteSyncWrapper, SQLiteSyncStorage, TLSocketRoom, type SessionStateSnapshot, type RoomSnapshot, type TLSyncForwardDiff } from '@tldraw/sync-core'
import { createTLSchema, type TLRecord } from '@tldraw/tlschema'
import type { CanvasEnv } from './env.ts'
import { ENGINE_VERSION, LIMITS } from '../shared/limits.ts'
import { byteLength, isSafeJson } from '../shared/json.ts'
import { validateCanvasRecord } from '../shared/document-policy.ts'
import { parseBackup, wrapBackup, type BackupEnvelope } from '../shared/backup.ts'
import { WorldBudget } from './security/world-budget.ts'
import { beforeChangeSnapshot } from '../shared/recovery.ts'
import { BackupStore } from './storage/BackupStore.ts'
import { checkFrame, EMPTY_FRAME_STATE, type FrameState } from './security/frame-guard.ts'
import { consumeRate, newRateState, type RateState } from './security/rate-limit.ts'
import { readLimitedBody } from './security/admin.ts'

const schema = createTLSchema()
interface StoredAttachment { schemaVersion?: string; sessionId: string; snapshot: (Omit<SessionStateSnapshot, 'serializedSchema'> & { serializedSchema?: SessionStateSnapshot['serializedSchema'] }) | null; rate: RateState; frame: FrameState }
interface Attachment { sessionId: string; snapshot: SessionStateSnapshot | null; rate: RateState; frame: FrameState }
function attachmentOf(ws: WebSocket): Attachment | null {
  const value: unknown = ws.deserializeAttachment()
  if (!value || typeof value !== 'object' || !('sessionId' in value) || typeof value.sessionId !== 'string') return null
  const stored = value as StoredAttachment
  return { ...stored, snapshot: stored.snapshot && (stored.snapshot.serializedSchema || stored.schemaVersion === ENGINE_VERSION) ? { ...stored.snapshot, serializedSchema: stored.snapshot.serializedSchema ?? schema.serialize() } : null }
}
function minimalSocket(ws: WebSocket) {
  // Do NOT hand addEventListener to TLSocketRoom: hibernation dispatches through DO methods.
  return { get readyState() { return ws.readyState }, send: (message: string) => ws.send(message), close: (code?: number, reason?: string) => ws.close(code, reason) }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value)
}

export class CanvasRoom extends DurableObject<CanvasEnv> {
  private room: TLSocketRoom<TLRecord, void> | null = null
  private readonly sockets = new Map<string, WebSocket>()
  private readonly budget = new WorldBudget()
  private readonly shapeIds = new Set<string>()
  private readonly pendingCreates = new Set<string>()
  private readonly pendingBefore = new Map<string, TLRecord>()
  private lastDeleteBackup = 0
  private readonly backups: BackupStore
  private schedulingBackup: Promise<void> | null = null

  constructor(ctx: DurableObjectState, env: CanvasEnv) {
    super(ctx, env)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'))
    this.backups = new BackupStore((query, ...args) => ctx.storage.sql.exec(query, ...args).toArray(), body => ctx.storage.transactionSync(body))
    this.lastDeleteBackup = this.backups.list().find(item => item.kind === 'before-delete')?.createdAt ?? 0
  }

  private getRoom(): TLSocketRoom<TLRecord, void> {
    if (this.room) return this.room
    const storage = new SQLiteSyncStorage<TLRecord>({ sql: new DurableObjectSqliteSyncWrapper(this.ctx.storage) })
    const room = new TLSocketRoom<TLRecord, void>({
      schema,
      storage,
      clientTimeout: Infinity,
      log: { warn: () => console.warn('canvas.sync.warning'), error: () => console.error('canvas.sync.error') },
      authorizeRecord: {
        asset: () => null,
        user: () => null,
        page: args => { if (args.prev) this.pendingBefore.set(args.prev.id, args.prev); return args.type !== 'delete' ? this.permitRecord(args.next) : null },
        document: args => { if (args.prev) this.pendingBefore.set(args.prev.id, args.prev); return args.type !== 'delete' ? this.permitRecord(args.next) : null },
        binding: args => { if (args.prev) this.pendingBefore.set(args.prev.id, args.prev); return args.type === 'delete' ? this.permitDeletion(args.prev) : this.permitRecord(args.next) },
        shape: args => {
          if (args.prev) this.pendingBefore.set(args.prev.id, args.prev)
          if (args.type === 'delete') return this.permitDeletion(args.prev)
          const isNew = args.type === 'create' && !this.shapeIds.has(args.next.id) && !this.pendingCreates.has(args.next.id)
          if (isNew && this.shapeIds.size + this.pendingCreates.size >= LIMITS.shapes) return null
          const permitted = this.permitRecord(args.next)
          if (permitted && isNew) this.pendingCreates.add(args.next.id)
          return permitted
        },
      },
      onAfterReceiveMessage: ({ stringified }) => {
        const message: unknown = JSON.parse(stringified)
        if (byteLength(stringified) > LIMITS.messageBytes || !isSafeJson(message)) throw new Error('Invalid sync payload.')
        this.pendingCreates.clear()
        this.pendingBefore.clear()
        this.budget.begin()
      },
      onCommittedChanges: ({ diff }) => {
        this.backupBeforeDeletion(diff)
        this.budget.commit(Object.values(diff.puts).map(put => Array.isArray(put) ? put[1] : put), diff.deletes)
        for (const id of diff.deletes) this.shapeIds.delete(id)
        for (const put of Object.values(diff.puts)) {
          const record = Array.isArray(put) ? put[1] : put
          if (record.typeName === 'shape') this.shapeIds.add(record.id)
        }
        this.pendingCreates.clear()
        this.pendingBefore.clear()
        this.scheduleBackup()
      },
      onSessionSnapshot: (sessionId, snapshot) => {
        const ws = this.sockets.get(sessionId), attachment = ws && attachmentOf(ws)
        if (ws && attachment) this.saveAttachment(ws, { ...attachment, snapshot })
      },
    })
    this.room = room
    const initialSnapshot = room.getCurrentSnapshot()
    this.budget.initialize(initialSnapshot.documents.map(item => item.state))
    for (const item of initialSnapshot.documents) if (item.state.typeName === 'shape') this.shapeIds.add(item.state.id)
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = attachmentOf(ws)
      if (!attachment) { ws.close(1012, 'Reconnect required.'); continue }
      this.sockets.set(attachment.sessionId, ws)
      if (attachment.snapshot && attachment.frame.remaining === null) {
        room.handleSocketResume({ sessionId: attachment.sessionId, socket: minimalSocket(ws), snapshot: attachment.snapshot })
      } else {
        // No committed document state is lost. The official client reconnects/rebases pending edits.
        ws.close(1012, 'Resuming the shared canvas.')
      }
    }
    return room
  }

  private saveAttachment(ws: WebSocket, attachment: Attachment): void {
    // Cloudflare attachments are limited. Fall back to a clean reconnect rather than crashing.
    const compact: StoredAttachment = { ...attachment, schemaVersion: ENGINE_VERSION }
    if (attachment.snapshot && canonical(attachment.snapshot.serializedSchema) === canonical(schema.serialize())) {
      const { serializedSchema: _schema, ...rest } = attachment.snapshot
      void _schema
      compact.snapshot = rest
    }
    const safe = byteLength(JSON.stringify(compact)) <= 2000 ? compact : { ...compact, snapshot: null }
    ws.serializeAttachment(safe)
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const room = this.getRoom()
    if (url.pathname === '/api/connect/main') {
      const sessionId = url.searchParams.get('sessionId')
      if (!sessionId || !/^[A-Za-z0-9_:-]{1,160}$/.test(sessionId)) return new Response('Invalid session ID.', { status: 400 })
      if (this.ctx.getWebSockets().filter(ws => ws.readyState === WebSocket.OPEN).length >= LIMITS.connections) return new Response('Canvas has reached its connection limit.', { status: 503 })
      const existing = this.sockets.get(sessionId)
      if (existing && existing.readyState === WebSocket.OPEN) return new Response('Session is already connected.', { status: 409 })
      const { 0: client, 1: server } = new WebSocketPair()
      this.ctx.acceptWebSocket(server)
      this.saveAttachment(server, { sessionId, snapshot: null, rate: newRateState(Date.now()), frame: { ...EMPTY_FRAME_STATE } })
      this.sockets.set(sessionId, server)
      room.handleSocketConnect({ sessionId, socket: minimalSocket(server) })
      return new Response(null, { status: 101, webSocket: client })
    }
    if (url.pathname === '/api/snapshot' && request.method === 'GET') return Response.json(this.exportSnapshot())
    if (url.pathname === '/api/admin/snapshots') {
      if (request.method === 'GET') return Response.json({ backups: this.backups.list(), clock: room.storage.getClock() })
      if (request.method === 'POST') return Response.json(await this.backups.create(this.exportSnapshot(), 'manual'), { status: 201 })
    }
    const backupMatch = /^\/api\/admin\/snapshots\/([0-9a-f-]{36})$/.exec(url.pathname)
    if (backupMatch && request.method === 'GET') {
      const backup = await this.backups.get(backupMatch[1]!)
      return backup ? Response.json(backup) : new Response('Backup not found.', { status: 404 })
    }
    if (url.pathname === '/api/admin/restore' && request.method === 'POST') {
      if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') return new Response('JSON is required.', { status: 415 })
      try {
        const candidate = parseBackup(await readLimitedBody(request, LIMITS.backupBytes))
        if (canonical(candidate.snapshot.schema) !== canonical(schema.serialize())) throw new Error('Snapshot schema differs from the deployed schema. Migrate a copy before restoring.')
        for (const { state } of candidate.snapshot.documents) {
          switch (state.typeName) {
            case 'shape': schema.types.shape.validate(state); break
            case 'binding': schema.types.binding.validate(state); break
            case 'page': schema.types.page.validate(state); break
            case 'document': schema.types.document.validate(state); break
            default: throw new Error('Unsupported record.')
          }
        }
        // Quiescent maintenance avoids a stale offline client reapplying edits over a restoration.
        if (this.ctx.getWebSockets().some(ws => ws.readyState === WebSocket.OPEN)) return new Response('Close all Canvas tabs before restoring. No data was changed.', { status: 409 })
        const expected = request.headers.get('If-Match')
        if (expected !== String(room.storage.getClock())) return new Response('World changed. Refresh the clock and review the restore again.', { status: 409 })
        await this.ctx.blockConcurrencyWhile(async () => {
          await this.backups.create(this.exportSnapshot(), 'before-restore')
          // Drop imported clocks/tombstones. loadSnapshot applies records transactionally at a new server clock.
          room.loadSnapshot({ schema: schema.serialize(), documents: candidate.snapshot.documents.map(item => ({ state: item.state, lastChangedClock: 0 })) } as unknown as RoomSnapshot)
          this.budget.initialize(candidate.snapshot.documents.map(item => item.state as unknown as { id: string }))
          this.shapeIds.clear()
          for (const item of candidate.snapshot.documents) if (item.state.typeName === 'shape') this.shapeIds.add(String(item.state.id))
        })
        return Response.json({ restored: true, clock: room.storage.getClock() })
      } catch (error) {
        return new Response(error instanceof Error ? error.message : 'Restore failed.', { status: 400 })
      }
    }
    return new Response('Not found.', { status: 404 })
  }

  private permitRecord<R extends TLRecord>(record: R): R | null {
    return validateCanvasRecord(record) && this.budget.propose(record.id, record) ? record : null
  }
  private permitDeletion<R extends TLRecord>(record: R): R {
    this.budget.propose(record.id, null)
    return record
  }

  private exportSnapshot(): BackupEnvelope {
    const snapshot = this.getRoom().getCurrentSnapshot()
    return wrapBackup(snapshot as unknown as BackupEnvelope['snapshot'])
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const attachment = attachmentOf(ws)
    if (!attachment) { ws.close(1008, 'Invalid session.'); return }
    const room = this.getRoom()
    if (ws.readyState !== WebSocket.OPEN) return
    try {
      const now = Date.now()
      const frame = checkFrame(attachment.frame, message, now)
      const rate = consumeRate(attachment.rate, typeof message === 'string' ? byteLength(message) : message.byteLength, now)
      if (!rate) throw new Error('Canvas message rate exceeded.')
      this.saveAttachment(ws, { ...attachment, frame, rate })
      room.handleSocketMessage(attachment.sessionId, message)
    } catch {
      console.warn('canvas.message.rejected')
      ws.close(1008, 'Message violates Canvas limits.')
      room.handleSocketError(attachment.sessionId)
    }
  }
  override webSocketClose(ws: WebSocket): void { this.endSocket(ws, false) }
  override webSocketError(ws: WebSocket): void { this.endSocket(ws, true) }
  private endSocket(ws: WebSocket, error: boolean): void {
    const attachment = attachmentOf(ws)
    if (!attachment) return
    const room = this.getRoom()
    const replacement = this.sockets.get(attachment.sessionId)
    if (replacement && replacement !== ws) return
    if (attachment.snapshot && !room.getSessionSnapshot(attachment.sessionId)) room.handleSocketResume({ sessionId: attachment.sessionId, socket: minimalSocket(ws), snapshot: attachment.snapshot })
    if (error) room.handleSocketError(attachment.sessionId)
    else room.handleSocketClose(attachment.sessionId)
    if (this.sockets.get(attachment.sessionId) === ws) this.sockets.delete(attachment.sessionId)
    if (this.ctx.getWebSockets().filter(socket => socket !== ws && socket.readyState === WebSocket.OPEN).length === 0) this.ctx.waitUntil(this.ctx.storage.setAlarm(Date.now() + 1000))
  }

  private backupBeforeDeletion(diff: TLSyncForwardDiff<TLRecord>): void {
    const now = Date.now()
    if (now - this.lastDeleteBackup < 60_000 || !diff.deletes.some(id => this.pendingBefore.get(id)?.typeName === 'shape')) return
    try {
      const current = this.exportSnapshot()
      const previous = this.pendingBefore as unknown as ReadonlyMap<string, Record<string, unknown>>
      const snapshot = beforeChangeSnapshot(current.snapshot, [...Object.keys(diff.puts), ...diff.deletes], previous)
      this.lastDeleteBackup = now
      this.ctx.waitUntil(this.backups.create(wrapBackup(snapshot), 'before-delete', now).then(() => undefined).catch(() => console.error('canvas.backup.before-delete.failed')))
    } catch { console.error('canvas.backup.before-delete.failed') }
  }

  private scheduleBackup(): void {
    if (this.schedulingBackup) return
    this.schedulingBackup = (async () => {
      if (await this.ctx.storage.getAlarm() === null) {
        const at = Math.max(Date.now() + 60_000, this.backups.lastAutomaticTime() + 15 * 60_000)
        await this.ctx.storage.setAlarm(at)
      }
    })().catch(() => console.error('canvas.backup.schedule.failed')).finally(() => { this.schedulingBackup = null })
    this.ctx.waitUntil(this.schedulingBackup)
  }
  override async alarm(): Promise<void> {
    try {
      await this.backups.create(this.exportSnapshot(), 'automatic')
      await this.ctx.storage.delete('canvas.backup.retries')
    } catch {
      console.error('canvas.backup.failed')
      const retries = (await this.ctx.storage.get<number>('canvas.backup.retries') ?? 0) + 1
      await this.ctx.storage.put('canvas.backup.retries', retries)
      if (retries <= 3) await this.ctx.storage.setAlarm(Date.now() + retries * 60_000)
    }
  }
}
