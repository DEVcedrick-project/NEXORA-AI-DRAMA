export { initializeApp, getApps, deleteApp } from "firebase/app";
export {
  getAuth,
  browserLocalPersistence,
  setPersistence,
  signInAnonymously,
  signInWithCustomToken,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  EmailAuthProvider,
  linkWithCredential,
  updateProfile,
  sendPasswordResetEmail,
  signOut
} from "firebase/auth";
export {
  getDatabase,
  ref,
  get,
  onValue,
  update,
  serverTimestamp
} from "firebase/database";
