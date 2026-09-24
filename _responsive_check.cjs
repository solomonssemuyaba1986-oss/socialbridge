/**
 * Dev-only harness for the phone layout — the things a stylesheet cannot check about itself.
 *
 *   node _responsive_check.cjs        (then: npm run build && npm run lint)
 *
 * Every rule below is here because it broke rachett on a phone, or because it would break it again
 * silently: a 260px sidebar on a 360px screen, a dialog left floating in the middle with the
 * keyboard over it, a screen still measuring itself in `vh`, a class that only exists in the JSX (or
 * only in the CSS), a second copy of the seller's navigation, and the missing line that lets a
 * megabyte of markup slide sideways.
 *
 * It reads files. It does not run the app — `npm run build` and `npm run lint` still have to pass.
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const SRC = path.join(__dirname, 'src')
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8')

const tsxFiles = fs.readdirSync(SRC).filter(f => f.endsWith('.tsx') || f.endsWith('.ts'))
const cssFiles = fs.readdirSync(SRC).filter(f => f.endsWith('.css'))
const jsxText = tsxFiles.map(file => ({ file, text: read(file) }))
const cssText = cssFiles.map(file => ({ file, text: read(file) }))
const css = cssText.map(f => f.text).join('\n')
const indexCss = read('index.css')

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Classes the stylesheets define — including the few inline `<style>` blocks in components.
 *  Comments are stripped first: this file's own notes talk about classes by name, and prose about a
 *  class is not a definition of one. */
function definedClasses() {
  const set = new Set()
  for (const { text } of [...cssText, ...jsxText]) {
    for (const m of stripComments(text).matchAll(/\.(rt-[a-z0-9-]+)/g)) set.add(m[1])
  }
  return set
}

/**
 * Keyframe names. They are an implementation detail of an `animation:` declaration, so no component
 * ever names one in JSX — which is exactly why they are allowed to exist without being asked for.
 */
function definedKeyframes() {
  const set = new Set()
  for (const { text } of [...cssText, ...jsxText]) {
    for (const m of stripComments(text).matchAll(/@keyframes\s+(rt-[a-z0-9-]+)/g)) set.add(m[1])
  }
  return set
}

/** Classes some component actually asks for — including the ones chosen by a ternary. */
function usedClasses() {
  const set = new Set()
  for (const { text } of jsxText) {
    for (const m of stripComments(text).matchAll(/\brt-[a-z0-9-]+/g)) set.add(m[0])
  }
  return set
}

/** Every JSX line, with its file and number, so a failure can name the place. */
const jsxLines = []
for (const { file, text } of jsxText) {
  text.split(/\r?\n/).forEach((line, i) => jsxLines.push({ file, line, n: i + 1 }))
}
const find = (needle) => jsxLines.filter(l => l.line.includes(needle))
const at = (l) => `${l.file}:${l.n}`

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }

check('no page is still offset by the desktop sidebar', () => {
  const shells = find('marginLeft: 260')
  assert.strictEqual(shells.length, 3, 'the three seller shells (Dashboard / Orders / Analytics)')
  const undressed = shells.filter(l => !l.line.includes('rt-main'))
  assert.deepStrictEqual(undressed.map(at), [],
    'marginLeft: 260 without rt-main — on a 390px phone that leaves the panel 130px to work in')
  assert.ok(fs.existsSync(path.join(SRC, 'SellerTabs.tsx')), 'the phone navigation must exist')
})

check('every dialog becomes a bottom sheet on a phone', () => {
  const dialogs = jsxLines.filter(l =>
    l.line.includes("position: 'fixed', top: 0, left: 0, right: 0, bottom: 0") &&
    l.line.includes('zIndex: 1000'))
  assert.ok(dialogs.length >= 15, `expected the app's dialogs, found ${dialogs.length}`)
  const missing = dialogs.filter(l => {
    if (l.line.includes('rt-modal-overlay')) return false
    // A couple of dialogs put className on the line above the style prop.
    const prev = jsxLines[jsxLines.indexOf(l) - 1]
    return !(prev && prev.file === l.file && prev.line.includes('rt-modal-overlay'))
  })
  assert.deepStrictEqual(missing.map(at), [], 'this dialog would float in the middle of the screen')
})

check('the screens that are meant to be full-screen still are', () => {
  // A sheet rising from the bottom is right for a question and wrong for an interruption: the splash,
  // the offline curtain, the "no connection at all" wall and the photo viewer own the whole screen.
  const fullScreen = ['Splash.tsx', 'NetworkGuard.tsx', 'OfflineScreen.tsx', 'ProductPreview.tsx']
  for (const file of fullScreen) {
    const overlays = jsxLines.filter(l => l.file === file && l.line.includes("position: 'fixed'"))
    assert.ok(overlays.length > 0, `${file} should still have its full-screen overlay`)
    for (const l of overlays) {
      assert.ok(!l.line.includes('rt-modal-overlay'), `${at(l)} is a screen, not a sheet`)
    }
  }
})

check('the draft sheet clears the tab bar', () => {
  const sheet = jsxLines.filter(l => l.file === 'DraftResumeSheet.tsx' && l.line.includes('rt-sheet'))
  assert.strictEqual(sheet.length, 1, 'the resume sheet rises from the bottom and must outrank the bar')
  assert.ok(/\.rt-sheet \{\s*z-index: 1000/.test(css), 'and the stylesheet must agree')
})

check('no component asks for a class that does not exist', () => {
  const known = new Set([...definedClasses(), ...definedKeyframes()])
  const missing = [...usedClasses()].filter(c => !known.has(c))
  assert.deepStrictEqual(missing, [], `used but never defined: ${missing.join(', ')}`)
})

check('no class exists in the stylesheet that nothing asks for', () => {
  const used = usedClasses()
  const unused = [...definedClasses()].filter(c => !used.has(c)).sort()
  assert.deepStrictEqual(unused, [], `defined but never used: ${unused.join(', ')}`)
})

check('nothing is pinned to a width a phone cannot give it', () => {
  // Look behind for a letter *and* a hyphen: `max-width`/`min-width` are caps, not fixed sizes.
  const fixed = /(?<![a-zA-Z-])width: '?(\d{3,})/
  assert.ok(fixed.test('width: 400'), 'the detector finds a fixed width')
  assert.ok(!fixed.test('max-width: 720px'), 'and leaves max-width alone')
  assert.ok(!fixed.test('minWidth: 240'), 'and minWidth')
  const offenders = jsxLines.filter(l => {
    const m = l.line.match(fixed)
    return m && Number(m[1]) >= 320
  })
  assert.deepStrictEqual(offenders.map(at), [],
    'a fixed width of 320px or more is a horizontal scrollbar on a 320px phone')
})

check('no screen measures itself in vh again', () => {
  const bare = /(?<![a-z])vh\b/
  assert.ok(bare.test('90vh'), 'the detector finds a bare vh')
  assert.ok(!bare.test('92dvh'), 'and leaves dvh alone')
  /** The one honest use of vh: a fallback on the line directly above the same property in dvh. */
  const isFallback = (line, next) =>
    Boolean(next) && /dvh/.test(next) && next.trim().split(':')[0] === line.trim().split(':')[0]
  assert.ok(isFallback('  min-height: 100vh !important;', '  min-height: 100dvh !important;'),
    'and it recognises the fallback it is written above')
  const offenders = []
  for (const { file, text } of cssText) {
    const body = stripComments(text).split(/\r?\n/)
    body.forEach((line, i) => {
      if (!bare.test(line)) return
      if (isFallback(line, body[i + 1])) return
      offenders.push(`${file}:${i + 1}`)
    })
  }
  assert.deepStrictEqual(offenders, [], 'use dvh — vh is taller than a phone with its URL bar showing')
  assert.ok(/max-height: 92dvh !important/.test(css), 'the sheet height leaves room for the URL bar')
  assert.ok(/min-height: 100dvh !important/.test(indexCss), 'and so does a full screen')
})

check('the sidebar and the tab bar never show at the same time', () => {
  assert.ok(/@media \(max-width: 768px\) \{[\s\S]*?\.rt-sidebar \{\s*display: none !important/.test(css),
    'on a phone the sidebar is replaced, not squeezed')
  assert.ok(/@media \(min-width: 769px\) \{[\s\S]*?\.rt-tabs,[\s\S]*?display: none !important/.test(css),
    'on desktop the tab bar goes and the sidebar is the navigation')
})

check('the tab bar and the space left for it agree', () => {
  assert.ok(/--rt-tabs: 62px/.test(indexCss), 'one height, named once')
  assert.ok(/padding-bottom: calc\(var\(--rt-tabs\) \+ var\(--rt-safe-bottom\) \+ 20px\)/.test(css),
    'the content padding is derived from the same variable, so the two cannot drift')
})

check('the keyboard and the notch are both handled', () => {
  assert.ok(/input,\s*select,\s*textarea \{\s*font-size: 16px !important/.test(css),
    'under 16px, iOS zooms into the field and never comes back')
  assert.ok(/--rt-safe-bottom: env\(safe-area-inset-bottom, 0px\)/.test(indexCss), 'the home indicator')
  assert.ok(/\.rt-fab \{\s*bottom: calc\(24px \+ var\(--rt-safe-bottom\)\)/.test(indexCss),
    'the floating bag button must clear the home indicator')
  assert.ok(/\.rt-modal-overlay > div \{/.test(css),
    'every dialog here is <overlay><div box/></overlay>, so one rule keeps every box a sheet')
})

check('the browser is told this is a phone', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
  const meta = html.match(/<meta name="viewport"[^>]*>/)
  assert.ok(meta, 'no viewport meta tag')
  assert.ok(meta[0].includes('width=device-width'), 'without this every phone renders at 980px wide')
  assert.ok(meta[0].includes('viewport-fit=cover'), 'without this every safe-area inset reports 0')
})

check('the two navigations share one definition', () => {
  const nav = read('sellerNav.ts')
  assert.strictEqual((nav.match(/tab: true/g) || []).length, 5, 'five tabs')
  assert.strictEqual((nav.match(/label: '/g) || []).length, 10, 'ten destinations in total')
  assert.ok(/badgeFor/.test(nav), 'one badge rule, shared')
  assert.ok(read('Sidebar.tsx').includes("from './sellerNav'"), 'the sidebar reads the shared list')
  assert.ok(read('SellerTabs.tsx').includes("from './sellerNav'"), 'so does the tab bar')
  assert.ok(!/const NAV_ITEMS/.test(read('Sidebar.tsx')), 'and neither keeps a second copy of it')
  assert.ok(!/const NAV_ITEMS/.test(read('SellerTabs.tsx')))
})

check('every screen uses dynamic height, so a URL bar cannot clip it', () => {
  const roots = find("minHeight: '100vh'")
  assert.ok(roots.length >= 20, `expected the app's screens, found ${roots.length}`)
  const undressed = roots.filter(l => !l.line.includes('rt-page') && !l.line.includes('rt-main'))
  assert.deepStrictEqual(undressed.map(at), [], 'add className="rt-page" (or rt-main) to this screen')
})

console.log('\n' + checks + ' responsive checks passed')


