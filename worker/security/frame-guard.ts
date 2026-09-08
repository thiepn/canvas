import { LIMITS } from '../../shared/limits.ts'
import { byteLength } from '../../shared/json.ts'
export interface FrameState { remaining: number | null; bytes: number; startedAt: number }
export const EMPTY_FRAME_STATE: FrameState = { remaining: null, bytes: 0, startedAt: 0 }
/** Size/order envelope only. Official tldraw still owns JSON assembly and the sync protocol. */
export function checkFrame(previous: FrameState, message: string | ArrayBuffer, now: number): FrameState {
  if (typeof message !== 'string') throw new Error('Binary messages are not supported.')
  const size = byteLength(message)
  if (size > LIMITS.frameBytes) throw new Error('WebSocket frame is too large.')
  if (previous.remaining !== null && now - previous.startedAt > 15_000) throw new Error('Incomplete message expired.')
  if (message.startsWith('{')) {
    if (previous.remaining !== null) throw new Error('Unexpected unchunked message.')
    return { ...EMPTY_FRAME_STATE }
  }
  const separator = message.indexOf('_')
  if (separator < 1 || separator > 3 || !/^\d+$/.test(message.slice(0, separator))) throw new Error('Malformed message frame.')
  const remaining = Number(message.slice(0, separator))
  if (remaining > 127 || (previous.remaining !== null && remaining !== previous.remaining - 1)) throw new Error('Invalid chunk sequence.')
  const total = previous.bytes + size
  if (total > LIMITS.messageBytes) throw new Error('Assembled message is too large.')
  return remaining === 0 ? { ...EMPTY_FRAME_STATE } : { remaining, bytes: total, startedAt: previous.remaining === null ? now : previous.startedAt }
}
