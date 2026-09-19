import { doc, getDoc, setDoc } from 'firebase/firestore'
import { auth, db } from './firebase'

/**
 * What the person chose on the "What brings you here?" screen.
 *
 * Without this, a signed-in buyer has no home: `/` could only ever send them back
 * to onboarding, so every visit asked them who they were all over again.
 *
 * The device copy is what routing reads (works instantly, and for guests). The
 * Firestore copy rides along on `users/{uid}` so the choice follows them.
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
