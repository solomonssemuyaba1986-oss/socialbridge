/**
 * Draft messages — typed, not sent yet.
 *
 * Three guarantees, in order of importance:
 *  1. **Nothing typed is lost** — saved 500 ms after you stop typing, on tab hide
 *     and on unmount (the previous version only flushed on unmount, so a killed
 *     app lost the last keystrokes).
 *  2. **The seller can never read it** — a draft lives on your device and, once
 *     you are signed in, on *your own* user document (`users/{uid}.drafts`). It is
 *     never a message and never a field on a thread.
 *  3. **You can find it again** — it carries the conversation, person and product
 *     context, so the Inbox can list it and reopen it with one tap (`useAllDrafts`).
 *
 * Canonical key: `convo_<conversationId>`. Drafts written by the previous version
 * (a bare string) still read correctly — see `draftStore.parseDraft`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, db } from './firebase'
import { trackEvent } from './analytics'
import {
  DRAFT_NONE,
  DRAFT_PREFIX,
  capDrafts,
  listDrafts,
  mergeDrafts,
  parseDraft,
  pruneStale,
  readDraft,
  removeDraft,
  toAccountDrafts,
  writeDraft,
  type DraftMeta,
  type StorageLike,
} from './draftStore'

const isDev = Boolean(import.meta.env?.DEV)

/** What a message sheet knows about the draft it is composing. */
export interface DraftContext {
  sellerId: string
  buyerId: string
  counterpartName: string
  counterpartRole: 'seller' | 'buyer'
  productId?: string
  productName?: string
  productPrice?: string
  productImage?: string
}

/** Real localStorage, or an in-memory stand-in when storage is blocked. */
function browserStore(): StorageLike {
  try {
    const ls = window.localStorage
    ls.getItem(DRAFT_PREFIX)
    return {
      getItem: (k) => ls.getItem(k),
      setItem: (k, v) => ls.setItem(k, v),
      removeItem: (k) => ls.removeItem(k),
      keys: () => Object.keys(ls),
    }
  } catch {
    const map = new Map<string, string>()
    return {
      getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
      setItem: (k, v) => { map.set(k, v) },
      removeItem: (k) => { map.delete(k) },
      keys: () => [...map.keys()],
    }
  }
}

/** `convo_abc_def` -> `abc_def` — the id the conversation will use. */
export function conversationIdFromKey(key: string): string {
  return key.startsWith('convo_') ? key.slice('convo_'.length) : key
}

/** Read a draft's text by storage key — for lists that only need a preview. */
export function getDraft(key: string): string {
  try {
    return parseDraft(browserStore().getItem(DRAFT_PREFIX + key), conversationIdFromKey(key))?.text || ''
  } catch {
    return ''
  }
}

function notifyDraftChange(): void {
  try {
    window.dispatchEvent(new CustomEvent('rachett:draftchange'))
  } catch {
    // ignore
  }
}

/** Copy one draft onto the account — read-merge-write so other devices keep theirs. */
async function pushDraftToAccount(uid: string, meta: DraftMeta): Promise<void> {
  try {
    const ref = doc(db, 'users', uid)
    const snap = await getDoc(ref)
    const data = snap.data() as { drafts?: unknown } | undefined
    const existing = Array.isArray(data?.drafts) ? (data.drafts as DraftMeta[]).filter((d) => d && d.conversationId) : []
    const merged = mergeDrafts([meta], existing)
    await setDoc(ref, { drafts: toAccountDrafts(merged) }, { merge: true })
  } catch (err) {
    // Offline, or a rule said no — the local copy is intact and the next save retries.
    console.warn('Could not sync draft to account:', err)
  }
}

/** Forget one draft on the account (sent or discarded). */
async function pullDraftFromAccount(uid: string, conversationId: string): Promise<void> {
  try {
    const ref = doc(db, 'users', uid)
    const snap = await getDoc(ref)
    const data = snap.data() as { drafts?: unknown } | undefined
    const existing = Array.isArray(data?.drafts) ? (data.drafts as DraftMeta[]).filter((d) => d && d.conversationId) : []
    await setDoc(ref, { drafts: toAccountDrafts(existing.filter((d) => d.conversationId !== conversationId)) }, { merge: true })
  } catch (err) {
    console.warn('Could not remove draft from account:', err)
  }
}/**
 * The draft for one conversation/product. The sheets keep their existing shape
 * (`text`, `setText`, `draft`, `clearDraft`); `context` is what lets the draft be
 * listed in the Inbox and followed on the account.
 */
export function useDraft(key: string, context?: DraftContext, options?: { surface?: string }) {
  const store = useMemo(() => browserStore(), [])
  const storageKey = !key || key === DRAFT_NONE ? DRAFT_NONE : key
  const conversationId = conversationIdFromKey(storageKey)
  const surface = options?.surface ?? 'unknown'

  const contextRef = useRef<DraftContext | undefined>(context)
  /** Sent or discarded on purpose — that is not an abandoned draft. */
  const resolvedRef = useRef(false)
  const startedRef = useRef(false)

  /** Reading a draft the previous version wrote under `product_<id>` still works. */
  const load = (k: string, productId?: string): DraftMeta | null => {
    const own = parseDraft(store.getItem(DRAFT_PREFIX + k), conversationIdFromKey(k))
    if (own) return own
    if (!productId) return null
    return parseDraft(store.getItem(`${DRAFT_PREFIX}product_${productId}`), conversationIdFromKey(k))
  }

  const [text, setText] = useState<string>(() => load(storageKey, context?.productId)?.text || '')
  const [currentKey, setCurrentKey] = useState(storageKey)

  // Opening a different product/conversation loads that draft instead.
  if (currentKey !== storageKey) {
    setCurrentKey(storageKey)
    setText(load(storageKey, context?.productId)?.text || '')
  }

  /** A new target means a fresh draft — reset the per-draft bookkeeping. */
  useEffect(() => {
    resolvedRef.current = false
    startedRef.current = false
  }, [storageKey])

  useEffect(() => {
    contextRef.current = context
  }, [context])

  /** Saves locally and returns what was written (null when there is nothing to save). */
  const save = useCallback((value: string): DraftMeta | null => {
    const ctx = contextRef.current
    if (storageKey === DRAFT_NONE) {
      if (isDev) console.warn('[drafts] nothing to save — no product or conversation is open')
      return null
    }
    if (!ctx) {
      // No context to attach (should not happen: every sheet passes one). Keep the
      // old bare-text behaviour rather than losing what was typed.
      try {
        if (value.trim()) store.setItem(DRAFT_PREFIX + storageKey, value)
        else store.removeItem(DRAFT_PREFIX + storageKey)
        notifyDraftChange()
      } catch {
        // ignore
      }
      return null
    }
    const meta: DraftMeta = {
      conversationId,
      sellerId: ctx.sellerId,
      buyerId: ctx.buyerId,
      counterpartName: ctx.counterpartName,
      counterpartRole: ctx.counterpartRole,
      productId: ctx.productId,
      productName: ctx.productName,
      productPrice: ctx.productPrice,
      productImage: ctx.productImage,
      text: value,
      at: Date.now(),
    }
    writeDraft(store, meta)
    notifyDraftChange()
    return meta
  }, [store, storageKey, conversationId])

  const saveRef = useRef(save)
  const textRef = useRef(text)
  useEffect(() => { saveRef.current = save }, [save])
  useEffect(() => { textRef.current = text }, [text])

  // Autosave: after a pause in typing, and on unmount.
  useEffect(() => {
    const timer = setTimeout(() => save(text), 500)
    return () => {
      clearTimeout(timer)
      save(text)
    }
  }, [text, save])

  // `message_draft_started` fires once, on the first real keystroke of this draft.
  const prevTextRef = useRef(text)
  useEffect(() => {
    const becameNonEmpty = !prevTextRef.current.trim() && text.trim().length > 0
    prevTextRef.current = text
    if (!becameNonEmpty || startedRef.current || !contextRef.current) return
    startedRef.current = true
    trackEvent('message_draft_started', {
      conversationId,
      surface,
      productId: contextRef.current.productId,
      sellerId: contextRef.current.sellerId,
      length: text.trim().length,
    })
  }, [text, conversationId, surface])  /**
   * The phone-falls-out-of-your-hand case: flush on tab hide and on close, and
   * count the ones that never got sent so the leak is measurable.
   */
  useEffect(() => {
    if (storageKey === DRAFT_NONE) return
    const flush = () => {
      const value = textRef.current
      const meta = saveRef.current(value)
      if (!meta || !value.trim()) return
      const uid = auth.currentUser?.uid
      if (uid) void pushDraftToAccount(uid, meta)
      if (!resolvedRef.current) {
        trackEvent('message_draft_abandoned', {
          conversationId,
          surface,
          length: value.trim().length,
        })
      }
    }
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [storageKey, conversationId, surface])

  /**
   * Typed while signed out, then signed in? Move the product-keyed draft onto the
   * conversation key so it shows up in the Inbox. The seller still sees nothing —
   * this only changes where *your* draft is remembered.
   */
  useEffect(() => {
    if (storageKey === DRAFT_NONE || storageKey.startsWith('product_')) return
    const sellerId = context?.sellerId
    const buyerId = context?.buyerId
    if (!sellerId || !buyerId || !conversationId) return
    const carried = textRef.current
    if (!carried.trim()) return
    if (readDraft(store, conversationId)) return
    writeDraft(store, {
      conversationId,
      sellerId,
      buyerId,
      counterpartName: context?.counterpartName || 'Seller',
      counterpartRole: context?.counterpartRole || 'seller',
      productId: context?.productId,
      productName: context?.productName,
      productPrice: context?.productPrice,
      productImage: context?.productImage,
      text: carried,
      at: Date.now(),
    })
    if (context?.productId) removeDraft(store, `product_${context.productId}`)
    notifyDraftChange()
  }, [storageKey, conversationId, context?.sellerId, context?.buyerId, context?.productId, store])

  /**
   * Flush right now. Wired to every "close the sheet" path so a draft typed in the
   * last half-second can never be cancelled by the key switching to `none`.
   */
  const saveNow = useCallback(() => {
    const value = textRef.current
    const meta = saveRef.current(value)
    const uid = auth.currentUser?.uid
    if (meta && value.trim() && uid) void pushDraftToAccount(uid, meta)
  }, [])

  const clearDraft = useCallback(() => {
    resolvedRef.current = true
    setText('')
    removeDraft(store, conversationId)
    notifyDraftChange()
    const uid = auth.currentUser?.uid
    if (uid && conversationId) void pullDraftFromAccount(uid, conversationId)
  }, [store, conversationId])

  return { text, setText, draft: text.trim().length > 0, clearDraft, saveNow }
}

/**
 * Every draft this person has: what they typed on this device plus what their
 * account remembers — newest first, capped, stale ones dropped.
 */
export function useAllDrafts() {
  const store = useMemo(() => browserStore(), [])
  const [local, setLocal] = useState<DraftMeta[]>(() => listDrafts(store))
  const [account, setAccount] = useState<DraftMeta[]>([])
  const [uid, setUid] = useState<string | null>(null)

  // Typing (or discarding) refreshes the list anywhere it is shown.
  useEffect(() => {
    const refresh = () => setLocal(listDrafts(store))
    window.addEventListener('rachett:draftchange', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('rachett:draftchange', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [store])

  // The account copy, when signed in — so a new device still shows the draft.
  useEffect(() => {
    let unsub: (() => void) | null = null
    const authUnsub = onAuthStateChanged(auth, (user) => {
      unsub?.()
      unsub = null
      setUid(user?.uid ?? null)
      if (!user) {
        setAccount([])
        return
      }
      unsub = onSnapshot(doc(db, 'users', user.uid), (snap) => {
        const data = snap.data() as { drafts?: unknown } | undefined
        const list = Array.isArray(data?.drafts) ? (data.drafts as DraftMeta[]).filter((d) => d && d.conversationId) : []
        setAccount(pruneStale(list, Date.now()))
      }, (err) => {
        console.warn('Draft listen failed:', err)
        setAccount([])
      })
    })
    return () => { authUnsub(); unsub?.() }
  }, [])

  const drafts = useMemo(() => capDrafts(mergeDrafts(local, account)), [local, account])

  const discardDraft = useCallback((conversationId: string) => {
    removeDraft(store, conversationId)
    setLocal(listDrafts(store))
    notifyDraftChange()
    if (uid) void pullDraftFromAccount(uid, conversationId)
  }, [store, uid])

  return { drafts, discardDraft }
}