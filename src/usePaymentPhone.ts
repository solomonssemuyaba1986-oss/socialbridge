import { useCallback, useEffect, useRef, useState } from 'react'
import { deleteField, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, db } from './firebase'
import {
  PAYMENT_PHONE_KEY,
  normalizePhone,
  parseDevicePaymentPhone,
  serializeDevicePaymentPhone,
} from './paymentPhone'

function readDevicePhone(): string {
  try {
    return parseDevicePaymentPhone(localStorage.getItem(PAYMENT_PHONE_KEY))?.phone || ''
  } catch {
    return ''
  }
}

function writeDevicePhone(phone: string) {
  try {
    if (phone) localStorage.setItem(PAYMENT_PHONE_KEY, serializeDevicePaymentPhone(phone))
    else localStorage.removeItem(PAYMENT_PHONE_KEY)
  } catch {
    // Storage can be refused; the account copy is still the one that matters.
  }
}

/**
 * The number the checkout starts with, and the one it offers to save.
 *
 * Three sources, in the order the checkout should start with:
 *   1. `users/{uid}.paymentPhone` — the number pawaPay accepted last time. It is the most useful
 *      default even on an account whose verified phone is a different (older) number.
 *   2. `auth.currentUser.phoneNumber` — Firebase verified it; still labelled as verified.
 *   3. `localStorage.rachett_payment_phone` — the same on this phone, for a guest or a signed-out
 *      moment.
 *
 * Typing is never blocked by a late-arriving saved value: `touchedRef` means the buyer's own input
 * always wins. Saving happens through `remember`, which the payment screen calls only after pawaPay
 * has accepted the prompt — not while somebody is still typing.
 */
export function usePaymentPhone() {
  const [phone, setPhoneState] = useState(() => (
    normalizePhone(auth.currentUser?.phoneNumber || '') || readDevicePhone()
  ))
  const [verifiedPhone, setVerifiedPhone] = useState(() => normalizePhone(auth.currentUser?.phoneNumber || ''))
  const [savedPhone, setSavedPhone] = useState('')
  const [devicePhone, setDevicePhone] = useState(() => readDevicePhone())
  const [uid, setUid] = useState(auth.currentUser?.uid || '')
  const touchedRef = useRef(false)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, user => {
      setUid(user?.uid || '')
      setVerifiedPhone(normalizePhone(user?.phoneNumber || ''))
      if (!user) setSavedPhone('')
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    if (!uid) return
    const unsub = onSnapshot(doc(db, 'users', uid), snap => {
      const stored = normalizePhone(snap.data()?.paymentPhone || '')
      setSavedPhone(stored)
    }, err => {
      console.warn('Could not read the saved payment number:', err)
    })
    return () => unsub()
  }, [uid])

  const best = savedPhone || verifiedPhone || devicePhone
  useEffect(() => {
    if (!best || touchedRef.current) return
    setPhoneState(best)
  }, [best])

  const setPhone = useCallback((value: string) => {
    touchedRef.current = true
    setPhoneState(value)
  }, [])

  /** Called *after* the network accepted the prompt. Returns the normalised number. */
  const remember = useCallback(async (value: string): Promise<string> => {
    const normalized = normalizePhone(value)
    if (!normalized) return ''
    writeDevicePhone(normalized)
    setDevicePhone(normalized)
    setSavedPhone(normalized)
    setPhoneState(normalized)
    touchedRef.current = true
    if (uid) {
      try {
        await setDoc(doc(db, 'users', uid), {
          paymentPhone: normalized,
          paymentPhoneSavedAt: serverTimestamp(),
        }, { merge: true })
      } catch (err) {
        // The number is still remembered on this device; the next successful payment can save it.
        console.warn('Could not save the payment number to the account:', err)
      }
    }
    return normalized
  }, [uid])

  /** Forget the saved copy. A verified account number remains as the fallback, as it must. */
  const forget = useCallback(async () => {
    writeDevicePhone('')
    setDevicePhone('')
    setSavedPhone('')
    if (uid) {
      try {
        await setDoc(doc(db, 'users', uid), {
          paymentPhone: deleteField(),
          paymentPhoneSavedAt: deleteField(),
        }, { merge: true })
      } catch (err) {
        console.warn('Could not forget the saved payment number:', err)
      }
    }
  }, [uid])

  return { phone, setPhone, verifiedPhone, savedPhone, remember, forget }
}
