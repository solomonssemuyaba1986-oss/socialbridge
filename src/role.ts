import { doc, getDoc, setDoc } from 'firebase/firestore'
import { auth, db } from './firebase'

/**
 * What the person chose on the "What brings you here?" screen.
 *
 * There are really **three** states, and the third one matters:
 *  - `'seller'` — they want a shop (set up at `/setup`);
 *  - `'buyer'` — they came to buy;
 *  - **no record at all** — *just looking*. Browsing needs no account and no choice, and
 *    somebody who never taps a card stays this way forever. Nothing is claimed about them.
 *
 * ⚠️ The choice does **not** decide where anyone lands any more: a seller with a shop goes to
 * their dashboard, a seller without one to the question, and **everybody else to the market**
 * (`homeForRole`). So never gate the market behind this — the front door is open to everyone.
 *
 * The device copy is what routing reads (instant, and it works for guests). The Firestore copy
 * rides along on `users/{uid}` so a seller's choice follows them to another phone.
 */
export type Role = 'buyer' | 'seller'

const ROLE_KEY = 'rachett_role'

export function getRole(): Role | null {
  try {
    const raw = localStorage.getItem(ROLE_KEY)
    return raw === 'buyer' || raw === 'seller' ? raw : null
  } catch {
    return null
  }
}

export function setRole(role: Role): void {
  try {
    localStorage.setItem(ROLE_KEY, role)
  } catch {
    // ignore storage errors
  }
  const uid = auth.currentUser?.uid
  if (!uid) return
  // Best-effort — routing uses the device copy, so a failed write is harmless.
  setDoc(doc(db, 'users', uid), { role }, { merge: true }).catch(err => {
    console.warn('Could not save role:', err)
  })
}

/**
 * Forget the choice — for "Just looking", and for escaping a half-made seller choice.
 *
 * Without this, someone who tapped *Seller*, wandered off before finishing and came back is
 * sent to the question on `/` **every single time**. Clearing the record means `/` leaves them
 * in the market like anybody else.
 */
export function clearRole(): void {
  try {
    localStorage.removeItem(ROLE_KEY)
  } catch {
    // ignore storage errors
  }
  const uid = auth.currentUser?.uid
  if (!uid) return
  // The device copy is what routing reads; this keeps the account record honest too.
  setDoc(doc(db, 'users', uid), { role: null }, { merge: true }).catch(err => {
    console.warn('Could not clear the saved role:', err)
  })
}

/** Sellers live in their dashboard; buyers live in the market; nobody has chosen yet → ask once. */
export function homeForRole(role: Role | null, hasShop: boolean): string {
  if (hasShop) return '/dashboard'
  return role === 'seller' ? '/onboarding' : MARKET_HOME
}

/**
 * 🛍️ Where the market lives.
 *
 * Today that's Browse — **products first, no menu, no questions**. When the real discovery
 * page is built this is the one line that changes, and everyone lands there.
 */
export const MARKET_HOME = '/browse'

/**
 * Where should this account land right now? A store wins (that makes someone a
 * seller whatever they tapped earlier); then their choice; otherwise the market.
 */
export async function resolveLanding(uid: string | null): Promise<string> {
  if (!uid) return MARKET_HOME
  let hasShop = false
  try {
    const snap = await getDoc(doc(db, 'sellers', uid))
    hasShop = snap.exists()
  } catch {
    // offline / rules — fall back to the role choice rather than blocking
  }
  return homeForRole(getRole(), hasShop)
}
