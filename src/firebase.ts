// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCtCgwgi8LoqvMl4oDI-npb63A1GvvFbvk",
  authDomain: "socialbridge-93ee1.firebaseapp.com",
  projectId: "socialbridge-93ee1",
  storageBucket: "socialbridge-93ee1.firebasestorage.app",
  messagingSenderId: "287573785988",
  appId: "1:287573785988:web:14227d58017b47b40171d1",
  measurementId: "G-KHMKXFQ1RG"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore
export const db = getFirestore(app);

// Initialize Auth
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();