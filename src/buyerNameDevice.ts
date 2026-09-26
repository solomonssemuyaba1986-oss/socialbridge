/**
 * Where a name lives before there is an account.
 *
 * `useBuyerName` keeps the name on `users/{uid}`, so anyone who has not signed in — and everyone
 * who picks "just looking" — has nowhere to put the name they chose. This is that place: plain
 * localStorage, exactly the way the role choice (`role.ts`) and the guest quick replies
 * (`useQuickReplies.ts`) are kept, so there are no rules to deploy and nothing to provision.
 *
 * It is deliberately thin: every rule about what a name may be, and what a stored record may look
 * like, lives in the pure `buyerName.ts`, which `_name_check.cjs` checks in Node.
 */
import { parseDeviceName, serializeDeviceName, type DeviceNameState } from './buyerName'

const STORAGE_KEY = 'rachett_name'

/** The name chosen on this device, or (for a Later) the fact that they were already asked. */
export function readDeviceName(): DeviceNameState | null {
  try {
    return parseDeviceName(localStorage.getItem(STORAGE_KEY))
  } catch {
    // ignore storage errors
    return null
  }
}

export function writeDeviceName(rec: DeviceNameState): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeDeviceName(rec))
  } catch {
    // ignore storage errors
  }
}

/** Called once the device name has been adopted onto a real account — it must not be read twice. */
export function clearDeviceName(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore storage errors
  }
}
