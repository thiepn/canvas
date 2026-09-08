import { LIMITS } from '../../shared/limits.ts'
export interface RateState { at: number; messages: number; bytes: number }
export function newRateState(now: number): RateState { return { at: now, messages: LIMITS.messageBurst, bytes: LIMITS.byteBurst } }
export function consumeRate(previous: RateState, size: number, now: number): RateState | null {
  const seconds = Math.max(0, Math.min(60, (now - previous.at) / 1000))
  const messages = Math.min(LIMITS.messageBurst, previous.messages + seconds * LIMITS.messagesPerSecond) - 1
  const bytes = Math.min(LIMITS.byteBurst, previous.bytes + seconds * LIMITS.bytesPerSecond) - size
  if (size < 0 || !Number.isFinite(size) || messages < 0 || bytes < 0) return null
  return { at: now, messages, bytes }
}
