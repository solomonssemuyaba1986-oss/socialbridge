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

/**
 * The name this phone last gave a seller — kept apart from the one above, and **never cleared**.
 *
 * `rachett_name` is an answer to a question (and is cleared the moment an account adopts it, so it is
 * never adopted twice). This is not an answer, it is a memory: it exists so the order form is already
 * filled in on the **first paint**, before any Firebase round-trip has answered. On a slow connection
 * the difference is a buyer who recognises their own name in the box and taps Confirm, versus a buyer
 * who starts typing it again while the field sits empty.
 *
 * It is a convenience, never a source of truth: whatever the account says wins, and this only ever
 * fills a box the buyer can still edit.
 */
const LAST_NAME_KEY = 'rachett_last_name'

/** The last name used on this phone, or '' if there never was one. */
export function readLastName(): string {
  try {
    return (localStorage.getItem(LAST_NAME_KEY) || '').trim()
  } catch {
    // ignore storage errors
    return ''
  }
}

export function rememberLastName(name: string): void {
  const tidy = (name || '').trim()
  if (!tidy) return
  try {
    localStorage.setItem(LAST_NAME_KEY, tidy)
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
