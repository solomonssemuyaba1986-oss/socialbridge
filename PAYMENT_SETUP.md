# Payment Integration Setup Guide

## Critical for MVP Launch

Your app currently collects orders but doesn't process payments. Choose one:

### Option 1: Stripe (Recommended - Global, but Uganda may have limitations)
**Setup:**
1. Create account: https://stripe.com
2. Install: `npm install stripe @stripe/react-stripe-js`
3. Add to `.env`:
```
VITE_STRIPE_PUBLIC_KEY=pk_test_...
VITE_STRIPE_SECRET_KEY=sk_test_...
```

**Implementation:**
- Add checkout button to StorePage.tsx `handleOrder()`
- Redirect to Stripe checkout session
- Store payment status in orders collection

### Option 2: Flutterwave (Uganda-Friendly ✅)
**Setup:**
1. Create account: https://flutterwave.com
2. Install: `npm install flutterwave-react-v3`
3. Add to `.env`:
```
VITE_FLUTTERWAVE_PUBLIC_KEY=FLWPUBK_TEST_...
```

**Implementation:**
```tsx
import { useFlutterwave } from "flutterwave-react-v3";

const handleFlutterwavePayment = useFlutterwave({
  public_key: import.meta.env.VITE_FLUTTERWAVE_PUBLIC_KEY,
  tx_ref: Date.now().toString(),
  amount: parseFloat(orderProduct.price),
  currency: "UGX",
  payment_options: "card, ussd, mobilemoney",
  customer: {
    email: buyerName,
    phone_number: seller.whatsapp,
    name: buyerName,
  },
  customizations: {
    title: "Rachett Order",
    description: `${orderProduct.name} x${quantity}`,
    logo: "https://...",
  },
});
```

### Option 3: Direct Transfers (MVP MVP)
For fastest MVP launch, skip payment processing and have buyers:
1. Transfer directly to seller's UGX account
2. Confirm in chat
3. Seller marks order as fulfilled

**Update in handleOrder():**
```tsx
// Just create order without payment
// Seller receives WhatsApp message with buyer's number
// Buyer transfers funds directly
```

## Immediate Actions:

1. **Pick Option** (recommend Flutterwave for Uganda market)
2. **Update handleOrder()** in StorePage.tsx
3. **Add status tracking**: `pending_payment` → `paid` → `fulfilled`
4. **Test payments** in sandbox mode
5. **Deploy** with payment gateway credentials in Vercel env vars

## Security Notes:
- Never expose secret keys in frontend
- Use Firebase Cloud Functions for payment processing
- Validate amounts server-side
- Webhook handlers for payment confirmation

**Timeline:** 2-4 hours to implement depending on payment provider
