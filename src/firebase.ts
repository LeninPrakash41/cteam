import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import configFile from '../firebase-applet-config.json';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || configFile.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || configFile.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || configFile.projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || configFile.storageBucket,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || configFile.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || configFile.appId,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || configFile.measurementId,
};

const databaseId = import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || configFile.firestoreDatabaseId;

const app = initializeApp(firebaseConfig);
export const db = databaseId ? getFirestore(app, databaseId) : getFirestore(app);
export const auth = getAuth(app);

export const signInWithGoogle = async () => {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error("Error signing in with Google", error);
  }
};

export const logOut = async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Error signing out", error);
  }
};
