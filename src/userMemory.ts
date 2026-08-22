import type { User } from 'firebase/auth'

export interface RememberedUser {
  displayName: string
  email: string
  photoURL: string
  uid: string
  providerId?: string
}

const STORAGE_KEY = 'rachett_last_user'

/** Save the last signed-in user so sign-in screens can offer one-tap "Continue as". */
export function rememberUser(user: User | null) {
  if (!user) return
  try {
    const data: RememberedUser = {
      displayName: user.displayName || '',
      email: user.email || '',
      photoURL: user.photoURL || '',
      uid: user.uid,
      providerId: user.providerData?.[0]?.providerId || '',
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // ignore storage errors
  }
}

export function getRememberedUser(): RememberedUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as RememberedUser
    if (!parsed || !parsed.uid) return null
    return parsed
  } catch {
    return null
  }
}

export function clearRememberedUser() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore storage errors
  }
}
