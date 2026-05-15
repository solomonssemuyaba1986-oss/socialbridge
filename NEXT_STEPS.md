# 🚀 IMMEDIATE ACTION PLAN (Next 24 Hours)

## Status: MVP-Ready Code ✅ | Not Market-Ready ❌ (Missing: Payment + Deployment)

---

## STEP 1: Choose Your Payment Provider (30 mins)

### Option A: **Flutterwave** ✅ RECOMMENDED FOR UGANDA
- Direct Uganda support
- Supports Mobile Money + Card
- Lower fees (~1.4%)
- Best for MVP speed

**Setup:**
1. Go to https://flutterwave.com/signup
2. Create test account
3. Get Public Key from Dashboard → Settings
4. Go to Step 2 below

### Option B: Stripe
- Global support
- May have Uganda limitations
- Higher fees (~2.9%)
- More integrations available

**Choose One & Continue**

---

## STEP 2: Set Up Environment Variables (15 mins)

Create `.env.local` in project root:

```
# Firebase
VITE_FIREBASE_API_KEY=your_key_here
VITE_FIREBASE_AUTH_DOMAIN=your_domain.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id

# Cloudinary (already set up in code)
VITE_CLOUDINARY_CLOUD_NAME=dzudmmuxg
VITE_CLOUDINARY_UPLOAD_PRESET=p2z65zrv

# Flutterwave (if using)
VITE_FLUTTERWAVE_PUBLIC_KEY=FLWPUBK_TEST_...
```

**Get Firebase keys:**
1. Go to https://console.firebase.google.com
2. Select your project → Settings → Project Settings
3. Copy credentials

---

## STEP 3: Deploy Firestore Rules (10 mins)

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules
```

This secures your database so:
- Sellers can't read other sellers' orders
- Buyers can't access private data
- Orders are write-restricted

---

## STEP 4: Test Locally (30 mins)

```bash
npm run dev
```

Test these flows (validation should catch errors):

✅ **Sign Up Flow**
- Click "Get Started"
- Sign in with Google
- Should see onboarding

✅ **Setup Store**
- Click "I'm a Seller"
- Fill form (test validation with empty fields)
- Should create store + redirect to dashboard

✅ **Add Product**
- Dashboard → Add Product
- Upload image (test with non-image file - should reject)
- Create product

✅ **Browse**
- Onboarding → "I'm a Buyer"
- Should see all products
- Can search/filter

---

## STEP 5: Integrate Payment (2-4 hours)

### If Using Flutterwave:

In `src/StorePage.tsx`, update `handleOrder()`:

```tsx
const handleOrder = async () => {
  // ... existing validation ...
  
  if (!orderProduct || !seller) return
  
  // Call Flutterwave
  const response = await fetch('https://api.flutterwave.com/v3/payments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_FLUTTERWAVE_SECRET}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      amount: orderProduct.price,
      currency: 'UGX',
      email: 'buyer@example.com',
      phone_number: buyerName,
      redirect_url: `${window.location.origin}/store/${seller.slug}`,
      tx_ref: `order_${Date.now()}`,
      customizations: {
        title: 'SocialBridge Order',
        description: `${orderProduct.name} x${qty}`
      }
    })
  })
  
  const data = await response.json()
  if (data.status === 'success') {
    // Create order in Firestore with status "paid"
    await addDoc(collection(db, 'sellers', sellerId, 'orders'), {
      buyerName: cleanName,
      productName: orderProduct.name,
      productPrice: orderProduct.price,
      quantity: qty,
      status: 'paid', // ← CHANGED
      paymentId: data.data.id,
      createdAt: new Date()
    })
    // Redirect to seller WhatsApp
    window.open(`https://wa.me/${seller.whatsapp}?text=...`)
  }
}
```

---

## STEP 6: Deploy to Vercel (30 mins)

```bash
npm install -g vercel
vercel

# When prompted:
# - Link to existing project or create new
# - Add env variables in Vercel dashboard:
#   Settings → Environment Variables → Add all from .env.local
```

**Important:** Add env vars BEFORE deploying, or redeploy after.

---

## STEP 7: Final Testing (1 hour)

Test in production (vercel.app domain):

1. **Seller Flow**
   - Sign up
   - Create store
   - Add product
   - Check dashboard

2. **Buyer Flow**
   - Browse page
   - Search products
   - Create order
   - **PAYMENT** (test card: 4111 1111 1111 1111)

3. **WhatsApp Integration**
   - After order, should get WhatsApp link
   - Click it (opens WhatsApp web)
   - Message shows product details

4. **Security**
   - Try accessing other seller's orders (should fail)
   - Try modifying order status (should fail)

---

## GOTCHAS & FIXES

| Issue | Fix |
|-------|-----|
| Payment keys leak in frontend | Use backend API for payments (Cloud Functions) |
| Firestore rules not deployed | Run `firebase deploy --only firestore:rules` |
| Env vars not loading | Check `.env.local` is in root, not in `src/` |
| Build fails on deployment | Clear cache: `vercel env pull && npm run build` |
| Images not uploading | Check Cloudinary preset is active |

---

## Success Checklist

- [ ] Flutterwave/Stripe account created
- [ ] Env vars in `.env.local`
- [ ] Firestore rules deployed
- [ ] Local tests pass (all flows working)
- [ ] Build succeeds (`npm run build`)
- [ ] Deployed to Vercel
- [ ] Payment test successful (test card works)
- [ ] Seller can mark order fulfilled
- [ ] WhatsApp link works

---

## GO LIVE CHECKLIST

Before announcing to users:
- [ ] Payment working end-to-end
- [ ] Email confirmations working
- [ ] Support email/chat set up
- [ ] Terms of Service page
- [ ] Privacy Policy updated
- [ ] Test with real money (small amount)
- [ ] Backup Firestore data

---

## TIME ESTIMATE

| Task | Time |
|------|------|
| Payment setup | 2-4 hrs |
| Local testing | 30 mins |
| Vercel deployment | 30 mins |
| Final testing | 1 hr |
| **TOTAL** | **4-6 hours** |

**Recommendation:** Do this today, launch tomorrow

---

## SUPPORT

If stuck:
1. Check `PAYMENT_SETUP.md` for payment details
2. Check `FIXES_SUMMARY.md` for what was changed
3. Check `MVP_CHECKLIST.md` for what's missing
4. Check console errors: `F12 → Console tab`
5. Check Vercel logs: `vercel logs`

**You got this! 🚀**
