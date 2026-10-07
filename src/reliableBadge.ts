/**
 * Reliable Seller Badge (💎) — the one badge rachett measures for itself.
 *
 * The 🟢 Real Seller badge asks a question a seller can answer about themselves ("did I finish
 * my profile?"). This badge asks two questions only rachett can answer, because only rachett sits
 * on top of every order and every private thread:
 *
 *   - do you finish the orders you take?      completion rate ≥ 80%
 *   - do you answer your buyers quickly?      average first reply < 2 hours
 *
 * Both numbers are written to `sellers/{uid}/stats/main` by the Cloud Functions in
 * `functions/sellerStats.js` — never by the browser — so a seller cannot hand themselves the badge.
 * That file owns the *math* that produces the two numbers; this one owns the *rule* the app
 * judges them by, so the number is never born in the same place it is judged.
 *
 * `_reliable_check.cjs` requires this file (compiled) and `functions/sellerStats.js` together and
 * proves the two halves still agree — thresholds, rounding and all.
 */

/** Share of orders that must reach `fulfilled`, out of every order the shop received. */
export const RELIABLE_COMPLETION_PCT = 80

/** A seller must answer within this many minutes, on average, to stay Reliable. */
export const RELIABLE_MAX_RESPONSE_MINUTES = 120

/** The two server-written numbers, plus the badge they stand on. */
export interface ReliableSignals {
  /** 🟢 first — Reliable rides on top of the identity badge, exactly as the old 🔵 did. */
  realSeller: boolean
  /** Completed orders ÷ every order received, as a whole percent. `null` until rachett has measured. */
  orderCompletionRate: number | null
  /** Orders the shop has received (the denominator). `0` means "nothing to judge yet". */
  totalOrders: number
  /** Rachett's own average first-reply time, in minutes. `null` until a reply exists. */
  avgResponseMinutes: number | null
}

/**
 * The rule, in one place.
 *
 * `realSeller` is a hard prerequisite and `totalOrders` is read on purpose: a shop that has
 * received no orders has no completion rate, and "nothing ÷ nothing" must never round up to a
 * passing 100%. There is no minimum order count here by decision — one order, answered quickly
 * and finished, is enough.
 */
export function meetsReliableCriteria({
  realSeller,
  orderCompletionRate,
  totalOrders,
  avgResponseMinutes,
}: ReliableSignals): boolean {
  if (!realSeller) return false
  if (totalOrders <= 0 || orderCompletionRate === null) return false
  if (orderCompletionRate < RELIABLE_COMPLETION_PCT) return false
  if (avgResponseMinutes === null || avgResponseMinutes >= RELIABLE_MAX_RESPONSE_MINUTES) return false
  return true
}

/** Every number the seller's own progress card draws, derived the same way the badge is. */
export interface ReliableProgress {
  realSellerMet: boolean
  orderCompletionRate: number | null
  completedOrders: number
  totalOrders: number
  completionMet: boolean
  avgResponseMinutes: number | null
  responseMet: boolean
  earned: boolean
}

/**
 * The card's numbers, from the same signals the badge reads — so a bar can never look full while
 * the chip stays hidden. `completedOrders` is display-only (the "10 of 16" line), never judged.
 */
export function reliableProgress(
  signals: ReliableSignals & { completedOrders?: number },
): ReliableProgress {
  const completionMet = signals.orderCompletionRate !== null
    && signals.totalOrders > 0
    && signals.orderCompletionRate >= RELIABLE_COMPLETION_PCT
  const responseMet = signals.avgResponseMinutes !== null
    && signals.avgResponseMinutes < RELIABLE_MAX_RESPONSE_MINUTES
  return {
    realSellerMet: signals.realSeller,
    orderCompletionRate: signals.orderCompletionRate,
    completedOrders: signals.completedOrders ?? 0,
    totalOrders: signals.totalOrders,
    completionMet,
    avgResponseMinutes: signals.avgResponseMinutes,
    responseMet,
    earned: meetsReliableCriteria(signals),
  }
}

/** `45 min`, `1.8 hrs`, `5 hrs` — the shortest honest way to say a reply time. */
export function formatResponseMinutes(minutes: number): string {
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  return hours < 10 ? `${hours.toFixed(1)} hrs` : `${Math.round(hours)} hrs`
}
