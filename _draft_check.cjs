/**
 * Dev-only harness for the draft store (see `src/draftStore.ts`).
 *
 *   npx tsc --ignoreConfig src/draftStore.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Move-Item -Force _dsbuild/draftStore.js _dsbuild/draftStore.cjs   # package.json is "type": "module"
 *   node _draft_check.cjs
 *
 * Verifies the rules the Inbox relies on: legacy bare-string drafts still load,
 * empty text deletes, **nothing expires**, and the account copy stays capped.
 */
const assert = require('assert')
const path = require('path')
const {
  DRAFT_PREFIX,
  DRAFT_NONE,
  MAX_ACCOUNT_DRAFTS,
  MAX_DRAFT_TEXT,
  draftKey,
  draftAge,
  draftLabel,
  capDrafts,
  listDrafts,
  mergeDrafts,
  parseDraft,
  readDraft,
  removeDraft,
  writeDraft,
} = require(path.join(__dirname, '_dsbuild', 'draftStore.cjs'))

/** Same surface localStorage exposes, in memory. */
function mem() {
  const map = new Map()
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
    keys: () => [...map.keys()],
  }
}

const meta = (over = {}) => ({
  conversationId: 'convo_s1_b1',
  sellerId: 's1',
  buyerId: 'b1',
  counterpartName: 'Aisha Fabrics',
  counterpartRole: 'seller',
  productId: 'p1',
  productName: 'Kitenge Dress',
  productPrice: '45000',
  productImage: 'https://img/1.jpg',
  text: 'Is this still available?',
  at: 1_700_000_000_000,
  ...over,
})

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }

check('a legacy bare-string draft still loads with its text', () => {
  const s = mem()
  s.setItem(DRAFT_PREFIX + 'convo_s1_b1', 'halo')
  const got = readDraft(s, 'convo_s1_b1')
  assert.strictEqual(got.text, 'halo')
  assert.strictEqual(got.conversationId, 'convo_s1_b1')
  assert.strictEqual(got.at, 0)
  assert.strictEqual(listDrafts(s).length, 1)
})

check('JSON round-trips every field the Inbox row needs', () => {
  const s = mem()
  const written = meta()
  writeDraft(s, written)
  assert.deepStrictEqual(readDraft(s, written.conversationId), written)
  assert.strictEqual(s.getItem(draftKey(written.conversationId)) !== null, true)
  removeDraft(s, written.conversationId)
  assert.strictEqual(readDraft(s, written.conversationId), null)
})

check('empty text is a delete, never a stored blank', () => {
  const s = mem()
  writeDraft(s, meta({ text: 'typed something' }))
  writeDraft(s, meta({ text: '   ' }))
  assert.strictEqual(readDraft(s, 'convo_s1_b1'), null)
})

check('NOTHING EXPIRES — a draft from over a year ago is still listed', () => {
  const s = mem()
  const now = Date.now()
  const ancient = now - 400 * 24 * 60 * 60 * 1000
  writeDraft(s, meta({ conversationId: 'convo_old', text: 'still here?', at: ancient }))
  writeDraft(s, meta({ conversationId: 'convo_new', text: 'fresh', at: now }))
  const listed = listDrafts(s)
  assert.strictEqual(listed.length, 2)
  assert.deepStrictEqual(listed.map((d) => d.conversationId), ['convo_new', 'convo_old'])
  assert.strictEqual(draftAge(listed[1]), '400d ago')
})

check('the DRAFT_NONE placeholder is never a draft', () => {
  const s = mem()
  s.setItem(DRAFT_NONE, '{"text":"nothing"}')
  writeDraft(s, meta({ conversationId: 'convo_s1_b1', text: 'real' }))
  assert.strictEqual(listDrafts(s).length, 1)
})

check('merge keeps the newer text per conversation and never drops the account copy', () => {
  const s = mem()
  void s
  const local = [meta({ text: 'local newer', at: 200 }), meta({ conversationId: 'convo_only_local', text: 'l', at: 150 })]
  const account = [meta({ text: 'account older', at: 100 }), meta({ conversationId: 'convo_only_account', text: 'a', at: 120 })]
  const merged = mergeDrafts(local, account)
  assert.deepStrictEqual(merged.map((d) => d.conversationId).sort(), ['convo_only_account', 'convo_only_local', 'convo_s1_b1'])
  assert.strictEqual(merged.find((d) => d.conversationId === 'convo_s1_b1').text, 'local newer')
  assert.strictEqual(merged[0].at, 200)
})

check('the account copy is capped at 25, newest first', () => {
  assert.strictEqual(MAX_ACCOUNT_DRAFTS, 25)
  const many = Array.from({ length: 30 }, (_, i) => meta({ conversationId: 'convo_' + i, at: 1000 + i }))
  const capped = capDrafts(many)
  assert.strictEqual(capped.length, 25)
  assert.strictEqual(capped[0].conversationId, 'convo_29')
  assert.strictEqual(capped.some((d) => d.conversationId === 'convo_0'), false)
  assert.deepStrictEqual(capDrafts(many, 3).length, 3)
})

check('text is clipped to 500 characters', () => {
  const s = mem()
  writeDraft(s, meta({ text: 'x'.repeat(900) }))
  assert.strictEqual(readDraft(s, 'convo_s1_b1').text.length, MAX_DRAFT_TEXT)
})

check('labels and ages read like a human wrote them', () => {
  assert.strictEqual(draftLabel(meta()), 'Kitenge Dress')
  assert.strictEqual(draftLabel(meta({ productName: undefined })), 'Aisha Fabrics')
  assert.strictEqual(draftLabel(meta({ productName: undefined, counterpartName: '' })), 'Message')
  const now = 1_700_000_000_000
  assert.strictEqual(draftAge(meta({ at: now }), now), 'just now')
  assert.strictEqual(draftAge(meta({ at: now - 12 * 60000 }), now), '12m ago')
  assert.strictEqual(draftAge(meta({ at: now - 90 * 60000 }), now), '2h ago')
  assert.strictEqual(draftAge(meta({ at: now - 3 * 24 * 60 * 60000 }), now), '3d ago')
  assert.strictEqual(draftAge(meta({ at: 0 }), now), '')
})

check('malformed storage never throws', () => {
  const s = mem()
  s.setItem(DRAFT_PREFIX + 'convo_bad', '{not json')
  assert.strictEqual(readDraft(s, 'convo_bad'), null)
  assert.strictEqual(listDrafts(s).length, 0)
  assert.strictEqual(parseDraft(null), null)
})

console.log('\n' + checks + ' draft-store checks passed')
