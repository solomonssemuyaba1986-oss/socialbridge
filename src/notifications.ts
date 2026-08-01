/**
 * Rachett Notification Service
 * 
 * Structured, human-readable messages that help users troubleshoot.
 * Replaces raw alert() calls and inconsistent showFeedback patterns.
 * 
 * Pattern: What happened → Why → What to do next
 */

export const notify = {
  // ---------- Orders ----------
  orderSent: 'Great! Your order is on the way. The seller will confirm it quickly.',
  orderFailed: "Order didn't go through. Check your connection and try again.",
  orderSelfBlock: "You can't order from your own store. Browse other sellers to buy from them.",
  orderNameRequired: 'Please enter your name — the seller needs it to confirm your order.',
  orderDeliveryRequired: 'Please add your delivery area so the seller can quote delivery.',
  orderSellerNotFound: 'Seller info not available. Please try again.',
  orderConfirm: 'Tap Confirm to let the buyer know their order is accepted.',

  // ---------- Messaging ----------
  messageSent: 'Message sent! The seller will see it soon and reply.',
  messageFailed: 'Message failed to send. Check your connection and try again.',
  messageSignInRequired: 'Sign in so your message reaches the seller. It only takes a moment.',
  messageSelfBlock: "You can't message your own store. Browse other sellers to start a chat.",
  messageWriteRequired: 'Write a quick message so the seller can reply.',
  messageProductRequired: 'Choose a product first, then send your question to the seller.',
  messageSellerNotFound: "Seller info isn't available right now. Please try again.",

  // ---------- Auth ----------
  signUpSuccess: "You're signed in! Complete your action now.",
  signUpFailed: "Sign up didn't work. Make sure pop-ups are allowed in your browser, then try again.",
  signInFailed: "Sign in didn't work. Check that pop-ups are enabled for this site and try again.",
  authRequired: 'Please sign in to continue.',

  // ---------- Products ----------
  productSaved: 'Product saved successfully.',
  productDeleted: 'Product deleted. It will no longer appear on your store.',
  productSaveFailed: "Couldn't save the product. Please check your connection and try again.",
  productDeleteFailed: "Couldn't delete the product. Please try again.",
  productNamePriceRequired: 'Please add a product name and price before saving.',
  productImageRequired: 'Please upload a product image before saving.',
  productCategoryRequired: 'Please select a category for this product.',
  productSubcategoryRequired: 'Please select a subcategory for this product.',
  productMaxImages: 'Maximum 4 images per product. Remove one to add a new image.',

  // ---------- Store ----------
  storeSaved: 'Store settings saved.',
  storeLinkCopied: 'Link copied! Paste it anywhere you sell.',
  storeNotFound: "This store doesn't exist yet. Try searching for another seller.",
  editProductInfo: 'Edit your product details below. Save when done.',

  // ---------- File Uploads ----------
  fileTypeInvalid: 'Please upload a JPG, PNG, or PDF file for this document.',
  fileTooLarge: 'File must be under 10MB. Try compressing it first.',
  geolocationDenied: 'Location access denied. Please enter your location manually.',
  geolocationUnavailable: 'Could not get your location. Please enter it manually.',
  uploading: 'Uploading — please wait...',

  // ---------- Network ----------
  networkError: 'A network error occurred. Please check your connection and try again.',
  permissionDenied: "You don't have permission to do this. Try signing in again.",

  // ---------- Generic ----------
  somethingWentWrong: 'Something went wrong. Please try again in a moment.',
  comingSoon: 'This feature is coming soon. Stay tuned!',
} as const

export type NotifyKey = keyof typeof notify