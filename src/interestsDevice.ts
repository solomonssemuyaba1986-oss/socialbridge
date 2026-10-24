/**
 * Where a buyer's interests live before there is an account.
 *
 * `useInterests` keeps the answer on `users/{uid}`, so a "just looking" visitor answering the
 * onboarding question has nowhere to put it. This is that place: plain localStorage, like the role
 * (`role.ts`), the name (`buyerNameDevice.ts`) and the age ask (`demographicsDevice.ts`).
 *
 * It is deliberately thin: every rule about what an interest may be, and what a stored record looks
 * like, lives in the pure `interests.ts`, which `_interests_check.cjs` checks in Node.
 */
import { parseDeviceInterests, serializeDeviceInterests, type DeviceInterests } from './interests'

const STORAGE_KEY = 'rachett_interests'

/** The choices given on this phone, or null if there has never been an answer. */
export function readDeviceInterests(): DeviceInterests | null {
  try {
    return parseDeviceInterests(localStorage.getItem(STORAGE_KEY))
  } catch {
    // ignore storage errors
    return null
  }
}

export function writeDeviceInterests(rec: DeviceInterests): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeDeviceInterests(rec))
  } catch {
    // ignore storage errors
  }
}

/** Called once the device answer has been adopted onto a real account — it must not be adopted twice. */
export function clearDeviceInterests(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore storage errors
  }
}
