import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider, FacebookAuthProvider, OAuthProvider, PhoneAuthProvider, RecaptchaVerifier, setPersistence, browserLocalPersistence } from "firebase/auth";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Log minimal config at startup to help debug wrong-project / missing env issues.
console.log('Firebase config:', { projectId: firebaseConfig.projectId, authDomain: firebaseConfig.authDomain, apiKeySet: !!firebaseConfig.apiKey });

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Ensure auth persistence (remember signed-in users across reloads).
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn('Failed to set auth persistence:', err);
});

export const googleProvider = new GoogleAuthProvider();
export const facebookProvider = new FacebookAuthProvider();
export const appleProvider = new OAuthProvider('apple.com');
export const phoneProvider = new PhoneAuthProvider(auth);
export const storage = getStorage(app);

// Helper to create a new reCAPTCHA verifier instance (call once per sign-in attempt)
export function createRecaptchaVerifier(containerId: string) {
  return new RecaptchaVerifier(auth, containerId, {
    size: 'invisible',
    callback: () => {
      // reCAPTCHA solved — allow signInWithPhoneNumber
    },
  });
}
