import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const green = '#adff2f'
const SUPPORT_WHATSAPP = (import.meta.env.VITE_SUPPORT_WHATSAPP || '').trim()

type FaqItem = { q: string; a: string }
type FaqSection = { icon: string; title: string; items: FaqItem[] }

const FAQ_SECTIONS: FaqSection[] = [
  {
    icon: '🔑',
    title: 'Account & Login',
    items: [
      {
        q: "Can't log in or forgot your email?",
        a: 'Tap "Need help?" in the top bar and choose Email or Google. We verify your identity and get you straight back into your account.',
      },
      {
        q: "The Google popup didn't appear",
        a: 'Your browser blocked it. Allow popups for this site and try signing in again.',
      },
      {
        q: "I'm logged in but my store is missing",
        a: 'You likely signed in with a different Google account. Sign out and use the account you created your store with.',
      },
    ],
  },
  {
    icon: '📱',
    title: 'Phone & SMS',
    items: [
      {
        q: 'I changed my phone number',
        a: "If you're a seller, update your contact number in Edit Store. Buyers reach you at that number in Rachett messaging.",
      },
      {
        q: "My SMS code isn't arriving",
        a: 'Codes come from a Uganda number. Wait about 2 minutes, check your signal, then tap Resend.',
      },
    ],
  },
  {
    icon: '🏪',
    title: 'For Sellers',
    items: [
      {
        q: 'How do I change the number buyers contact me on?',
        a: 'Go to Edit Store and update your phone number. That is the number buyers use to message you inside Rachett.',
      },
      {
        q: 'How do I add or edit products?',
        a: 'Open the Products page. For many items at once, use Bulk Upload with a spreadsheet.',
      },
      {
        q: 'How do I message my customers?',
        a: 'Open your Inbox. Every conversation happens right here in Rachett — no other app needed.',
      },
    ],
  },
  {
    icon: '🛒',
    title: 'For Buyers',
    items: [
      {
        q: 'How do I order?',
        a: 'Add items to your bag, then message the seller in Rachett to arrange payment and delivery.',
      },
      {
        q: 'How do I contact a seller?',
        a: 'Open their store and tap Message. The chat opens right here in Rachett — nothing to install.',
      },
    ],
  },
  {
    icon: '⚠️',
    title: 'Trust & Safety',
    items: [
      {
        q: "A seller didn't deliver",
        a: 'Report it from your chat and our team will investigate with your order details.',
      },
    ],
  },
]

function HelpPage() {
  const navigate = useNavigate()
  const [openKey, setOpenKey] = useState<string | null>(null)

  const toggle = (key: string) => setOpenKey(openKey === key ? null : key)

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff', padding: '24px 16px 60px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <h1 style={{ margin: '0 0 6px', fontSize: 26, fontWeight: 800 }}>❓ Help & Support</h1>
          <p style={{ margin: 0, color: '#888', fontSize: 14 }}>Answers to common questions — everything happens right here in Rachett.</p>
        </div>

        {FAQ_SECTIONS.map((section, si) => (
          <div key={section.title} style={{ marginBottom: 24 }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 700, color: green }}>
              {section.icon} {section.title}
            </h2>
            {section.items.map((item, ii) => {
              const key = `${si}-${ii}`
              const isOpen = openKey === key
              return (
                <div
                  key={key}
                  onClick={() => toggle(key)}
                  style={{
                    background: '#1a1a1a',
                    border: '1px solid #222',
                    borderRadius: 12,
                    marginBottom: 8,
                    padding: '14px 16px',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, fontWeight: 700, fontSize: 14 }}>
                    <span>{item.q}</span>
                    <span style={{ color: '#666', fontSize: 11 }}>{isOpen ? '▲' : '▼'}</span>
                  </div>
                  {isOpen && (
                    <p style={{ margin: '10px 0 0', color: '#bbb', fontSize: 13, lineHeight: 1.6 }}>{item.a}</p>
                  )}
                </div>
              )
            })}
          </div>
        ))}

        <div style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: 12, padding: '16px', textAlign: 'center', marginBottom: 24 }}>
          <p style={{ margin: '0 0 10px', color: '#ccc', fontSize: 14 }}>Lost access to your account?</p>
          <button
            onClick={() => navigate('/recover')}
            style={{ background: green, color: '#000', border: 'none', padding: '10px 20px', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}
          >
            Recover your account
          </button>
        </div>

        <div style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: 12, padding: '20px', textAlign: 'center' }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 800 }}>Still stuck?</h3>
          <p style={{ margin: '0 0 16px', color: '#888', fontSize: 13 }}>Talk to the support team, or send us feedback.</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            {SUPPORT_WHATSAPP && (
              <a
                href={`https://wa.me/${SUPPORT_WHATSAPP}`}
                target="_blank"
                rel="noreferrer"
                style={{ background: '#25D366', color: '#000', padding: '12px 20px', borderRadius: 10, fontWeight: 700, textDecoration: 'none', fontSize: 14 }}
              >
                💬 Chat on WhatsApp
              </a>
            )}
            <button
              onClick={() => navigate('/feedback')}
              style={{ background: 'transparent', color: green, border: `1px solid ${green}`, padding: '12px 20px', borderRadius: 10, fontWeight: 700, cursor: 'pointer', fontSize: 14 }}
            >
              💡 Send Feedback
            </button>
          </div>
          {!SUPPORT_WHATSAPP && (
            <p style={{ margin: '12px 0 0', color: '#666', fontSize: 12 }}>WhatsApp support is coming soon — use Feedback for now.</p>
          )}
        </div>
      </div>
    </div>
  )
}

export default HelpPage

