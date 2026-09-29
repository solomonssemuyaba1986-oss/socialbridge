import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { normalizeRoute } from './analytics'
import { useDemographics } from './useDemographics'
import AgeGenderAsk from './AgeGenderAsk'

/**
 * The one-time ask, for everybody who was already here before it existed.
 *
 * The onboarding step covers a new visitor and the setup wizard covers a new seller, but nobody
 * arrives through those doors twice — so an account made last month would simply never be asked.
 * This is mounted next to `FeedbackNudge` and shows the same two questions the moment there is a
 * screen to show them on.
 *
 * Four rules it keeps, all of them for the same reason (an ask that costs a sale is not worth the
 * answer):
 *
 *  - **It cannot be dismissed.** There is no ✕ and no Later: the only way it goes away is by being
 *    answered. "Prefer not to say" is one of the answers, so that is never a trap.
 *  - **It never covers a form.** Deliberately a card above the phone's tab bar, not an overlay —
 *    unlike `FeedbackNudge`, it does not go quiet when ignored, but it also never sits on top of a
 *    half-filled order. Dialogs (z-index 1000) draw over it, so it waits.
 *  - **It only appears where somebody has settled.** `ALLOWED_ROUTES` is the buyer's own surfaces.
 *    `/store/:slug` and the sign-in screens are left alone: asking for a birth-year band in the
 *    middle of paying, or in front of someone who has not decided to join, is how a good question
 *    becomes an obstacle.
 *  - **It is asked once.** `answeredAt` lives on the account (or on this phone for a guest), so a
 *    second visit, a second tab and a second phone are all silent.
 */
const ALLOWED_ROUTES = ['/browse', '/nearby', '/home', '/bag', '/profile']

export default function DemographicsGate() {
  const location = useLocation()
  const route = useMemo(() => normalizeRoute(location.pathname), [location.pathname])
  const demographics = useDemographics()

  if (demographics.loading || !demographics.needsAsk) return null
  if (!ALLOWED_ROUTES.includes(route)) return null

  return (
    <div style={{ position: 'fixed', left: 12, right: 12, bottom: 88, zIndex: 90, maxWidth: 460, margin: '0 auto', fontFamily: 'sans-serif' }}>
      <div style={{ background: '#161616', border: '1px solid #2a2a2a', borderRadius: 16, padding: 16, boxShadow: '0 12px 40px rgba(0,0,0,0.55)', color: '#fff' }}>
        <p style={{ margin: '0 0 4px', color: '#adff2f', fontSize: 11, fontWeight: 800, letterSpacing: '0.5px' }}>
          ONE LAST THING
        </p>
        <AgeGenderAsk
          demographics={demographics}
          surface="gate"
          mark
          bare
          ctaLabel="That's me"
          title="Two quick things"
          blurb="So what we put in front of you is not a guess. It stays on your own account, and a seller never sees it."
          onDone={() => { /* the hook's state flips to answered and this card unmounts itself */ }}
        />
        <p style={{ margin: '10px 0 0', color: '#666', fontSize: 11, lineHeight: 1.5 }}>
          {demographics.uid
            ? 'You can change both any time in your profile.'
            : 'You are browsing without an account, so this stays on this phone — and it follows you if you sign in later.'}
        </p>
      </div>
    </div>
  )
}
