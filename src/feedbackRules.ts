/**
 * The asking rules for feedback — **pure** on purpose (no Firebase, no React), so the whole
 * policy ("who gets asked, and how often") is verified in Node by `_feedback_check.cjs`
 * instead of being hoped for in the browser. `src/feedback.ts` re-exports all of this.
 */

/** The bit of storage we need, injectable so the rules can be tested in Node. */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Persistent (survives closing the app) — when we last asked and whether they answered. */
export const FEEDBACK_MEMORY_KEY = 'rachett_feedback'
/** Per-visit (resets when the tab closes) — how many different pages they've actually seen. */
export const FEEDBACK_VISIT_KEY = 'rachett_feedback_visit'

/** How many different pages someone must have seen before the question is deserved. */
export const MIN_PAGES = 3
/** "Later" buys this much quiet. */
export const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000
/** Somebody who has already answered is left alone for this long. */
export const DONE_COOLDOWN_MS = 90 * 24 * 60 * 60 * 1000

export interface FeedbackMemory {
  /** When the ask was last shown (ms). 0 = never. */
  askedAt: number
  /** When they last answered (ms). 0 = never. */
  doneAt: number
}

function safeStore(pick: () => Storage): StorageLike {
  try {
    const store = pick()
    store.setItem('rachett_probe', '1')
    store.removeItem('rachett_probe')
    return store
  } catch {
    // Storage blocked (private mode, embedded webview) — keep it in memory for this session.
    const map = new Map<string, string>()
    return {
      getItem: key => (map.has(key) ? map.get(key)! : null),
      setItem: (key, value) => { map.set(key, value) },
      removeItem: key => { map.delete(key) },
    }
  }
}

let memoryStore: StorageLike | null = null
let visitStore: StorageLike | null = null

export function feedbackMemoryStore(): StorageLike {
  if (!memoryStore) memoryStore = safeStore(() => window.localStorage)
  return memoryStore
}

export function feedbackVisitStore(): StorageLike {
  if (!visitStore) visitStore = safeStore(() => window.sessionStorage)
  return visitStore
}

export function readFeedbackMemory(store: StorageLike): FeedbackMemory {
  try {
    const raw = store.getItem(FEEDBACK_MEMORY_KEY)
    if (!raw) return { askedAt: 0, doneAt: 0 }
    const parsed = JSON.parse(raw) as Partial<FeedbackMemory>
    return { askedAt: Number(parsed?.askedAt) || 0, doneAt: Number(parsed?.doneAt) || 0 }
  } catch {
    return { askedAt: 0, doneAt: 0 }
  }
}

export function writeFeedbackMemory(store: StorageLike, memory: FeedbackMemory): void {
  try {
    store.setItem(FEEDBACK_MEMORY_KEY, JSON.stringify(memory))
  } catch {
    // ignore storage errors
  }
}

export function markAsked(store: StorageLike, at = Date.now()): void {
  writeFeedbackMemory(store, { ...readFeedbackMemory(store), askedAt: at })
}

export function markDone(store: StorageLike, at = Date.now()): void {
  writeFeedbackMemory(store, { ...readFeedbackMemory(store), doneAt: at })
}

export interface FeedbackVisit {
  /** The distinct routes seen this visit. */
  pages: string[]
  startedAt: number
}

export function readFeedbackVisit(store: StorageLike): FeedbackVisit {
  try {
    const raw = store.getItem(FEEDBACK_VISIT_KEY)
    if (!raw) return { pages: [], startedAt: Date.now() }
    const parsed = JSON.parse(raw) as Partial<FeedbackVisit>
    return {
      pages: Array.isArray(parsed?.pages) ? parsed!.pages.filter((p): p is string => typeof p === 'string') : [],
      startedAt: Number(parsed?.startedAt) || Date.now(),
    }
  } catch {
    return { pages: [], startedAt: Date.now() }
  }
}

/** Note the page they are on and say how many different ones that makes this visit. */
export function countVisitedPage(store: StorageLike, route: string): number {
  const visit = readFeedbackVisit(store)
  if (route && !visit.pages.includes(route)) visit.pages.push(route)
  try {
    store.setItem(FEEDBACK_VISIT_KEY, JSON.stringify(visit))
  } catch {
    // ignore storage errors
  }
  return visit.pages.length
}

/**
 * Should the question be asked right now? The whole policy, in one place:
 *  • they must have actually used the app (seen a few different pages);
 *  • "Later" buys a week of quiet;
 *  • somebody who answered is left alone for three months;
 *  • and a visitor we have no record of is asked as soon as they've looked around.
 */
export function shouldAskFeedback(input: {
  actions: number
  askedAt: number
  doneAt: number
  now?: number
}): boolean {
  const now = input.now ?? Date.now()
  if (input.actions < MIN_PAGES) return false
  if (input.doneAt > 0 && now - input.doneAt < DONE_COOLDOWN_MS) return false
  if (input.askedAt > 0 && now - input.askedAt < SNOOZE_MS) return false
  return true
}
