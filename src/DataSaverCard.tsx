/**
 * The data saver, as a switch somebody can actually find.
 *
 * Three things this card refuses to do:
 *
 *  - **It does not pretend to be a gift.** Every figure on it is stated as an estimate over a
 *    documented original (`FULL_PHOTO_BYTES`) and says "about" (`sizeWords`), because a saving
 *    reported to the byte would be a number we could not stand behind on somebody else's phone.
 *  - **It does not hide who decided.** `source` is shown: if the phone's own Data Saver or a 3G
 *    connection turned it on, that is what the card says, and it says plainly that it was not our
 *    choice to make.
 *  - **It does not claim a lifetime total.** `ledgerLine` is this visit only — the one span of usage
 *    we can actually count.
 *
 * Built to drop into the buyer's profile *and* the seller's, so the two never grow different copies.
 */
import type { CSSProperties, ReactNode } from 'react'
import { useDataSaver } from './dataSaverLive'
import { imageBudget, savedBytes, sizeWords } from './dataSaver'

const green = '#adff2f'

const card: CSSProperties = {
  background: '#1a1a1a', border: '1px solid #262626', borderRadius: 16, padding: 16, marginBottom: 14,
}
const cardTitle: CSSProperties = { margin: '0 0 4px', color: '#fff', fontSize: 15, fontWeight: 800 }
const smallPrint: CSSProperties = { margin: '0 0 12px', color: '#888', fontSize: 13, lineHeight: 1.5 }
const panel: CSSProperties = {
  background: '#141414', border: '1px solid #262626', borderRadius: 12, padding: 12, marginBottom: 10,
}
const bullet: CSSProperties = { margin: '0 0 6px', color: '#ccc', fontSize: 13, lineHeight: 1.55 }

/** One line of what the setting does, with the number in the accent colour. */
function Does({ children }: { children: ReactNode }) {
  return <p style={bullet}>{children}</p>
}

export default function DataSaverCard({ showLedger = true }: { showLedger?: boolean }) {
  const saver = useDataSaver()
  const { budget } = saver
  /** What the same photo would have cost with the saver off — the comparison, stated out loud. */
  const full = imageBudget(false)
  const cheaperBy = sizeWords(savedBytes(budget.cardWidth, budget.quality))
  const fullCost = sizeWords(savedBytes(full.cardWidth, 'auto'))

  const who =
    saver.source === 'you'
      ? 'Your choice, on this phone. It stays until you change it.'
      : saver.source === 'network'
        ? 'Your phone or your connection asked for this. We did not choose it for you.'
        : 'Our default. Nothing about it is hidden — turn it off and every photo comes at full size.'

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={cardTitle}>Data saver</p>
          <p style={{ margin: 0, color: saver.on ? green : '#888', fontSize: 12, fontWeight: 800 }}>
            {saver.on ? 'On' : 'Off'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={saver.on}
          aria-label="Data saver"
          onClick={saver.toggle}
          style={{
            width: 54, height: 30, borderRadius: 999, border: 'none', cursor: 'pointer', flexShrink: 0,
            background: saver.on ? green : '#3a3a3a', position: 'relative',
            transition: 'background 140ms ease',
          }}
        >
          <span style={{
            position: 'absolute', top: 3, left: saver.on ? 27 : 3, width: 24, height: 24,
            borderRadius: '50%', background: saver.on ? '#000' : '#ddd',
            transition: 'left 140ms ease',
          }} />
        </button>
      </div>

      <p style={{ ...smallPrint, margin: '10px 0 12px' }}>{saver.reason}</p>

      <div style={panel}>
        <Does>
          Cards ask for <strong style={{ color: green }}>{budget.cardWidth}px</strong> photos
          {saver.on
            ? <> at a lower quality target, about <strong style={{ color: green }}>{cheaperBy}</strong> less per photo than the full-size original.</>
            : <> at full quality — about {fullCost} less than the original, and more than our cheap setting.</>}
        </Does>
        <Does>
          One page of the market asks for <strong style={{ color: green }}>{budget.pageSize}</strong> products
          {full.pageSize === budget.pageSize ? '' : <> instead of {full.pageSize}</>}, and a shop's shelf{' '}
          <strong style={{ color: green }}>{budget.shelfSize}</strong>.
        </Does>
        <Does>
          Product sheets open at <strong style={{ color: green }}>{budget.fullWidth}px</strong> — the same photo,
          just not a bigger one than the screen can show.
        </Does>
        <p style={{ ...bullet, margin: 0 }}>
          Prices, shops, chat and paying use exactly the same data either way. This setting only changes
          pictures and how many arrive at once.
        </p>
      </div>

      {showLedger && (
        <p style={{ margin: '0 0 10px', color: saver.on ? green : '#888', fontSize: 13, lineHeight: 1.55 }}>
          {saver.on ? saver.ledgerLine : 'Off, so nothing has been shrunk — photos are coming full size.'}
        </p>
      )}

      <p style={{ margin: 0, color: '#666', fontSize: 12, lineHeight: 1.5 }}>{who}</p>
    </div>
  )
}
