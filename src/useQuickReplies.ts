import { useCallback, useEffect, useState } from 'react'
import { doc, setDoc, onSnapshot } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, db } from './firebase'

const LS_KEY = 'rachett_quick_replies_guest'
const MAX = 20
const MAX_LEN = 200

function loadLocal(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x: unknown) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function saveLocal(replies: string[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(replies))
  } catch {
    // ignore storage errors
  }
}

/** The user's own quick replies — saved to their profile (signed in) or this device (guest). */
export function useQuickReplies() {
  const [replies, setReplies] = useState<string[]>([])
  const [uid, setUid] = useState<string | null>(null)

  useEffect(() => {
    let unsub: (() => void) | null = null
    const authUnsub = onAuthStateChanged(auth, (user) => {
      unsub?.()
      unsub = null
      setUid(user?.uid ?? null)
      if (!user) {
        setReplies(loadLocal())
        return
      }
      unsub = onSnapshot(doc(db, 'users', user.uid), (snap) => {
        const data = snap.data() as { quickReplies?: unknown } | undefined
        const list = Array.isArray(data?.quickReplies)
          ? (data!.quickReplies as unknown[]).filter((x): x is string => typeof x === 'string')
          : []
        setReplies(list)
      }, (err) => {
        console.warn('Quick replies listen failed:', err)
        setReplies([])
      })
    })
    return () => { authUnsub(); unsub?.() }
  }, [])

  const persist = useCallback(async (next: string[]) => {
    setReplies(next)
    if (uid) {
      try {
        await setDoc(doc(db, 'users', uid), { quickReplies: next }, { merge: true })
      } catch (err) {
        console.warn('Failed to save quick replies:', err)
      }
    } else {
      saveLocal(next)
    }
  }, [uid])

  const addReply = useCallback((text: string) => {
    const clean = text.trim().slice(0, MAX_LEN)
    if (!clean) return
    if (replies.some(r => r.toLowerCase() === clean.toLowerCase())) return
    void persist([clean, ...replies].slice(0, MAX))
  }, [replies, persist])

  const removeReply = useCallback((text: string) => {
    void persist(replies.filter(r => r !== text))
  }, [replies, persist])

  return { replies, addReply, removeReply }
}
