import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getMessaging } from 'firebase/messaging';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(
  app,
  typeof window !== 'undefined' ? { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) } : {},
  firebaseConfig.firestoreDatabaseId
);
export const googleProvider = new GoogleAuthProvider();
export const messaging = typeof window !== 'undefined' && 'Notification' in window ? getMessaging(app) : null;
