import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { setRole, clearRole, MARKET_HOME } from './role'
import { useBuyerName } from './useBuyerName'
import { useDemographics } from './useDemographics'
import NameStrip from './NameStrip'
import AgeGenderAsk from './AgeGenderAsk'

function Onboarding() {
  const navigate = useNavigate()
  /** Who we call them — the same name system the Inbox, checkout and comments use. */
  const myName = useBuyerName()
  /** And what we show them — the age group and gender every recommendation is built on. */
  const myDemographics = useDemographics()
  /**
   * 'choose' is the three cards; 'name' is the first question that follows a buyer's choice, and
   * 'about' is the second. Both are required, and neither is ever asked twice.
   */
  const [step, setStep] = useState<'choose' | 'name' | 'about'>('choose')

  /**
   * The door into the market from here.
   *
   * Two questions stand between choosing and browsing, and only the ones this person has not
   * already answered: what sellers should call them, then the two things that make a
   * recommendation possible. The moment both are on record the door opens straight away — asking a
   * settled question again is worse than not asking a new one, so an account that answered months
   * ago walks straight through.
   */
  const nextUnanswered = () => {
    if (!myName.loading && myName.needsAsk) {
      setStep('name')
      return
    }
    if (!myDemographics.loading && myDemographics.needsAsk) {
      setStep('about')
      return
    }
    navigate(MARKET_HOME)
  }

  /**
   * Choosing a way in. The name ask belongs *here*, at the moment of choosing, because this is where
   * a visitor becomes a person on rachett — and whatever they answer is what sellers, the Inbox and
   * every order form will call them from then on.
   *
   * A seller's own name is their business name, and their age and gender are asked on the store
   * setup screen, so that card leads straight there.
   */
  const choose = (role: 'buyer' | 'looking') => {
    if (role === 'buyer') setRole('buyer')
    else clearRole()
    nextUnanswered()
  }

  if (step === 'name') {
    return (
      <div className="rt-page" style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <p style={{ color: '#aaa', marginBottom: '8px', fontSize: '14px' }}>Welcome to rachett</p>
        <h1 style={{ color: '#fff', fontSize: '28px', fontWeight: '800', marginBottom: '8px', textAlign: 'center' }}>One thing before you look around</h1>
        <p style={{ color: '#888', marginBottom: '24px', fontSize: '15px', textAlign: 'center', maxWidth: '460px' }}>
          What should we call you? This is the name sellers see when you message or order — and you can change it any time.
        </p>
        <div style={{ width: '100%', maxWidth: '460px' }}>
          {/* forceOpen: this *is* the ask, and it moves the screen on however they answer it. */}
          <NameStrip
            buyerName={myName}
            surface="onboarding"
            forceOpen
            onDone={() => {
              // The name is behind them (answered, or tapped Later) — one question still stands.
              if (!myDemographics.loading && myDemographics.needsAsk) setStep('about')
              else navigate(MARKET_HOME)
            }}
          />
        </div>
        {!myName.loading && !myName.uid && (
          <p style={{ color: '#666', fontSize: 12, marginTop: 2, maxWidth: '460px', textAlign: 'center', lineHeight: 1.6 }}>
            You are browsing without an account, so this stays on this phone — and it follows you if you sign in later.
          </p>
        )}
      </div>
    )
  }

  /**
   * Question two, and the reason this screen exists at all: recommendations need *some* idea of who
   * is asking. It cannot be walked past — there is no Later on this screen — but "Prefer not to say"
   * is one of the answers to each question, so nobody is talked into a fact that is not theirs.
   */
  if (step === 'about') {
    return (
      <div className="rt-page" style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <p style={{ color: '#aaa', marginBottom: '8px', fontSize: '14px' }}>Welcome to rachett</p>
        <h1 style={{ color: '#fff', fontSize: 28, fontWeight: 800, marginBottom: '8px', textAlign: 'center' }}>
          What should we show you?
        </h1>
        <p style={{ color: '#888', marginBottom: '24px', fontSize: 15, textAlign: 'center', maxWidth: '460px' }}>
          Two questions, once. They are what turns the market's front page into yours.
        </p>
        <div style={{ width: '100%', maxWidth: '460px' }}>
          <AgeGenderAsk
            demographics={myDemographics}
            surface="onboarding"
            mark
            ctaLabel="Start shopping"
            onDone={() => navigate(MARKET_HOME)}
          />
        </div>
        {!myDemographics.loading && !myDemographics.uid && (
          <p style={{ color: '#666', fontSize: 12, marginTop: 12, maxWidth: '460px', textAlign: 'center', lineHeight: 1.6 }}>
            You are browsing without an account, so this stays on this phone — and it follows you if you sign in later.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="rt-page" style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <p style={{ color: '#aaa', marginBottom: '8px', fontSize: '14px' }}>Welcome to rachett</p>
      <h1 style={{ color: '#fff', fontSize: '32px', fontWeight: '800', marginBottom: '8px', textAlign: 'center' }}>What brings you here?</h1>
      <p style={{ color: '#888', marginBottom: '40px', fontSize: '15px' }}>We'll set up the right experience for you.</p>

      <div className="rt-onboarding-cards" style={{ display: 'flex', gap: '16px', width: '100%', maxWidth: '780px', marginBottom: '32px' }}>
        
        {/* Seller */}
        <div onClick={() => { setRole('seller'); navigate('/setup') }}
          style={{ flex: 1, background: '#1a1a1a', border: '2px solid #333', borderRadius: '16px', padding: '24px', cursor: 'pointer' }}>
          <div style={{ background: '#adff2f', width: '44px', height: '44px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px', fontSize: '22px' }}>🏪</div>
          <p style={{ color: '#fff', fontWeight: '700', fontSize: '16px', margin: '0 0 8px' }}>I'm a Seller</p>
          <p style={{ color: '#888', fontSize: '13px', margin: '0 0 16px' }}>I sell products on Instagram, TikTok, or WhatsApp and want to stop losing orders.</p>
          <div style={{ display: 'flex', gap: '8px', fontSize: '18px' }}>📸 🎵 💬</div>
        </div>

        {/* Buyer */}
        <div onClick={() => choose('buyer')}
          style={{ flex: 1, background: '#1a1a1a', border: '2px solid #333', borderRadius: '16px', padding: '24px', cursor: 'pointer' }}>
          <div style={{ background: '#3b82f6', width: '44px', height: '44px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px', fontSize: '22px' }}>🛍️</div>
          <p style={{ color: '#fff', fontWeight: '700', fontSize: '16px', margin: '0 0 8px' }}>I'm a Buyer</p>
          <p style={{ color: '#888', fontSize: '13px', margin: '0 0 16px' }}>I want to find and buy products from social media sellers safely.</p>
          <p style={{ color: '#888', fontSize: '12px', margin: 0 }}>👥 Browse hundreds of social sellers</p>
        </div>

        {/* Just looking — records NO role at all. Browsing the market needs no account and no
            choice, and this is also the way out of a half-made seller choice (see clearRole). */}
        <div onClick={() => choose('looking')}
          style={{ flex: 1, background: '#1a1a1a', border: '2px solid #333', borderRadius: '16px', padding: '24px', cursor: 'pointer' }}>
          <div style={{ background: '#7c3aed', width: '44px', height: '44px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px', fontSize: '22px' }}>🔍</div>
          <p style={{ color: '#fff', fontWeight: '700', fontSize: '16px', margin: '0 0 8px' }}>Just looking</p>
          <p style={{ color: '#888', fontSize: '13px', margin: '0 0 16px' }}>Have a look around first. You can sell or buy any time — and signing up is not required to browse.</p>
          <p style={{ color: '#888', fontSize: '12px', margin: 0 }}>👀 No account needed</p>
        </div>

      </div>
    </div>
  )
}

export default Onboarding