# SocialBridge MVP Launch Checklist

## ✅ COMPLETED
- [x] Input validation & sanitization (SetupStore, StorePage)
- [x] Error handling on all Firebase calls
- [x] TypeScript types (replace `any` with proper interfaces)
- [x] Image file validation (size & type)
- [x] Firestore security rules
- [x] Form validation with user feedback

## 🔴 CRITICAL - MUST DO BEFORE LAUNCH

### 1. Payment Processing
- [ ] Integrate Flutterwave or Stripe
- [ ] Add `status` field to orders (pending_payment → paid → fulfilled)
- [ ] Update handleOrder() with payment flow
- [ ] Test payments in sandbox

**Time:** 2-4 hours

### 2. Environment Variables
- [ ] Add Firebase config to `.env` (check if using VITE_*)
- [ ] Add payment gateway keys
- [ ] Add Cloudinary API keys
- [ ] Create `.env.example` for team

**Time:** 30 mins

### 3. Deployment Setup
- [ ] Create Vercel project
- [ ] Add env vars to Vercel Settings
- [ ] Deploy and test
- [ ] Update product URLs in code

**Time:** 1 hour

### 4. Firestore Security Rules
- [ ] Deploy rules: `firebase deploy --only firestore:rules`
- [ ] Test security with unauthenticated user
- [ ] Verify sellers can't read other sellers' orders

**Time:** 30 mins

### 5. Email Notifications (MVP minimum)
- [ ] Send seller email when order received
- [ ] Send buyer WhatsApp link after order
- [ ] Use Firebase Cloud Functions or SendGrid

**Time:** 1-2 hours

## 🟡 IMPORTANT - NEXT SPRINT

- [ ] Error tracking (Sentry/LogRocket)
- [ ] Analytics (Amplitude/Mixpanel)
- [ ] Fulfillment tracking UI
- [ ] Buyer account system
- [ ] Product categories UI
- [ ] Search optimization
- [ ] Mobile responsive fixes
- [ ] Performance optimization (N+1 query in BrowsePage)

## 🟢 NICE TO HAVE

- [ ] Product reviews/ratings
- [ ] Seller verification badges
- [ ] Bulk product import
- [ ] Inventory management
- [ ] Shipping integration
- [ ] Multi-currency support

---

## Testing Checklist

Before launch, test:
- [x] Sign up → onboarding → setup store
- [x] Add product with image
- [x] Search/filter products
- [x] Create order
- [ ] Payment flow end-to-end
- [ ] WhatsApp integration
- [ ] Email notifications
- [ ] Security rules (unauthorized access blocked)
- [ ] Mobile responsiveness
- [ ] Error states (network issues, validation failures)

## Launch Readiness: 40% (Needs payment + deployment)
