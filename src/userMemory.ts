import type { User } from 'firebase/auth'

/** Save the last signed-in user so the SignIn page can greet them on return. */
export function rememberUser(user: User | null) {
  if (!user) return
  try {
    localStorage.setItem('rachett_last_user', JSON.stringify({
      displayName: user.displayName || '',
      email: user.email || '',
      photoURL: user.photoURL || '',
      uid: user.uid,
    }))
  } catch {
    // ignore storage errors
  }
}
