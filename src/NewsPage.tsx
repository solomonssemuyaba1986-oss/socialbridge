/**
 * Rachett News & Updates.
 *
 * One permanent page on every account — buyer or seller — with two jobs:
 *   1. tell the person whether their account has one strong way in or two, and offer the missing
 *      one (a phone for a Google account, a Google email for a phone account);
 *   2. carry the nine-day phone reminder for email-only accounts in phone-first markets, and the
 *      consent-first "find your friends" step once a number is proved.
 *
 * It is a page rather than a pop-up on purpose. A sale is never interrupted by an account tip,
 * and the reminder has somewhere to live between visits.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { linkWithPopup } from 'firebase/auth'
import { auth, googleProvider } from './firebase'
import { rememberUser } from './userMemory'
import { trackEvent } from './analytics'
import { methodsLabel, strengthLabel } from './accountStrength'
import { useAccountStrength } from './useAccountStrength'
import PhoneVerifyForm from './PhoneVerifyForm'
import ContactFinder from './ContactFinder'
import { NEWS_POSTS } from './news'

const green = '#adff2f'
const amber = '#ffcc55'

const card: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #262626', borderRadius: 16, padding: 16, marginBottom: 14,
}
const title: React.CSSProperties = { margin: '0 0 4px', color: '#fff', fontSize: 16, fontWeight: 900 }
const small: React.CSSProperties = { margin: '0 0 12px', color: '#888', fontSize: 13, lineHeight: 1.6 }
const primary: React.CSSProperties = {
  width: '100%', padding: '13px 16px', border: 'none', borderRadius: 10,
  background: green, color: '#000', fontWeight: 900, fontSize: 14, cursor: 'pointer',
}

function MethodRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '10px 0', borderTop: '1px solid #262626' }}>
      <span aria-hidden="true" style={{ color: ok ? green : '#666', fontWeight: 900 }}>{ok ? '✓' : '○'}</span>
      <div style={{ flex: 1 }}>
        <div style={{ color: ok ? '#fff' : '#bbb', fontSize: 13, fontWeight: 800 }}>{label}</div>
        <div style={{ color: '#777', fontSize: 12, lineHeight: 1.5, marginTop: 2 }}>{detail}</div>
      </div>
    </div>
  )
}

function Section({ children }: { children: ReactNode }) {
  return <div style={card}>{children}</div>
}

export default function NewsPage() {
  const navigate = useNavigate()
  const account = useAccountStrength()
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState('')
  const [nudgeShown, setNudgeShown] = useState(false)
  const [phoneJustAdded, setPhoneJustAdded] = useState(false)
  const viewed = useRef(false)
  const nudgeMarked = useRef(false)

  const strength = account.strength
  const isGuest = strength.guest

  useEffect(() => {
    if (account.loading || isGuest || viewed.current) return
    viewed.current = true
    trackEvent('account_strength_viewed', {
      methods: methodsLabel(strength),
      hasPhone: strength.hasPhone,
      hasEmail: strength.hasEmail,
      african: strength.african,
      nudgeDue: account.nudgeDue,
    })
  }, [account, account.loading, account.nudgeDue, isGuest, strength])

  useEffect(() => {
    if (account.loading || !account.nudgeDue || nudgeMarked.current) return
    nudgeMarked.current = true
    setNudgeShown(true)
    trackEvent('account_strength_prompt_shown', {
      missing: 'phone',
      surface: 'news',
      african: strength.african,
      due: true,
    })
    void account.markNudgeSeen()
  }, [account, account.loading, account.nudgeDue, account.markNudgeSeen, strength.african])

  const addGoogle = async () => {
    const current = auth.currentUser
    if (!current) return
    setLinking(true)
    setLinkError('')
    try {
      await linkWithPopup(current, googleProvider)
      await account.refresh()
      rememberUser(auth.currentUser)
      trackEvent('account_email_added', { method: 'google-link' })
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: string }).code) : ''
      if (code === 'auth/provider-already-linked') {
        await account.refresh()
      } else if (code === 'auth/credential-already-in-use') {
        setLinkError('That Google email already belongs to another rachett account. Sign in with it instead, or use a different email.')
      } else if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        // Closing the Google window is a choice, not an error to shout about.
      } else if (code === 'auth/requires-recent-login') {
        setLinkError('For safety, sign out and sign in again, then add your email.')
      } else {
        console.warn('Could not add a Google email:', code || err)
        setLinkError('We could not add that Google email. Please try again.')
      }
    } finally {
      setLinking(false)
    }
  }

  return (
    <div className="rt-page rt-has-tabs" style={{ minHeight: '100vh', background: '#0f0f0f', color: '#fff', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '20px 16px 80px' }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 23, fontWeight: 900 }}>📰 Rachett News &amp; Updates</h1>
        <p style={{ margin: '0 0 18px', color: '#888', fontSize: 13, lineHeight: 1.6 }}>
          The one place for account news, safety and the things worth knowing. Every rachett
          profile has it, buyer or seller.
        </p>

        {nudgeShown && !strength.hasPhone && (
          <div style={{
            background: '#211a08', border: `1px solid ${amber}`, borderRadius: 16,
            padding: 16, marginBottom: 14,
          }}>
            <p style={{ margin: '0 0 4px', color: amber, fontSize: 11, fontWeight: 900, letterSpacing: '0.5px' }}>
              NINE-DAY REMINDER
            </p>
            <p style={{ margin: '0 0 6px', color: '#fff', fontSize: 16, fontWeight: 900 }}>
              Your account is still missing a phone number
            </p>
            <p style={{ margin: 0, color: '#c9b98b', fontSize: 13, lineHeight: 1.6 }}>
              In this part of the world your phone is the key to buying, selling, recovery and the
              real-seller badge. Add it below when you are ready. We will remind you again in nine
              days, on this page only.
            </p>
          </div>
        )}

        <Section>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <p style={title}>Your account strength</p>
              <p style={{ ...small, marginBottom: 8 }}>
                Two independent ways back in make an account you can always recover.
              </p>
            </div>
            <span style={{
              padding: '5px 9px', borderRadius: 999, fontSize: 11, fontWeight: 900,
              background: strength.strong ? '#0f2910' : '#1c1c1c',
              color: strength.strong ? green : '#aaa', border: `1px solid ${strength.strong ? '#285a28' : '#333'}`,
              whiteSpace: 'nowrap',
            }}>
              {strengthLabel(strength)}
            </span>
          </div>

          {isGuest ? (
            <>
              <p style={{ margin: '6px 0 12px', color: '#bbb', fontSize: 13, lineHeight: 1.6 }}>
                You are browsing as a guest. Create an account to keep your orders and chats on a
                new phone — and to make your name yours.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => navigate('/signin', { state: { scrollToProviders: true } })}
                  style={{ ...primary, width: 'auto', flex: '1 1 150px' }}>
                  Create an account
                </button>
                <button type="button" onClick={() => navigate('/signin')}
                  style={{
                    flex: '1 1 110px', padding: '13px 16px', borderRadius: 10,
                    border: '1px solid #333', background: 'transparent', color: '#ccc',
                    fontWeight: 800, fontSize: 13, cursor: 'pointer',
                  }}>
                  Log in
                </button>
              </div>
            </>
          ) : (
            <>
              <MethodRow
                ok={strength.hasPhone}
                label={strength.hasPhone ? 'Phone number verified' : 'Add your phone number'}
                detail={strength.hasPhone
                  ? 'Your number is proved by a text message from our server. It is the key to recovery and the real-seller badge.'
                  : 'The strongest key here: it receives codes, anchors recovery, earns the real-seller badge, and is the number mobile money is attached to.'}
              />
              <MethodRow
                ok={strength.hasEmail}
                label={strength.hasEmail ? 'Google email connected' : 'Add a Google email'}
                detail={strength.hasEmail
                  ? 'A second key, so a lost or changed number never locks you out.'
                  : 'The spare key. It gets you back in after a SIM swap and makes your account portable to a new phone.'}
              />

              {strength.strong && (
                <p style={{ margin: '12px 0 0', color: green, fontSize: 13, fontWeight: 800 }}>
                  ✓ Strong account — both keys are in place.
                </p>
              )}

              {!strength.hasPhone && (
                <div id="add-phone" style={{ marginTop: 14 }}>
                  <p style={{ margin: '0 0 4px', color: '#fff', fontSize: 14, fontWeight: 900 }}>Add your phone number</p>
                  <p style={{ ...small, marginBottom: 10 }}>
                    {strength.african
                      ? 'We will text a 6-digit code. In phone-first markets this is the number buyers, sellers and mobile money recognise.'
                      : 'Optional where you are — but it still makes your account easier to recover and lets you earn the real-seller badge.'}
                  </p>
                  <PhoneVerifyForm
                    idPrefix="news-phone"
                    method="account-strength"
                    ctaLabel="Text me a code"
                    onVerified={async () => {
                      await account.refresh()
                      setPhoneJustAdded(true)
                    }}
                  />
                </div>
              )}

              {phoneJustAdded && (
                <p style={{ margin: '10px 0 0', color: green, fontSize: 13, fontWeight: 800 }}>
                  ✓ Phone verified. Your account has the strongest key it can hold.
                </p>
              )}

              {!strength.hasEmail && (
                <div style={{ marginTop: 14 }}>
                  <p style={{ margin: '0 0 4px', color: '#fff', fontSize: 14, fontWeight: 900 }}>Add a Google email</p>
                  <p style={{ ...small, marginBottom: 10 }}>
                    A phone number is a strong key, but a number can change. Your Google email is
                    the spare key that brings you back.
                  </p>
                  {linkError && <p role="alert" style={{ margin: '0 0 10px', color: '#ff6b6b', fontSize: 12, lineHeight: 1.5 }}>{linkError}</p>}
                  <button type="button" onClick={() => void addGoogle()} disabled={linking}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                      padding: '13px 16px', borderRadius: 10, border: 'none',
                      background: linking ? '#333' : '#fff', color: '#000', fontWeight: 900,
                      fontSize: 14, cursor: linking ? 'not-allowed' : 'pointer',
                    }}>
                    <img src="https://www.google.com/favicon.ico" width="18" height="18" alt="" />
                    {linking ? 'Opening Google…' : 'Add Google email'}
                  </button>
                </div>
              )}

              {!strength.hasEmail && !strength.african && (
                <p style={{ margin: '10px 0 0', color: '#666', fontSize: 11, lineHeight: 1.5 }}>
                  Outside phone-first markets, email-only is a perfectly good account. We will not
                  keep reminding you.
                </p>
              )}
            </>
          )}
        </Section>



        <Section>
          <p style={title}>Find your friends</p>
          <p style={{ ...small, marginBottom: 12 }}>
            {strength.hasPhone
              ? 'Your verified phone is what makes this possible. Choose contacts in your phone’s own picker; nothing is read until you tap.'
              : 'Add and verify a phone number above first. Contact discovery only works from a number we have proved is yours.'}
          </p>
          {strength.hasPhone
            ? <ContactFinder surface="news" />
            : (
              <a href="#add-phone" style={{
                display: 'inline-block', padding: '11px 14px', borderRadius: 10,
                border: '1px solid #333', color: green, fontWeight: 800, fontSize: 13,
                textDecoration: 'none',
              }}>
                Add your phone number ↑
              </a>
            )}
        </Section>

        <div style={{ margin: '22px 0 10px', display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 900 }}>Updates</h2>
          <span style={{ color: '#555', fontSize: 12 }}>{NEWS_POSTS.length} notes</span>
        </div>

        {NEWS_POSTS.map(post => (
          <article key={post.id} style={card}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <span style={{
                padding: '3px 7px', borderRadius: 999, background: '#111', border: '1px solid #333',
                color: post.tag === 'sellers' ? green : '#aaa', fontSize: 10, fontWeight: 900,
                letterSpacing: '0.4px', textTransform: 'uppercase',
              }}>
                {post.tag}
              </span>
              <span style={{ color: '#555', fontSize: 11 }}>{post.date}</span>
            </div>
            <h3 style={{ margin: '0 0 6px', color: '#fff', fontSize: 15, fontWeight: 900, lineHeight: 1.35 }}>
              {post.title}
            </h3>
            <p style={{ margin: 0, color: '#999', fontSize: 13, lineHeight: 1.65 }}>{post.body}</p>
          </article>
        ))}

        <Section>
          <p style={title}>What this page keeps</p>
          <p style={{ margin: 0, color: '#888', fontSize: 12, lineHeight: 1.65 }}>
            The account facts on this page already exist on your own account. Contact discovery
            adds only three things: that you agreed, when, and how many friends were found. The
            address book itself is never stored, and no number is ever returned to another person.
            Account reminders live here, on your account, so a second phone does not start them
            again.
          </p>
        </Section>
      </div>
    </div>
  )
}
