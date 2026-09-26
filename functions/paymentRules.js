/**
 * The decisions that must be identical for every payment processor we speak to.
 *
 * Pesapal and pawaPay are very different APIs making the same promises, and these are three of them:
 *
 *   1. a completed payment for the wrong amount is ours to flag, not theirs to hide
 *   2. applying the same status twice changes nothing (both of them retry by design)
 *   3. a late FAILED never un-pays an order, and money arriving late never undoes a seller's work
 *
 * The fourth promise — that a status only ever comes from the processor — is enforced by never
 * letting a request body carry one, so it is not a decision this file has to make.
 *
 * It is pure so `_payments_check.cjs` can pin every combination without a key or a network, and it
 * is the single source of the subtle part: the write that follows is mechanical.
 */
function decideOutcome({ providerStatus, paid, amountMatches, orderStatus, paymentStatus }) {
  const alreadyPaid = orderStatus === 'paid' || paymentStatus === 'completed'
  const mismatch = paid === true && amountMatches === false

  let resolved = mismatch ? 'review' : providerStatus
  let note = ''
  if (alreadyPaid && resolved !== 'completed') {
    note = `A later ${resolved} status was ignored: this order was already paid.`
    resolved = 'completed'
  }

  const applied = paid === true && !mismatch && !alreadyPaid
  // Only an order still waiting to be dealt with moves to `paid`. A seller who has already delivered
  // keeps their status — money arriving late must not undo their work.
  const nextOrderStatus = applied && (!orderStatus || orderStatus === 'pending' || orderStatus === 'awaiting_payment')
    ? 'paid'
    : null

  return { resolved, note, alreadyPaid, mismatch, applied, nextOrderStatus }
}

/** Does what the processor says match what the order asked for? `null` when there is nothing to compare. */
function amountAgrees(expected, paidAmount, paidCurrency) {
  const wanted = Number(expected && expected.amount)
  const got = Number(paidAmount)
  if (!Number.isFinite(wanted) || !Number.isFinite(got) || got <= 0) return null
  const currency = String((expected && expected.currency) || '').toUpperCase()
  const paid = String(paidCurrency || '').toUpperCase()
  if (currency && paid && currency !== paid) return false
  // Mobile money is whole units; a card can carry cents. A quarter of a unit of slack absorbs the
  // rounding a processor may do on a currency with no minor unit.
  return Math.abs(wanted - got) < 0.25
}

module.exports = { decideOutcome, amountAgrees }
