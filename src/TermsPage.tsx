import { useNavigate } from 'react-router-dom'

const green = '#adff2f'

function TermsPage() {
  const navigate = useNavigate()

  const sections = [
    {
      title: '1. Acceptance of These Terms',
      body: 'By creating an account, signing in, browsing, or using rachett in any way, you agree to these Terms and Conditions and our Privacy Policy. If you do not agree, please do not use rachett.',
    },
    {
      title: '2. Your Account',
      body: 'You are responsible for keeping your account login details safe and for everything done under your account. You must provide accurate information when signing up, and you may not create an account for someone else without permission.',
    },
    {
      title: '3. Using Rachett',
      body: 'rachett is a marketplace platform that connects buyers and sellers in Uganda. All buying and selling happens between users directly, with conversations, orders, and payments arranged inside the rachett app.',
    },
    {
      title: '4. Buying on Rachett',
      body: 'When you buy, you agree to provide correct delivery and contact details, to pay the agreed amount, and to complete the transaction in good faith. If an item is not as described, contact the seller first through your rachett chat.',
    },
    {
      title: '5. Selling on Rachett',
      body: 'Sellers agree to keep their store and product information accurate, to be honest about item condition, price, and availability, and to respond to buyers through rachett messaging. Sellers must not misrepresent themselves or their goods.',
    },
    {
      title: '6. Payments & Orders',
      body: 'Payments are arranged between the buyer and seller as agreed. rachett is not a party to the payment unless expressly stated. Keep records of your orders and conversations — they help us resolve disputes.',
    },
    {
      title: '7. Prohibited Conduct & Items',
      body: 'You may not use rachett for any illegal activity, to sell prohibited goods, to scam or defraud others, to harass anyone, or to share false information. We may suspend or remove accounts that violate these terms.',
    },
    {
      title: '8. Our Role as a Marketplace',
      body: 'rachett provides the platform that connects buyers and sellers. We are not the buyer or seller of any product, and we do not guarantee product quality, availability, or delivery. Each user is responsible for their own transactions.',
    },
    {
      title: '9. Intellectual Property',
      body: 'The rachett name, logo, and platform are owned by rachett. You may not copy, modify, or reuse them without written permission. Content you post (such as your store and products) belongs to you, and you grant rachett permission to display it on the platform.',
    },
    {
      title: '10. Privacy',
      body: 'We handle your personal information in line with our Privacy Policy. This includes using your contact details for account recovery and verification, and for support.',
    },
    {
      title: '11. Limitation of Liability',
      body: 'rachett provides the platform "as is" and, to the maximum extent permitted by law, is not liable for losses arising from user-to-user transactions, including non-delivery, disputes, or damage. We work to keep the platform safe and fair, but transactions are between the users involved.',
    },
    {
      title: '12. Changes to These Terms',
      body: 'We may update these Terms from time to time. We will post the updated version here with a new "Last updated" date. Continuing to use rachett after changes means you accept the updated Terms.',
    },
    {
      title: '13. Termination',
      body: 'You may stop using rachett at any time. We may suspend or close accounts that break these Terms, are used for fraud, or harm other users.',
    },
    {
      title: '14. Governing Law',
      body: 'These Terms are governed by the laws of the Republic of Uganda. Any disputes shall be handled in accordance with Ugandan law.',
    },
    {
      title: '15. Contact',
      body: 'If you have questions about these Terms, reach out through the Help page or contact rachett support on WhatsApp.',
    },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff', padding: '24px 16px 60px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <button onClick={() => navigate(-1)} style={{ background: 'transparent', border: '1px solid #333', color: '#888', padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, marginBottom: 16 }}>← Back</button>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h1 style={{ margin: '0 0 6px', fontSize: 26, fontWeight: 800 }}>📜 Rachett Terms & Conditions</h1>
          <p style={{ margin: 0, color: '#888', fontSize: 13 }}>Last updated: 15 August 2026</p>
        </div>

        {sections.map(s => (
          <div key={s.title} style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: 12, padding: '16px 18px', marginBottom: 10 }}>
            <h2 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 800, color: green }}>{s.title}</h2>
            <p style={{ margin: 0, color: '#bbb', fontSize: 13, lineHeight: 1.7 }}>{s.body}</p>
          </div>
        ))}

        <p style={{ color: '#555', fontSize: 12, textAlign: 'center', marginTop: 20 }}>
          Questions? Visit the <span onClick={() => navigate('/help')} style={{ color: '#88aaff', cursor: 'pointer', textDecoration: 'underline' }}>Help page</span>.
        </p>
      </div>
    </div>
  )
}

export default TermsPage
