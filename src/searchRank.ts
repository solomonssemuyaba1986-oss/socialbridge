/**
 * Search that answers the question that was actually asked.
 *
 * Written against the four complaints a search box earns:
 *
 *  1. **"I typed `sneekers` and it found nothing."** One typo is not a reason to lose a sale, so a
 *     token close enough to a real word (one edit for short words, two for long ones) still counts.
 *  2. **"I typed `fridge` and it skipped every listing that says `refrigerator`."** The words the
 *     market here actually uses live in `SYNONYM_GROUPS` below — one line per idea, no model, no
 *     guessing.
 *  3. **"It showed me 40 things and mine was at the bottom."** Every result is scored: *where* it
 *     matched (the name beats the description), how well the words matched, and how well it sells.
 *  4. **"It found everything, which is the same as finding nothing."** Every word in the query must
 *     match something. Searching `red shoes` never returns a red kettle.
 *
 * And when nothing matches, `didYouMean` offers the correction off the real words on the market,
 * instead of leaving a person to guess what we wanted them to type.
 *
 * Everything here is pure, so all of the above is checked in Node (`_search_rank_check.cjs`)
 * rather than trusted in the browser.
 */

/** The parts of a product this module reads — every product card already satisfies it. */
export interface Searchable {
  name?: string
  description?: string
  businessName?: string
  category?: string
  subCategory?: string
  /** Sold before, or asked for before — the tie-break between equally good matches. */
  orderCount?: number
  salesCount?: number
  /** Out of stock is still shown; it just never wins a tie against something in stock. */
  outOfStock?: boolean
}

/**
 * The words people here use for the same thing. Add a line, and search understands it everywhere
 * (products, shops, categories) — nothing else has to change.
 */
export const SYNONYM_GROUPS: string[][] = [
  ['phone', 'phones', 'mobile', 'smartphone', 'handset', 'simu'],
  ['laptop', 'laptops', 'computer', 'notebook', 'pc'],
  ['fridge', 'refrigerator', 'freezer', 'deep freezer'],
  ['tv', 'television', 'screen', 'televisions'],
  ['shoes', 'sneakers', 'trainers', 'footwear', 'boots', 'sneaker'],
  ['sandal', 'sandals', 'slippers', 'flipflops', 'flip flops'],
  ['bag', 'bags', 'handbag', 'purse', 'backpack', 'rucksack', 'sack'],
  ['dress', 'gown', 'frock'],
  ['shirt', 'tshirt', 't-shirt', 'blouse', 'top'],
  ['trouser', 'trousers', 'pants', 'jeans', 'denim'],
  ['jacket', 'coat', 'hoodie', 'sweater', 'sweatshirt', 'cardigan'],
  ['earphones', 'headphones', 'earbuds', 'airpods', 'headset', 'earpiece'],
  ['charger', 'adaptor', 'adapter', 'cable', 'cord', 'usb cable'],
  ['powerbank', 'power bank', 'power banks', 'battery pack'],
  ['speaker', 'speakers', 'woofer', 'subwoofer', 'bluetooth speaker', 'sound system'],
  ['solar', 'solar panel', 'panels', 'inverter', 'solar light'],
  ['cooker', 'stove', 'jiko', 'cooking stove', 'gas cooker'],
  ['blender', 'mixer', 'juicer', 'liquidiser'],
  ['kettle', 'jug', 'flask', 'thermos'],
  ['bucket', 'basin', 'pail', 'jerrycan'],
  ['sofa', 'couch', 'settee', 'seater'],
  ['bed', 'bedframe', 'bed frame'],
  ['bedsheet', 'bed sheet', 'bedsheets', 'duvet', 'blanket', 'bedcover', 'comforter', 'bedding'],
  ['towel', 'towels', 'tissue', 'napkin'],
  ['perfume', 'cologne', 'fragrance', 'scent', 'spray'],
  ['cream', 'lotion', 'moisturiser', 'moisturizer', 'jelly'],
  ['makeup', 'cosmetics', 'beauty', 'beauty products'],
  ['watch', 'wristwatch', 'smartwatch', 'timepiece'],
  ['chair', 'stool', 'seat'],
  ['table', 'desk', 'tables'],
  ['baby', 'infant', 'newborn', 'toddler'],
  ['school', 'schoolbag', 'exercise book', 'stationery', 'school bag'],
  ['brake', 'brakes', 'brake pad', 'brake pads'],
  ['tyre', 'tire', 'tyres', 'tires'],
]

/** Words nobody searches for on purpose — dropped so "shoes for men" is two words, not four. */
const NOISE = new Set([
  'a', 'an', 'the', 'of', 'for', 'and', 'or', 'in', 'on', 'with', 'to', 'is', 'it',
  'my', 'me', 'i', 'do', 'you', 'am', 'at', 'from', 'by', 'any', 'some',
])


/** Lowercase, strip anything that is not a letter or a digit, collapse the spaces. */
export function normalise(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/** The words we score on: noise removed, duplicates gone, order kept. */
export function queryTokens(query: string): string[] {
  const raw = normalise(query).split(' ').filter(Boolean)
  const kept = raw.filter(t => !NOISE.has(t))
  // A query of nothing but noise ("the of") is still a query — better to search it than ignore it.
  return [...new Set(kept.length > 0 ? kept : raw)]
}

/**
 * Two words that mean the same thing to a shopper, made comparable: `shoes` and `shoe`,
 * `phones` and `phone`. Crude on purpose — an English stemmer is not worth a dependency here.
 */
export function stem(word: string): string {
  const w = normalise(word)
  if (w.length <= 3) return w
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y'
  if (w.endsWith('ses') || w.endsWith('xes') || w.endsWith('hes')) return w.slice(0, -2)
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

/** Everything one typed word could also mean — itself first. */
export function tokenVariants(token: string): string[] {
  const t = stem(token)
  const out: string[] = [t]
  for (const group of SYNONYM_GROUPS) {
    if (!group.some(member => stem(member) === t)) continue
    for (const member of group) {
      const m = stem(member)
      if (m && !out.includes(m)) out.push(m)
    }
  }
  return out
}

function wordsOf(text: string): string[] {
  const n = normalise(text)
  return n ? n.split(' ') : []
}

/** Is `phrase` in `text` as whole words? ("bed sheet" is not "bed sheets of steel".) */
function hasPhrase(text: string, phrase: string): boolean {
  const n = normalise(text)
  const p = normalise(phrase)
  if (!n || !p) return false
  if (p.includes(' ')) return (` ${n} `).includes(` ${p} `)
  return n.split(' ').some(word => stem(word) === p)
}

/** Levenshtein, capped: as soon as the distance cannot be small enough we stop. */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost)
      if (row[j] < best) best = row[j]
    }
    if (best > max) return max + 1
    prev = row
  }
  return prev[b.length]
}

/** How many edits a token may be off by: short words are too easy to confuse, so they get none. */
export function typoBudget(token: string): number {
  const t = stem(token)
  if (t.length < 4) return 0
  return t.length >= 8 ? 2 : 1
}


/**
 * How well one token matches one piece of text, from 0 (not at all) to 1 (exactly what was typed).
 *
 * 1.00 its word starts with what they typed  (typing "sneak" reaches "sneakers")
 * 0.95 its word *is* the word, plurals aside
 * 0.70 the letters are in there somewhere   (a last resort, not a first choice)
 * 0.50 one small typo away                  (their spelling is not our rule)
 * 0.45 it is a word the market uses for it  (fridge ⇄ refrigerator)
 */
export function matchTier(text: string, token: string): number {
  if (!text || !token) return 0
  const t = stem(token)
  const words = wordsOf(text)

  for (const w of words) {
    if (w.startsWith(t)) return 1
  }
  for (const w of words) {
    if (stem(w) === t) return 0.95
  }
  if (normalise(text).includes(t)) return 0.7

  const budget = typoBudget(token)
  if (budget > 0) {
    for (const w of words) {
      if (editDistance(stem(w), t, budget) <= budget) return 0.5
    }
  }
  for (const variant of tokenVariants(token)) {
    if (variant === t) continue
    for (const w of words) {
      if (stem(w) === variant || w.startsWith(variant)) return 0.45
    }
  }
  // A phrase synonym ("power bank") that the listing carries as one word ("powerbank").
  for (const variant of tokenVariants(token)) {
    if (hasPhrase(text, variant)) return 0.45
  }
  return 0
}

/** The fields we read, and what each one is worth when it is the field that matched. */
const FIELD_WEIGHTS: { field: keyof Searchable; weight: number }[] = [
  { field: 'name', weight: 3 },
  { field: 'subCategory', weight: 2 },
  { field: 'category', weight: 1.8 },
  { field: 'businessName', weight: 1.6 },
  { field: 'description', weight: 0.7 },
]

export function popularity(product: Searchable): number {
  const orders = Number(product.orderCount) || 0
  const sales = Number(product.salesCount) || 0
  return orders + sales
}

/**
 * 0 means "this is not what they asked for" — such a product is dropped, not shown lower down.
 *
 * The score is: every word must match something (the highest-scoring field wins for that word),
 * plus a bonus when the whole query appears, plus a small nod to what actually sells.
 */
export function productScore(product: Searchable, query: string): number {
  const tokens = queryTokens(query)
  if (tokens.length === 0) return 0

  let score = 0
  for (const token of tokens) {
    let best = 0
    for (const { field, weight } of FIELD_WEIGHTS) {
      const value = product[field]
      if (typeof value !== 'string') continue
      const tier = matchTier(value, token)
      if (tier * weight > best) best = tier * weight
    }
    if (best === 0) return 0 // one unmatched word and this is somebody else's product
    score += best
  }

  const phrase = normalise(query)
  if (phrase.includes(' ')) {
    if (hasPhrase(product.name || '', phrase)) score += 1.5
    else {
      const anywhere = FIELD_WEIGHTS.some(({ field }) => {
        const value = product[field]
        return typeof value === 'string' && normalise(value).includes(phrase)
      })
      if (anywhere) score += 0.8
    }
  }

  // Never the decider, only the tie-break: up to half a point for what has sold before.
  score += Math.min(popularity(product), 50) / 100
  // An item you cannot buy today is still worth finding, but never ahead of one you can — the
  // penalty below is for the number, and `rankProducts` enforces the ordering itself.
  if (product.outOfStock === true) score -= 0.25
  return score
}

/**
 * The search itself. An empty query is not a search — it returns the list untouched, in the order
 * the page had it (newest, popular, whatever that surface decided).
 */
export function rankProducts<T extends Searchable>(products: T[], query: string): T[] {
  const tokens = queryTokens(query)
  if (tokens.length === 0) return [...products]

  return products
    .map(product => ({ product, score: productScore(product, query) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => {
      // Something you can buy today comes first, whatever the numbers say: a perfect match nobody
      // can add to a bag is a dead end, and a dead end is the one thing a search must never end on.
      const stock = Number(a.product.outOfStock === true) - Number(b.product.outOfStock === true)
      if (stock !== 0) return stock
      if (b.score !== a.score) return b.score - a.score
      const pop = popularity(b.product) - popularity(a.product)
      if (pop !== 0) return pop
      return (a.product.name || '').localeCompare(b.product.name || '')
    })
    .map(entry => entry.product)
}

/**
 * Every word worth correcting to — the real words on the market, so a suggestion is always a word
 * that something here actually carries. Most-used words first.
 */
export function vocabularyFrom(products: Searchable[]): string[] {
  const counts = new Map<string, number>()
  const add = (value: unknown) => {
    if (typeof value !== 'string') return
    for (const word of wordsOf(value)) {
      if (word.length < 4 || NOISE.has(word)) continue
      counts.set(word, (counts.get(word) || 0) + 1)
    }
  }
  for (const product of products) {
    add(product.name)
    add(product.subCategory)
    add(product.category)
    add(product.businessName)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([word]) => word)
}

/**
 * "Did you mean …?" — built from the words the market really uses, one word replaced at a time, so
 * the rest of what they typed is never thrown away. Returns [] when we have nothing better to say.
 */
export function didYouMean(query: string, vocabulary: string[], limit = 1): string[] {
  const tokens = queryTokens(query)
  if (tokens.length === 0) return []

  const words = tokens.map(token => {
    const typed = normalise(token)
    let best = ''
    let bestDistance = 99
    for (const candidate of vocabulary) {
      // Already a real word (plurals aside)? Then there is nothing to correct here.
      if (candidate === typed || stem(candidate) === stem(typed)) return typed
      const budget = typoBudget(typed)
      if (budget === 0) continue
      const distance = editDistance(stem(candidate), stem(typed), budget)
      if (distance <= budget && distance < bestDistance) {
        best = candidate
        bestDistance = distance
      }
    }
    return best || typed
  })

  const suggestion = words.join(' ')
  if (suggestion === tokens.join(' ')) return []
  return [suggestion].slice(0, Math.max(1, limit))
}

/** The line above the results. `count` is what the page is about to draw, so the two never disagree. */
export function searchLine(count: number, query: string): string {
  const term = query.trim()
  if (!term) return ''
  if (count === 0) return `Nothing here matches “${term}” yet.`
  return `${count} result${count === 1 ? '' : 's'} for “${term}”`
}

/**
 * What to say when there is nothing to show. Never a bare "no results" — a dead end is what makes
 * someone close the app — so this gives a correction when we have one, and an honest next step when
 * we do not.
 */
export function emptySearchHelp(
  query: string,
  vocabulary: string[],
): { title: string; suggestion: string; note: string } {
  const term = query.trim()
  const [suggestion = ''] = didYouMean(query, vocabulary)
  if (suggestion) {
    return {
      title: `Nothing matched “${term}” — did you mean “${suggestion}”?`,
      suggestion,
      note: 'Tap the correction to search it, or ask a seller in the chat — they answer with a price and a photo.',
    }
  }
  return {
    title: `Nothing here matches “${term}” yet.`,
    suggestion: '',
    note: 'Try fewer words, or the word a seller would use (“fridge”, “sneakers”, “power bank”). Any seller can be asked for it in the chat.',
  }
}
