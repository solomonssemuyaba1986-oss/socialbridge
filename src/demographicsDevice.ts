/**
 * Where an age band and a gender live before there is an account.
 *
 * `useDemographics` keeps the answer on `users/{uid}`, so everyone who has not signed in — and every
 * "just looking" visitor who answered on the onboarding screen — has nowhere to put it. This is that
 * place: plain localStorage, exactly the way the role choice (`role.ts`) and the name
 * (`buyerNameDevice.ts`) are kept, so there are no rules to deploy and nothing to provision.
 *
 * It is deliberately thin: every rule about what an answer may be, and what a stored record may look
 * like, lives in the pure `demographics.ts`, which `_demographics_check.cjs` checks in Node.
 */
import { parseDeviceDemographics, serializeDeviceDemographics, type DeviceDemographics } from './demographics'

const STORAGE_KEY = 'rachett_demographics'

/** The answer given on this phone, or null if there has never been one. */
export function readDeviceDemographics(): DeviceDemographics | null {
  try {
    return parseDeviceDemographics(localStorage.getItem(STORAGE_KEY))
  } catch {
    // ignore storage errors
    return null
  }
}

export function writeDeviceDemographics(rec: DeviceDemographics): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeDeviceDemographics(rec))
  } catch {
    // ignore storage errors
  }
}

/** Called once the device answer has been adopted onto a real account — it must not be adopted twice. */
export function clearDeviceDemographics(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore storage errors
  }
}
