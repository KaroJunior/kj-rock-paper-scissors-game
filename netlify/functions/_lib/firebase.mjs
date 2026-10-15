// Server-only Firebase Admin initialisation.
import admin from 'firebase-admin';

let db = null;

export function getDb() {
  if (db) return db;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKeyRaw) {
    throw new Error('Firebase env vars are missing (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY).');
  }

  const privateKey = privateKeyRaw.replace(/\\n/g, '\n');

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
  }

  db = admin.firestore();
  return db;
}