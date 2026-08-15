function TermsPage() {
  return (
    <>
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }

        :root {
          --green: #adff2f;
          --dark: #0a0a0a;
          --card: #141414;
          --border: #1e1e1e;
          --text: #e8e8e8;
          --muted: #666;
          --white: #ffffff;
        }

        body {
          background: var(--dark);
          color: var(--text);
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 15px;
          line-height: 1.7;
          min-height: 100vh;
        }

        /* Nav */
        nav {
          padding: 18px 32px;
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          gap: 10px;
          position: sticky;
          top: 0;
          background: var(--dark);
          z-index: 10;
        }

        .logo-box {
          width: 30px;
          height: 30px;
          background: var(--green);
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 900;
          color: var(--dark);
          font-size: 14px;
        }

        .logo-text {
          font-weight: 800;
          font-size: 16px;
          color: var(--white);
          letter-spacing: -0.3px;
        }
        /* Hero */
        .hero {
          padding: 64px 32px 48px;
          max-width: 720px;
          margin: 0 auto;
          border-bottom: 1px solid var(--border);
        }

        .hero-label {
          display: inline-block;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: var(--green);
          margin-bottom: 16px;
        }

        .hero h1 {
          font-size: clamp(28px, 5vw, 42px);
          font-weight: 900;
          color: var(--white);
          line-height: 1.1;
          letter-spacing: -1px;
          margin-bottom: 16px;
        }

        .hero p {
          color: var(--muted);
          font-size: 14px;
          max-width: 480px;
        }

        .hero p span {
          color: var(--green);
          font-weight: 600;
        }

        /* Content */
        .content {
          max-width: 720px;
          margin: 0 auto;
          padding: 48px 32px 80px;
        }

        /* Intro box */
        .intro-box {
          background: var(--card);
          border: 1px solid var(--border);
          border-left: 3px solid var(--green);
          border-radius: 8px;
          padding: 20px 24px;
          margin-bottom: 48px;
          font-size: 14px;
          color: #aaa;
          line-height: 1.7;
        }

        /* Section */
        .section {
          margin-bottom: 40px;
          padding-bottom: 40px;
          border-bottom: 1px solid var(--border);
        }

        .section:last-of-type {
          border-bottom: none;
        }

        .section-number {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 1.5px;
          color: var(--green);
          text-transform: uppercase;
          margin-bottom: 8px;
        }

        .section h2 {
          font-size: 18px;
          font-weight: 800;
          color: var(--white);
          margin-bottom: 12px;
          letter-spacing: -0.3px;
        }

        .section p {
          color: #aaa;
          font-size: 14px;
          line-height: 1.8;
        }
        /* Contact box */
        .contact-box {
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 28px 28px;
          margin-top: 48px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .contact-box h3 {
          font-size: 16px;
          font-weight: 800;
          color: var(--white);
        }

        .contact-box p {
          font-size: 14px;
          color: #aaa;
        }

        .contact-email {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: var(--dark);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 10px 16px;
          font-size: 13px;
          color: var(--green);
          font-weight: 600;
          text-decoration: none;
          width: fit-content;
          margin-top: 4px;
        }

        .contact-email:hover {
          border-color: var(--green);
        }

        /* Footer */
        footer {
          border-top: 1px solid var(--border);
          padding: 24px 32px;
          text-align: center;
          color: var(--muted);
          font-size: 12px;
        }

        footer span {
          color: var(--green);
          font-weight: 700;
        }

        /* Mobile */
        @media (max-width: 600px) {
          nav { padding: 16px 20px; }
          .hero { padding: 40px 20px 32px; }
          .content { padding: 32px 20px 60px; }
          footer { padding: 20px; }
        }
      `}</style>
      <nav>
        <div className="logo-box">r</div>
        <span className="logo-text">rachett</span>
      </nav>

      <div className="hero">
        <span className="hero-label">Legal</span>
        <h1>Terms &amp;<br />Conditions</h1>
        <p>Last updated: <span>August 2026</span> &nbsp;·&nbsp; These terms apply to all users of rachett worldwide.</p>
      </div>

      <div className="content">

        <div className="intro-box">
          Please read these Terms and Conditions carefully before using rachett. They explain your rights and responsibilities as a user of our platform. By using rachett, you agree to these terms. If you don't agree, please don't use the platform.
        </div>

        <div className="section">
          <div className="section-number">00</div>
          <h2>About rachett</h2>
          <p>rachett is a social commerce platform owned and operated by <strong style={{ color: '#fff' }}>Solomon Creflo</strong>, and developed by <strong style={{ color: '#fff' }}>Dwarves</strong> — a technology company building infrastructure for  commerce. We are on a mission to make buying and selling simpler, safer, and more connected for everyone.</p>
        </div>

        <div className="section">
          <div className="section-number">01</div>
          <h2>Acceptance of These Terms</h2>
          <p>By creating an account, signing in, browsing, or using rachett in any way, you agree to these Terms and Conditions and our Privacy Policy. If you do not agree, please do not use rachett.</p>
        </div>

        <div className="section">
          <div className="section-number">02</div>
          <h2>Your Account</h2>
          <p>You are responsible for keeping your account login details safe and for everything done under your account. You must provide accurate information when signing up, and you may not create an account for someone else without their permission.</p>
        </div>

        <div className="section">
          <div className="section-number">03</div>
          <h2>Using rachett</h2>
          <p>rachett is a social commerce platform that connects buyers and sellers. We operate across multiple countries and markets. All buying and selling happens directly between users, with conversations, orders, and payments arranged inside the rachett app.</p>
        </div>

        <div className="section">
          <div className="section-number">04</div>
          <h2>Buying on rachett</h2>
          <p>When you buy, you agree to provide correct delivery and contact details, to pay the agreed amount, and to complete the transaction in good faith. If an item is not as described, contact the seller first through your rachett chat before raising a dispute.</p>
        </div>

        <div className="section">
          <div className="section-number">05</div>
          <h2>Selling on rachett</h2>
          <p>Sellers agree to keep their store and product information accurate, to be honest about item condition, price, and availability, and to respond to buyers through rachett messaging. Sellers must not misrepresent themselves or their goods in any way.</p>
        </div>
        <div className="section">
          <div className="section-number">06</div>
          <h2>Payments &amp; Orders</h2>
          <p>Payments are arranged between the buyer and seller as agreed. rachett is not a party to the payment unless expressly stated. Keep records of your orders and conversations — they help resolve disputes if they arise.</p>
        </div>

        <div className="section">
          <div className="section-number">07</div>
          <h2>Prohibited Conduct &amp; Items</h2>
          <p>You may not use rachett for any illegal activity, to sell prohibited goods, to scam or defraud others, to harass any user, or to share false information. We will suspend or permanently remove accounts that violate these terms without prior notice.</p>
        </div>

        <div className="section">
          <div className="section-number">08</div>
          <h2>Our Role as a Platform</h2>
          <p>rachett provides the platform that connects buyers and sellers. We are not the buyer or seller of any product, and we do not guarantee product quality, availability, or delivery. Each user is responsible for their own transactions.</p>
        </div>

        <div className="section">
          <div className="section-number">09</div>
          <h2>Intellectual Property</h2>
          <p>The rachett name, logo, and platform are owned by rachett. You may not copy, modify, or reuse them without written permission. Content you post — such as your store, products, and images — belongs to you, and you grant rachett permission to display it on the platform.</p>
        </div>

        <div className="section">
          <div className="section-number">10</div>
          <h2>Privacy</h2>
          <p>We handle your personal information in line with our Privacy Policy. This includes using your contact details for account verification, recovery, and support. We do not sell your personal data to third parties.</p>
        </div>

        <div className="section">
          <div className="section-number">11</div>
          <h2>Limitation of Liability</h2>
          <p>We genuinely care about every transaction on rachett and work hard every day to make the platform safe, fair, and reliable. That said, rachett connects buyers and sellers — we are not the seller of any product and cannot guarantee that every transaction goes perfectly.</p>
          <br />
          <p>If something goes wrong — a delayed delivery, a product not as described, or a payment issue — please contact us at <strong style={{ color: '#adff2f' }}>rachettcommerce@gmail.com</strong> and we will do our best to help resolve it. We are a small team that genuinely listens, and no concern is too small for us.</p>
          <br />
          <p>To the extent permitted by applicable law, rachett's liability is limited to facilitating resolution between the parties involved in a transaction.</p>
        </div>
        <div className="section">
          <div className="section-number">12</div>
          <h2>Changes to These Terms</h2>
          <p>We may update these Terms from time to time. We will post the updated version here with a new "Last updated" date. Continuing to use rachett after changes means you accept the updated Terms.</p>
        </div>

        <div className="section">
          <div className="section-number">13</div>
          <h2>Termination</h2>
          <p>You may stop using rachett at any time by deleting your account. We may suspend or close accounts that break these Terms, are used for fraud, or cause harm to other users or the platform.</p>
        </div>

        <div className="section">
          <div className="section-number">14</div>
          <h2>Governing Law</h2>
          <p>These Terms are governed by applicable law in the jurisdiction where rachett operates or where the dispute arises. As rachett serves users across multiple countries, local consumer protection laws may also apply to you.</p>
        </div>

        <div className="section">
          <div className="section-number">15</div>
          <h2>Contact Us</h2>
          <p>If you have questions, concerns, or feedback about these Terms, reach out to the rachett support team directly.</p>
          <a className="contact-email" href="mailto:rachettcommerce@gmail.com">
            ✉ rachettcommerce@gmail.com
          </a>
        </div>

        <div className="contact-box">
          <h3>Questions about rachett?</h3>
          <p>We're a small team building something real for African sellers and buyers. If something isn't clear, just ask — we're here.</p>
          <a className="contact-email" href="mailto:rachettcommerce@gmail.com">rachettcommerce@gmail.com</a>
        </div>

      </div>

      <footer>
        © 2026 <span>rachett</span> made with ❤️ by <style={{ color: '#adff2f', textDecoration: 'underline' }}>dwarves</a>
      </footer>
    </>
  )
}

export default TermsPage





