import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db, auth } from './firebase'
import { trackEvent } from './analytics'

/**
 * Feedback — the one question that teaches us something: **what didn't you like about rachett?**
 *
 * Two ways in, one destination:
 *  - the full page (`/feedback`), for someone who has something long to say;
 *  - the after-use nudge (`FeedbackNudge.tsx`), one sentence, one tap.
 *
 * The asking rules are pure functions at the bottom, so "who gets asked, and how often" is
 * checked in Node (`_feedback_check.cjs`) instead of being guessed at in the browser.
 */

export type FeedbackCategory = 'Bug Report' | 'Change Request' | 'Feature Request' | 'Other'
export type FeedbackSource = 'page' | 'prompt'

/**
 * The four kinds, labelled the way the question asks them. The **stored values never change**
 * (Bug Report / Change Request / …) so yesterday's answers keep grouping with today's.
 */
export const FEEDBACK_CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: 'Change Request', label: 'Something annoyed me' },
  { value: 'Bug Report', label: "Something's broken" },
  { value: 'Feature Request', label: "Something's missing" },
  { value: 'Other', label: 'Something else' },
]

export interface FeedbackInput {
  role: 'seller' | 'buyer'
  category: FeedbackCategory
  message: string
  name?: string
  contact?: string
  /** 'page' = the full form, 'prompt' = the after-use card. */
  source?: FeedbackSource
}

const FORMSPREE_ID = (import.meta.env.VITE_FORMSPREE_ID || '').trim()

/**
 * Saves to `feedback/` and, when Formspree is configured, emails it too. Returns true if it
 * landed anywhere — so a missing email key never loses somebody's words.
 */
export async function submitFeedback(input: FeedbackInput): Promise<boolean> {
  const text = input.message.trim()
  if (!text) return false

  const payload = {
    role: input.role,
    category: input.category,
    message: text,
    name: (input.name || '').trim(),
    contact: (input.contact || '').trim(),
    page: window.location.href,
    source: input.source || 'page',
    submittedAt: new Date().toISOString(),
    userEmail: auth.currentUser?.email || '',
  }

  let emailed = false
  if (FORMSPREE_ID) {
    try {
      const res = await fetch(`https://formspree.io/f/${FORMSPREE_ID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      })
      emailed = res.ok
    } catch (err) {
      console.error('Formspree error:', err)
    }
  }

  let saved = false
  // A signed-in person (anonymous guests included) writes to Firestore; a true guest cannot.
  if (auth.currentUser) {
    try {
      await addDoc(collection(db, 'feedback'), {
        ...payload,
        uid: auth.currentUser.uid,
        createdAt: serverTimestamp(),
      })
      saved = true
    } catch (err) {
      console.error('Feedback save error:', err)
    }
  }

  if (emailed || saved) {
    trackEvent('feedback_submitted', { category: input.category, role: input.role, source: payload.source })
    return true
  }
  return false
}

// ── remembering what we have already asked ───────────────────────────────────
// The rules themselves live in `./feedbackRules` (pure, Node-testable) and are re-exported
// here so callers only ever import from `./feedback`.
export * from './feedbackRules'
import type { FeedbackMemory } from './feedbackRules'

// ── the account copy, so a second phone doesn't ask the same person twice ─────

export async function readFeedbackMemoryFromAccount(): Promise<FeedbackMemory> {
  const uid = auth.currentUser?.uid
  if (!uid) return { askedAt: 0, doneAt: 0 }
  try {
    const data = (await getDoc(doc(db, 'users', uid))).data() || {}
    return { askedAt: Number(data.feedbackAskedAt) || 0, doneAt: Number(data.feedbackDoneAt) || 0 }
  } catch {
    return { askedAt: 0, doneAt: 0 }
  }
}

export async function pushFeedbackMemoryToAccount(patch: {
  feedbackAskedAt?: number
  feedbackDoneAt?: number
}): Promise<void> {
  const uid = auth.currentUser?.uid
  if (!uid) return
  try {
    await setDoc(doc(db, 'users', uid), patch, { merge: true })
  } catch (err) {
    console.warn('Could not save the feedback memory:', err)
  }
}
