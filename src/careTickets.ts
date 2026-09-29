/**
 * The thin write that files a care ticket.
 *
 * Everything about *what* a ticket says lives in `./care` — pure, checked in Node, and pinned to
 * `firestore.rules` by `_rules_check.cjs`. All that is left for this file is the one thing that
 * cannot be pure: handing the document to Firestore, and saying honestly what happened if it did
 * not land. A ticket that silently fails is worse than no ticket at all, because the buyer thinks
 * they are covered.
 *
 * The rules do the rest: only the author can read one (`resource.data.uid == request.auth.uid`),
 * and nothing may ever update or delete one — a ticket is a record, not a thread. Nothing here
 * posts into the buyer↔seller chat either, which is the point: a buyer should never have to choose
 * between being honest and keeping the peace.
 */
import { addDoc, collection, getDocs, limit, query, serverTimestamp, where } from 'firebase/firestore'
import { db, auth } from './firebase'
import { trackEvent } from './analytics'
import { careTicket, careTicketDoc, type CareContext, type CareTicket } from './care'

export type CareTicketResult = { ok: true; id: string } | { ok: false; reason: 'signin' | 'failed' }

/**
 * Send it. `nowMs` is passed in by callers that already know the time (and by the harness), and
 * defaults to the real clock for the screens.
 */
export async function submitCareTicket(input: {
  issue: unknown
  context?: CareContext
  note?: unknown
  photoUrls?: unknown
  nowMs?: number
}): Promise<CareTicketResult> {
  const user = auth.currentUser
  // The rules demand `request.auth` and read the author off the document, so there is nothing to
  // send without an account — and the screen is told *why*, so it can send them to sign in and come
  // straight back rather than showing a failure that looks like our fault.
  if (!user) return { ok: false, reason: 'signin' }

  const ticket = careTicket({ ...input, nowMs: input.nowMs ?? Date.now() })
  try {
    const ref = await addDoc(collection(db, 'careTickets'), {
      ...careTicketDoc(ticket, user.uid),
      // The server's clock, because the ticket's own `createdAtMs` is the buyer's phone — the clock
      // the buyer is shown, not the clock we are judged on.
      createdAt: serverTimestamp(),
    })
    trackEvent('care_ticket_sent', {
      issue: ticket.issue,
      topic: ticket.topic,
      photos: ticket.photoUrls.length,
      hasOrder: ticket.orderId !== '',
    })
    return { ok: true, id: ref.id }
  } catch (err) {
    console.error('Care ticket error:', err)
    return { ok: false, reason: 'failed' }
  }
}

/** A ticket as it comes back out of Firestore — the same shape, plus the document id. */
export interface StoredCareTicket extends CareTicket {
  id: string
}

/**
 * The buyer's own tickets, newest first.
 *
 * The query filters on `uid == me` — the only filter the rules will accept, and the only one that
 * matters. The order is applied here rather than in the query on purpose: an `orderBy` beside a
 * `where` needs a composite index, and a feature that only works once somebody has remembered to
 * deploy an index is a feature that will be missing on the day it is needed.
 */
export async function getMyCareTickets(max = 20): Promise<StoredCareTicket[]> {
  const user = auth.currentUser
  if (!user) return []
  try {
    const snap = await getDocs(query(collection(db, 'careTickets'), where('uid', '==', user.uid), limit(max)))
    return snap.docs
      .map(doc => {
        const data = doc.data() as Partial<CareTicket>
        return {
          ...data,
          id: doc.id,
          photoUrls: Array.isArray(data.photoUrls) ? data.photoUrls : [],
          status: 'open' as const,
          source: 'care' as const,
          createdAtMs: Number(data.createdAtMs) || 0,
          slaHours: Number(data.slaHours) || 0,
        } as StoredCareTicket
      })
      .sort((a, b) => b.createdAtMs - a.createdAtMs)
  } catch (err) {
    console.error('Care tickets read error:', err)
    return []
  }
}
