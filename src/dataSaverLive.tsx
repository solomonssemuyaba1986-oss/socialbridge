/**
 * The data saver, live — one setting, shared by every screen.
 *
 * A page cannot be trusted to remember this on its own: the feed, the product sheet, the shop page
 * and the profile card all draw photos, and if each held its own copy a buyer would turn the saver on
 * in Settings and still get full-size pictures in the feed. So it lives in one provider, exactly like
 * the seller badges (`sellerLive.tsx`), and every screen reads the same answer.
 *
 * Two details worth knowing:
 *
 *  - **The device is listened to.** If the phone's own Data Saver comes on, or the connection drops to
 *    3G mid-scroll, the state is recomputed (`connection.addEventListener('change')`) and the next
 *    photo asked for is a smaller one. Nobody has to notice and nobody has to tap anything.
 *  - **The ledger is counted out of the render path.** `image()` is called while React is drawing, so
 *    it records into a ref (a Set, so a re-render never counts the same photo twice) and the visible
 *    total is flushed from a timer. No setState during render, no double-count on StrictMode.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { budgetedImage } from './cloudinaryUrl'
import {
  EMPTY_LEDGER,
  SAVER_STORAGE_KEY,
  imageBudget,
  ledgerLine as ledgerLineFor,
  noteLedger,
  readSaverChoice,
  resolveDataSaver,
  type ImageBudget,
  type NetworkLike,
  type SaverChoice,
  type SaverLedger,
  type SaverSource,
} from './dataSaver'

function readStored(): SaverChoice {
  try {
    return readSaverChoice(localStorage.getItem(SAVER_STORAGE_KEY))
  } catch {
    // ignore storage errors — the default (on) is the right answer for a browser that blocks storage
    return null
  }
}

function writeStored(choice: SaverChoice): void {
  try {
    if (choice === null) localStorage.removeItem(SAVER_STORAGE_KEY)
    else localStorage.setItem(SAVER_STORAGE_KEY, choice)
  } catch {
    // the setting still applies to this visit; it just will not be remembered
  }
}

/** What the browser will tell us about the connection, if it will tell us anything at all. */
function deviceNetwork(): NetworkLike | null {
  const conn = (navigator as unknown as { connection?: NetworkLike }).connection
  if (!conn || typeof conn !== 'object') return null
  return {
    saveData: conn.saveData === true,
    effectiveType: typeof conn.effectiveType === 'string' ? conn.effectiveType : '',
    downlink: Number(conn.downlink),
  }
}

/** How often the "about X MB saved" line is allowed to move. Cheap, and often enough to notice. */
const LEDGER_FLUSH_MS = 1500

export interface DataSaverValue {
  /** Where the setting is now. */
  on: boolean
  /** `you` · `network` · `default` — so the card can say who decided rather than guess. */
  source: SaverSource
  /** One plain sentence, ready to render. */
  reason: string
  /** Widths, quality and page sizes, for whatever the screen is drawing. */
  budget: ImageBudget
  ledger: SaverLedger
  /** "About 1.4 MB saved on this visit: 42 photos sent small…". */
  ledgerLine: string
  /**
   * The URL to actually put in an `<img>`. Rewrites a Cloudinary URL to the right width and quality
   * and quietly counts what it saved.
   */
  image: (url: string, size?: 'card' | 'full') => string
  /** Flip it, or set it outright. Writes to this device and sticks for the visit. */
  setOn: (on: boolean) => void
  toggle: () => void
}

const DataSaverContext = createContext<DataSaverValue | null>(null)

export function DataSaverProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<SaverChoice>(() => readStored())
  const [network, setNetwork] = useState<NetworkLike | null>(() => deviceNetwork())
  const [ledger, setLedger] = useState<SaverLedger>(EMPTY_LEDGER)

  // One entry per photo actually asked for ("url@width"), so a re-render is not a new photo.
  const countedRef = useRef<Set<string>>(new Set())
  const ledgerRef = useRef<SaverLedger>(EMPTY_LEDGER)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // The phone changing its mind (Data Saver on, or a drop to 3G) is a new fact, so re-read it.
  useEffect(() => {
    const conn = (navigator as unknown as {
      connection?: NetworkLike & {
        addEventListener?: (type: string, fn: () => void) => void
        removeEventListener?: (type: string, fn: () => void) => void
      }
    }).connection
    if (!conn || typeof conn.addEventListener !== 'function') return
    const onChange = () => setNetwork(deviceNetwork())
    conn.addEventListener('change', onChange)
    return () => conn.removeEventListener?.('change', onChange)
  }, [])

  const state = useMemo(() => resolveDataSaver(choice, network), [choice, network])
  const budget = useMemo(() => imageBudget(state), [state])

  // Flush the counted savings on a timer — never from inside a render.
  useEffect(() => {
    const tick = setInterval(() => {
      if (!mountedRef.current) return
      setLedger(prev => (prev === ledgerRef.current ? prev : ledgerRef.current))
    }, LEDGER_FLUSH_MS)
    return () => clearInterval(tick)
  }, [])

  const image = useCallback((url: string, size: 'card' | 'full' = 'card') => {
    const src = budgetedImage(url, budget, size)
    // Only a photo the *saver* shrank counts: with the saver off, a 400px card is simply the right
    // size for a card, and claiming it as a saving would be a number we made up.
    if (!state.on || !src) return src
    const width = size === 'full' ? budget.fullWidth : budget.cardWidth
    const key = `${src}@${width}`
    if (!countedRef.current.has(key)) {
      countedRef.current.add(key)
      const next = noteLedger(ledgerRef.current, width, budget.quality)
      if (next !== ledgerRef.current) ledgerRef.current = next
    }
    return src
  }, [budget, state.on])

  const setOn = useCallback((on: boolean) => {
    const next: SaverChoice = on ? 'on' : 'off'
    setChoice(next)
    writeStored(next)
  }, [])

  const toggle = useCallback(() => setOn(!state.on), [setOn, state.on])

  const value = useMemo<DataSaverValue>(() => ({
    on: state.on,
    source: state.source,
    reason: state.reason,
    budget,
    ledger,
    ledgerLine: ledgerLineFor(ledger),
    image,
    setOn,
    toggle,
  }), [state, budget, ledger, image, setOn, toggle])

  return <DataSaverContext.Provider value={value}>{children}</DataSaverContext.Provider>
}

/**
 * The setting, from anywhere.
 *
 * Outside the provider (a test render, a page mounted on its own) this falls back to the plain
 * default rather than throwing: a data saver that takes a screen down is worse than one that is
 * merely on.
 */
export function useDataSaver(): DataSaverValue {
  const ctx = useContext(DataSaverContext)
  const fallback = useMemo<DataSaverValue>(() => {
    const state = resolveDataSaver(null, null)
    const budget = imageBudget(state)
    return {
      on: state.on,
      source: state.source,
      reason: state.reason,
      budget,
      ledger: EMPTY_LEDGER,
      ledgerLine: ledgerLineFor(EMPTY_LEDGER),
      image: (url: string, size: 'card' | 'full' = 'card') => budgetedImage(url, budget, size),
      setOn: () => { /* no provider, so nothing to store it in */ },
      toggle: () => { /* no provider, so nothing to store it in */ },
    }
  }, [])
  return ctx || fallback
}
