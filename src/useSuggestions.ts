/**
 * Type-ahead suggestions, built **only** from things that exist in rachett:
 * store names (and their previous names), product names from the catalogue we've
 * loaded, the real category list, and the person's own recent searches.
 *
 * Nothing is ever invented here — if a suggestion can't be tapped into, it isn't
 * in this list. That means the list can be *incomplete* (we only know the products
 * we've loaded, so far) but never wrong, which is the trade the product asked for:
 * never auto-complete the name of something that isn't on rachett.
 *
 * The matcher is pure so its ranking, per-kind caps and dedupe can be verified in
 * a plain Node script.
 */
export type SuggestionKind = 'store' | 'product' | 'category' | 'recent'

export interface Suggestion {
  kind: SuggestionKind
  /** Unique within a list. */
  id: string
  label: string
  /** Secondary line: the store, or the category. */
  sub?: string
  slug?: string
  productId?: string
  imageUrl?: string
}

export interface SuggestionSources {
  products: {
    id: string
    name: string
    sellerSlug: string
    businessName?: string
    imageUrl?: string
    category?: string
  }[]
  stores: { slug: string; businessName: string; aliases?: string[]; logoUrl?: string }[]
  categories: string[]
  recentSearches?: string[]
}

/** How well `label` answers what was typed. 0 = no match at all. */
export function matchScore(label: string, query: string): number {
  const l = label.toLowerCase().trim()
  const q = query.toLowerCase().trim()
  if (!q || !l) return 0
  if (l.startsWith(q)) return 2
  const idx = l.indexOf(q)
  if (idx < 0) return 0
  // A match at a word start ("blue dress" ← "dress") is worth more than mid-word.
  return /[\s\-_/]/.test(l[idx - 1] || '') ? 1.4 : 1
}

/** One row per real thing: a shop, a product, a category, a past search. */
export function identityOf(suggestion: Suggestion): string {
  if (suggestion.kind === 'store') return `store:${suggestion.slug ?? suggestion.label}`
  if (suggestion.kind === 'product') return `product:${suggestion.productId ?? suggestion.label}`
  return `${suggestion.kind}:${suggestion.label.toLowerCase()}`
}

const KIND_WEIGHT: Record<SuggestionKind, number> = {
  store: 1.25,
  product: 1.2,
  category: 1.05,
  recent: 1,
}

/** How many of each kind may appear, so one source can't crowd out the rest. */
const KIND_CAP: Record<SuggestionKind, number> = { store: 3, product: 3, category: 2, recent: 2 }

export function buildSuggestions(query: string, sources: SuggestionSources, limit = 6): Suggestion[] {
  const q = query.trim()
  if (!q) return []
  const qLower = q.toLowerCase()

  /** Best row per real thing — a shop matched by name *and* alias still gets one line. */
  const best = new Map<string, { suggestion: Suggestion; score: number }>()
  const offer = (suggestion: Suggestion, matchedText: string) => {
    // Pointless if the row would just repeat what was typed.
    if (suggestion.label.toLowerCase().trim() === qLower) return
    const score = matchScore(matchedText, q) * KIND_WEIGHT[suggestion.kind]
    if (score <= 0) return
    const key = identityOf(suggestion)
    const current = best.get(key)
    if (!current || score > current.score) best.set(key, { suggestion, score })
  }

  for (const store of sources.stores) {
    const row: Suggestion = {
      kind: 'store',
      id: `store-${store.slug}`,
      label: store.businessName,
      slug: store.slug,
      imageUrl: store.logoUrl,
      sub: 'Store',
    }
    offer(row, store.businessName)
    // A previous name still finds the shop — and shows under its current name.
    for (const alias of store.aliases || []) {
      offer({ ...row, id: `store-alias-${store.slug}-${alias}`, sub: `Store · was “${alias}”` }, alias)
    }
  }

  for (const product of sources.products) {
    offer({
      kind: 'product',
      id: `product-${product.id}`,
      label: product.name,
      slug: product.sellerSlug,
      productId: product.id,
      imageUrl: product.imageUrl,
      sub: product.businessName ? `Product · ${product.businessName}` : 'Product',
    }, product.name)
  }

  for (const category of sources.categories) {
    offer({ kind: 'category', id: `category-${category}`, label: category, sub: 'Category' }, category)
  }

  for (const term of sources.recentSearches || []) {
    offer({ kind: 'recent', id: `recent-${term}`, label: term, sub: 'Recent search' }, term)
  }

  const ranked = [...best.values()].sort((a, b) => b.score - a.score)

  const perKind: Record<string, number> = {}
  const out: Suggestion[] = []
  for (const { suggestion } of ranked) {
    const used = perKind[suggestion.kind] || 0
    if (used >= KIND_CAP[suggestion.kind]) continue
    perKind[suggestion.kind] = used + 1
    out.push(suggestion)
    if (out.length >= limit) break
  }
  return out
}
