/**
 * The draft store — a message you wrote and didn't send yet.
 *
 * A draft is **not** a message and **not** a thread. It lives on your device (and,
 * when you're signed in, on your own user document) so the seller can never read
 * half-written words, and it carries just enough context to be listed in your
 * Inbox and reopened with one tap.
 *
 * Everything here is pure and storage-injectable, so the round-trip, the migration
 * from the old bare-string drafts and the merge/cap rules can be verified in a
 * plain Node script (see `_draft_check.cjs` during development).
 *
 * Canonical key: `rachett_draft_<conversationId>` — the conversation id comes from
 * `getConversationId(sellerId, buyerId)`, so it is known *before* the thread exists.
 */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  /** All keys on the store — needed to enumerate drafts. */
  keys(): string[]
}

export interface DraftMeta {
  conversationId: string
  sellerId: string
  buyerId: string
  /** Who I'm writing to, for the Inbox row ("Aisha Fabrics"). */
  counterpartName: string
  /** Their role — `seller` when I'm the buyer, `buyer` when I'm the seller. */
  counterpartRole: 'seller' | 'buyer'
  productId?: string
  productName?: string
  productPrice?: string
  productImage?: string
  /** Their store link — lets a draft be reopened even before a chat exists. */
  sellerSlug?: string
  text: string
  /** ms — when the text last changed. */
  at: number
}

export const DRAFT_PREFIX = 'rachett_draft_'
/** The placeholder key the hook uses when no draft target is open. */
export const DRAFT_NONE = `${DRAFT_PREFIX}none`
/** How many drafts follow a signed-in account (the device copy has no limit). */
export const MAX_ACCOUNT_DRAFTS = 25
export const MAX_DRAFT_TEXT = 500

export function draftKey(conversationId: string): string {
  return `${DRAFT_PREFIX}${conversationId}`
}

/**
 * Reads either shape: the current JSON metadata, or a bare string written by the
 * previous implementation (treated as text with no context).
 */
export function parseDraft(raw: string | null, conversationId = ''): DraftMeta | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (!trimmed.startsWith('{')) {
    // Legacy draft: plain text, no context.
    return {
      conversationId,
      sellerId: '',
      buyerId: '',
      counterpartName: '',
      counterpartRole: 'seller',
      text: raw,
      at: 0,
    }
  }
  try {
    const parsed = JSON.parse(trimmed) as Partial<DraftMeta>
    const text = typeof parsed.text === 'string' ? parsed.text : ''
    if (!text.trim()) return null
    return {
      conversationId: parsed.conversationId || conversationId,
      sellerId: parsed.sellerId || '',
      buyerId: parsed.buyerId || '',
      counterpartName: parsed.counterpartName || '',
      counterpartRole: parsed.counterpartRole === 'buyer' ? 'buyer' : 'seller',
      productId: parsed.productId,
      productName: parsed.productName,
      productPrice: parsed.productPrice,
      productImage: parsed.productImage,
      sellerSlug: parsed.sellerSlug,
      text,
      at: typeof parsed.at === 'number' ? parsed.at : 0,
    }
  } catch {
    return null
  }
}

export function readDraft(store: StorageLike, conversationId: string): DraftMeta | null {
  try {
    return parseDraft(store.getItem(draftKey(conversationId)), conversationId)
  } catch {
    return null
  }
}

/** Saves a draft (empty text is a delete, never a stored blank). */
export function writeDraft(store: StorageLike, meta: DraftMeta): void {
  try {
    if (!meta.text.trim() || !meta.conversationId) {
      removeDraft(store, meta.conversationId)
      return
    }
    const payload: DraftMeta = { ...meta, text: meta.text.slice(0, MAX_DRAFT_TEXT), at: meta.at || Date.now() }
    store.setItem(draftKey(meta.conversationId), JSON.stringify(payload))
  } catch {
    // storage unavailable — a lost draft must never break the app
  }
}

export function removeDraft(store: StorageLike, conversationId: string): void {
  try {
    store.removeItem(draftKey(conversationId))
  } catch {
    // ignore
  }
}

/** Every draft on this device, newest first. **Nothing expires** — a draft lives
 *  until the person sends it or taps Cancel. */
export function listDrafts(store: StorageLike): DraftMeta[] {
  let keys: string[]
  try {
    keys = store.keys().filter((k) => k.startsWith(DRAFT_PREFIX) && k !== DRAFT_NONE)
  } catch {
    return []
  }
  const drafts: DraftMeta[] = []
  for (const key of keys) {
    const meta = readDraft(store, key.slice(DRAFT_PREFIX.length))
    if (meta) drafts.push(meta)
  }
  return drafts.sort((a, b) => b.at - a.at)
}

/**
 * Local drafts win over the account copy of the same conversation, and the newer
 * text wins over the older — so a device that was offline doesn't lose what was
 * typed there, while a fresh device still sees the account's drafts.
 */
export function mergeDrafts(local: DraftMeta[], account: DraftMeta[]): DraftMeta[] {
  const byId = new Map<string, DraftMeta>()
  for (const draft of account) byId.set(draft.conversationId, draft)
  for (const draft of local) {
    const existing = byId.get(draft.conversationId)
    if (!existing || (draft.at || 0) >= (existing.at || 0)) byId.set(draft.conversationId, draft)
  }
  return [...byId.values()].sort((a, b) => b.at - a.at)
}

/** Keeps the newest N — the account copy must stay small. */
export function capDrafts(list: DraftMeta[], max = MAX_ACCOUNT_DRAFTS): DraftMeta[] {
  return [...list].sort((a, b) => b.at - a.at).slice(0, max)
}

/** What the Inbox row calls this draft. */
export function draftLabel(meta: DraftMeta): string {
  return meta.productName || meta.counterpartName || 'Message'
}

/** "just now" / "12m ago" / "2h ago" / "3d ago" — a draft must not look like a new message. */
export function draftAge(meta: DraftMeta, now = Date.now()): string {
  if (!meta.at) return ''
  const mins = Math.max(0, Math.round((now - meta.at) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** The `users/{uid}.drafts` payload — only the fields the Inbox needs. */
export function toAccountDrafts(list: DraftMeta[]): DraftMeta[] {
  return capDrafts(list).map((draft) => ({ ...draft, text: draft.text.slice(0, MAX_DRAFT_TEXT) }))
}
