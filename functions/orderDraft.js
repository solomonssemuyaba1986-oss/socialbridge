/**
 * The server's reading of an order draft — shared by publishing, chat bubbles and stats.
 *
 * Kept pure (no Firestore, no React) so the rules that decide what a seller sees and what the chat
 * says can be checked without a database.
 */

/** `paying` and `abandoned` are the buyer's own business until money settles. Legacy orders are live. */
function isPublishedOrder(order) {
  return order && order.checkoutState !== 'paying' && order.checkoutState !== 'abandoned'
}

/** One line, cleaned into the shape the chat bubble stores. */
function cleanLine(line) {
  if (!line || typeof line !== 'object') return null
  const productName = String(line.productName || '').trim()
  if (!productName) return null
  const quantity = Math.min(Math.max(1, Math.floor(Number(line.quantity) || 1)), 99)
  return {
    ...(line.productId ? { productId: String(line.productId) } : {}),
    productName,
    productPrice: String(line.productPrice || ''),
    quantity,
    ...(line.productImage ? { productImage: String(line.productImage) } : {}),
    ...(line.color ? { color: String(line.color) } : {}),
    ...(line.size ? { size: String(line.size) } : {}),
  }
}

/** Every order — new `items[]` or old single-product — as lines. */
function itemsOf(order) {
  const stored = order && Array.isArray(order.items) ? order.items : []
  const lines = stored.map(cleanLine).filter(Boolean)
  if (lines.length > 0) return lines
  const one = cleanLine(order)
  return one ? [one] : []
}

function variantWords(line) {
  return [line && line.color, line && line.size]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(' / ')
}

/** "2 × Shirt · 1 × Shoes" — what the bubble shows under its order card. */
function lineWords(lines) {
  return (lines || [])
    .map(line => `${Number(line.quantity) || 1} × ${String(line.productName || '').trim()}`)
    .filter(Boolean)
    .join(' · ')
}

/** The one message that announces a published order in the buyer↔seller thread. */
function orderBubbleText(order, ref) {
  const lines = itemsOf(order)
  const units = lines.reduce((sum, line) => sum + (Number(line.quantity) || 1), 0)
  const variant = lines.length === 1 ? variantWords(lines[0]) : ''
  const suffix = lines.length > 1 ? ` · ${units} items` : (variant ? ` · ${variant}` : '')
  return `📦 Order placed — Ref: ${String(ref || '').trim()}${suffix}`
}

module.exports = { isPublishedOrder, itemsOf, lineWords, variantWords, orderBubbleText }
