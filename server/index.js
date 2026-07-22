import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import africastalking from 'africastalking'

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json())

// ─── Africastalking setup ───────────────────────────────────────────
const at = africastalking({
  apiKey: process.env.AT_API_KEY || 'YOUR_API_KEY',
  username: process.env.AT_USERNAME || 'sandbox',
})

const sms = at.SMS

// ─── In-memory OTP store (use Redis/DB in production) ──────────────
const otpStore = new Map()

// Clean up expired OTPs every 30 seconds
setInterval(() => {
  const now = Date.now()
  for (const [key, value] of otpStore) {
    if (now > value.expiresAt) {
      otpStore.delete(key)
    }
  }
}, 30_000)

// ─── Generate 6-digit OTP ──────────────────────────────────────────
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

// ─── Rate limiting per phone number ─────────────────────────────────
const rateLimitMap = new Map()

function checkRateLimit(phone) {
  const now = Date.now()
  const entry = rateLimitMap.get(phone)
  if (!entry) {
    rateLimitMap.set(phone, { count: 1, resetAt: now + 3600_000 })
    return true
  }
  if (now > entry.resetAt) {
    rateLimitMap.set(phone, { count: 1, resetAt: now + 3600_000 })
    return true
  }
  if (entry.count >= 3) {
    return false
  }
  entry.count += 1
  return true
}

// ─── POST /api/otp/send ────────────────────────────────────────────
// Body: { phone: "+256771234567" }
app.post('/api/otp/send', async (req, res) => {
  try {
    const { phone } = req.body

    if (!phone || !/^\+256\d{9}$/.test(phone)) {
      return res.status(400).json({ error: 'Invalid phone number. Use format: +256XXXXXXXXX' })
    }

    // Rate limit: max 3 OTP requests per hour per number
    if (!checkRateLimit(phone)) {
      return res.status(429).json({ error: 'Too many requests. Try again later.' })
    }

    const otp = generateOTP()
    const expiresAt = Date.now() + 2 * 60 * 1000 // 2 minutes

    otpStore.set(phone, { otp, expiresAt })

    console.log(`[OTP] Generated for ${phone}: ${otp} (expires in 2 min)`)

    // Send SMS via Africastalking
    try {
      const response = await sms.send({
        to: [phone],
        message: `Your Rachett verification code is: ${otp}. It expires in 2 minutes.`,
        from: process.env.AT_SENDER_ID || '',
      })
      console.log('[SMS] Sent:', response)
    } catch (smsError) {
      console.error('[SMS] Failed to send:', smsError)
      // In development/sandbox, still return success so we can test
      if (process.env.AT_USERNAME !== 'sandbox') {
        return res.status(500).json({ error: 'Failed to send SMS. Try again.' })
      }
      console.log('[SMS] Sandbox mode — OTP will be logged to console for testing')
    }

    // In sandbox mode, return the OTP in the response for testing
    const isSandbox = process.env.AT_USERNAME === 'sandbox' || !process.env.AT_API_KEY

    res.json({
      success: true,
      message: 'OTP sent successfully',
      ...(isSandbox ? { debugOtp: otp } : {}),
    })
  } catch (err) {
    console.error('[OTP] Error:', err)
    res.status(500).json({ error: 'Server error. Try again.' })
  }
})

// ─── POST /api/otp/verify ──────────────────────────────────────────
// Body: { phone: "+256771234567", otp: "123456" }
app.post('/api/otp/verify', (req, res) => {
  try {
    const { phone, otp } = req.body

    if (!phone || !otp) {
      return res.status(400).json({ error: 'Phone and OTP are required.' })
    }

    const stored = otpStore.get(phone)

    if (!stored) {
      return res.status(400).json({ error: 'No OTP found. Request a new one.' })
    }

    if (Date.now() > stored.expiresAt) {
      otpStore.delete(phone)
      return res.status(400).json({ error: 'OTP expired. Request a new one.' })
    }

    if (stored.otp !== otp) {
      return res.status(400).json({ error: 'Invalid OTP. Try again.' })
    }

    // OTP verified — clean up
    otpStore.delete(phone)

    res.json({
      success: true,
      message: 'Phone verified successfully',
      phone,
    })
  } catch (err) {
    console.error('[OTP] Verify error:', err)
    res.status(500).json({ error: 'Server error. Try again.' })
  }
})

// ─── Health check ───────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ─── Start server ───────────────────────────────────────────────────
const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`🚀 Rachett OTP server running on http://localhost:${PORT}`)
  console.log(`   Sandbox mode: ${process.env.AT_USERNAME === 'sandbox' || !process.env.AT_API_KEY ? 'YES (OTP shown in response)' : 'NO'}`)
})
