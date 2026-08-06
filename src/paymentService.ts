/**
 * Rachett Payment Service
 * 
 * Flutterwave integration — Pan-African payments.
 * Every African currency. Every payment method.
 * 
 * Public key is safe in frontend — identifies your account only.
 * Transaction verification is handled server-side on Flutterwave.
 */

export interface FlutterwaveConfig {
  publicKey: string
  txRef: string
  amount: number
  currency: string
  /** 2-letter country code (e.g. UG, KE, NG, GH, ZA) */
  country: string
  customer: {
    email: string
    phone_number: string
    name: string
  }
  customizations: {
    title: string
    description: string
    logo: string
  }
  redirect_url?: string
}

export interface PaymentResult {
  success: boolean
  transactionId?: string
  flwRef?: string
  status: string
  amount: number
  currency: string
  customer: {
    name: string
    email: string
    phone: string
  }
  paymentMethod?: string
  createdAt: string
}

export type PaymentStatus = 'initiated' | 'completed' | 'failed' | 'cancelled'

interface FlutterwaveCallback {
  tx_ref: string
  flw_ref: string
  transaction_id: string | number
  status: string
  amount: number
  currency: string
  customer: {
    name: string
    email: string
    phone_number: string
  }
  payment_type?: string
  created_at: string
  charge_response_code?: string
  charge_response_message?: string
}

/**
 * All African currencies supported by Flutterwave.
 * Key: currency code, Value: { name, countryCode for default country }
 */
export const AFRICAN_CURRENCIES: Record<string, { name: string; country: string; symbol: string }> = {
  UGX: { name: 'Ugandan Shilling', country: 'UG', symbol: 'USh' },
  KES: { name: 'Kenyan Shilling', country: 'KE', symbol: 'KSh' },
  TZS: { name: 'Tanzanian Shilling', country: 'TZ', symbol: 'TSh' },
  RWF: { name: 'Rwandan Franc', country: 'RW', symbol: 'RF' },
  NGN: { name: 'Nigerian Naira', country: 'NG', symbol: '₦' },
  GHS: { name: 'Ghanaian Cedi', country: 'GH', symbol: 'GH₵' },
  ZAR: { name: 'South African Rand', country: 'ZA', symbol: 'R' },
  ZMW: { name: 'Zambian Kwacha', country: 'ZM', symbol: 'ZK' },
  MWK: { name: 'Malawian Kwacha', country: 'MW', symbol: 'MK' },
  XOF: { name: 'West African CFA Franc', country: 'CI', symbol: 'CFA' },
  XAF: { name: 'Central African CFA Franc', country: 'CM', symbol: 'CFA' },
  ETB: { name: 'Ethiopian Birr', country: 'ET', symbol: 'Br' },
  SZL: { name: 'Swazi Lilangeni', country: 'SZ', symbol: 'E' },
  LSL: { name: 'Lesotho Loti', country: 'LS', symbol: 'M' },
  BWP: { name: 'Botswana Pula', country: 'BW', symbol: 'P' },
  NAD: { name: 'Namibian Dollar', country: 'NA', symbol: 'N$' },
  MUR: { name: 'Mauritian Rupee', country: 'MU', symbol: '₨' },
  SCR: { name: 'Seychellois Rupee', country: 'SC', symbol: 'SR' },
  MZN: { name: 'Mozambican Metical', country: 'MZ', symbol: 'MT' },
  AOA: { name: 'Angolan Kwanza', country: 'AO', symbol: 'Kz' },
  USD: { name: 'US Dollar', country: 'US', symbol: '$' },
  GBP: { name: 'British Pound', country: 'GB', symbol: '£' },
  EUR: { name: 'Euro', country: 'DE', symbol: '€' },
}

export function currencyFromCountry(country: string): { code: string; symbol: string } | null {
  const match = Object.entries(AFRICAN_CURRENCIES).find(([, v]) => v.country === country)
  return match ? { code: match[0], symbol: match[1].symbol } : null
}

const ALL_PAYMENT_OPTIONS = [
  'card',
  'account',
  'bank_transfer',
  'ussd',
  'mpesa',
  'mobilemoneyuganda',
  'mobilemoneyghana',
  'mobilemoneytanzania',
  'mobilemoneyzambia',
  'mobilemoneyrwanda',
  'mobilemoneyfranco',
  'mobilemoneyzimbabwe',
  'mobilemoneymalawi',
  'mobilemoneymozambique',
  'mobilemoneybotswana',
  'mobilemoneycameroon',
  'mobilemoneyivorycoast',
  'mobilemoneysenegal',
  'mobilemoneyburkinafaso',
  'mobilemoneybenin',
  'mobilemoneyguinea',
  'mobilemoneyniger',
  'mobilemoneytogo',
  'mobilemoneymali',
  'mobilemoneysierraleone',
  'mobilemoneyliberia',
  'mobilemoneygambia',
  'mobilemoneyguineabissau',
  'credit',
  'paga',
  '1voucher',
  'airtelmoney',
  'orangemoney',
  'africellmoney',
  'mtnmoney',
  'vodafonemoney',
  'tigomoney',
  'payattitude',
  'barter',
].join(', ')

/**
 * Initializes Flutterwave inline payment modal.
 * Uses Flutterwave's inline script — no redirect needed.
 */
export function initializeFlutterwavePayment(
  config: FlutterwaveConfig,
  onSuccess: (result: PaymentResult) => void,
  onClose: () => void,
  onError: (error: string) => void
): void {
  const publicKey = config.publicKey || import.meta.env.VITE_FLUTTERWAVE_PUBLIC_KEY || ''

  if (!publicKey) {
    onError('Payment is not configured yet. Contact support.')
    return
  }

  // @ts-ignore — Flutterwave inline script loaded via index.html
  if (typeof window === 'undefined' || !(window as any).FlutterwaveCheckout) {
    // Load the script dynamically
    const script = document.createElement('script')
    script.src = 'https://checkout.flutterwave.com/v3.js'
    script.onload = () => openFlutterwaveModal(config, onSuccess, onClose, onError)
    script.onerror = () => onError('Failed to load payment system. Check your connection.')
    document.head.appendChild(script)
    return
  }

  openFlutterwaveModal(config, onSuccess, onClose, onError)
}

function openFlutterwaveModal(
  config: FlutterwaveConfig,
  onSuccess: (result: PaymentResult) => void,
  onClose: () => void,
  onError: (error: string) => void
): void {
  const FlutterwaveCheckout = (window as any).FlutterwaveCheckout

  const handlePayment = FlutterwaveCheckout({
    public_key: config.publicKey || import.meta.env.VITE_FLUTTERWAVE_PUBLIC_KEY,
    tx_ref: config.txRef,
    amount: config.amount,
    currency: config.currency || 'UGX',
    country: config.country || 'UG',
    payment_options: ALL_PAYMENT_OPTIONS,
    redirect_url: config.redirect_url || window.location.href,
    customer: config.customer,
    customizations: {
      ...config.customizations,
    },
    callback: (response: FlutterwaveCallback) => {
      // Flutterwave calls this after payment completes
      console.log('[Rachett Payment] Flutterwave callback:', response)

      if (response.status === 'successful' || response.status === 'completed') {
        onSuccess({
          success: true,
          transactionId: String(response.transaction_id),
          flwRef: response.flw_ref,
          status: 'completed',
          amount: response.amount,
          currency: response.currency,
          customer: {
            name: response.customer?.name || config.customer.name,
            email: response.customer?.email || config.customer.email,
            phone: response.customer?.phone_number || config.customer.phone_number,
          },
          paymentMethod: response.payment_type || 'flutterwave',
          createdAt: response.created_at || new Date().toISOString(),
        })
      } else {
        onError(response.charge_response_message || 'Payment was not successful. Please try again.')
      }

      handlePayment.close()
    },
    onclose: () => {
      // User closed the modal — not an error, just dismissed
      console.log('[Rachett Payment] Modal closed by user')
      onClose()
    },
  })
}

/**
 * Verifies a Flutterwave transaction server-side.
 * Use this from Firebase Cloud Functions or backend.
 */
export async function verifyFlutterwaveTransaction(
  transactionId: string
): Promise<{ verified: boolean; status: string; amount: number }> {
  try {
    const secretKey = import.meta.env.VITE_FLUTTERWAVE_SECRET_KEY
    if (!secretKey) {
      console.error('[Rachett Payment] No secret key configured for verification')
      return { verified: false, status: 'error', amount: 0 }
    }

    const response = await fetch(`https://api.flutterwave.com/v3/transactions/${transactionId}/verify`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
    })

    const data = await response.json()

    if (data.status === 'success' && data.data?.status === 'successful') {
      return {
        verified: true,
        status: 'completed',
        amount: data.data.amount,
      }
    }

    return { verified: false, status: data.data?.status || 'unknown', amount: 0 }
  } catch (error) {
    console.error('[Rachett Payment] Verification error:', error)
    return { verified: false, status: 'error', amount: 0 }
  }
}

/**
 * Generates a unique transaction reference.
 */
export function generateTxRef(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `RT-${timestamp}-${random}`.toUpperCase()
}

/**
 * Map Flutterwave payment type to human-readable label.
 */
export function paymentMethodLabel(paymentType?: string): string {
  if (!paymentType) return 'Flutterwave'
  const lower = paymentType.toLowerCase()
  if (lower.includes('mobilemoney') || lower.includes('mobile_money')) return 'Mobile Money'
  if (lower.includes('mpesa')) return 'M-Pesa'
  if (lower.includes('airtel')) return 'Airtel Money'
  if (lower.includes('mtn')) return 'MTN MoMo'
  if (lower.includes('card')) return 'Card'
  if (lower.includes('bank')) return 'Bank Transfer'
  if (lower.includes('ussd')) return 'USSD'
  return paymentType
}