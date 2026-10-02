import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getDatabase, type Database } from 'firebase/database';

export interface FirebaseEnvConfig {
  apiKey: string;
  authDomain: string;
  databaseURL: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
}

/** Trim env strings; empty / whitespace-only → missing. */
function envString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function readFirebaseConfig(): FirebaseEnvConfig | null {
  const apiKey = envString(import.meta.env.VITE_FIREBASE_API_KEY);
  const authDomain = envString(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN);
  let databaseURL = envString(import.meta.env.VITE_FIREBASE_DATABASE_URL);
  const projectId = envString(import.meta.env.VITE_FIREBASE_PROJECT_ID);
  const appId = envString(import.meta.env.VITE_FIREBASE_APP_ID);
  const storageBucket = envString(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET);

  if (!apiKey || !authDomain || !databaseURL || !projectId || !appId) {
    return null;
  }

  // RTDB rejects / is picky about a trailing slash on databaseURL
  databaseURL = databaseURL.replace(/\/+$/, '');

  return {
    apiKey,
    authDomain,
    databaseURL,
    projectId,
    appId,
    storageBucket: storageBucket || undefined,
  };
}

export function isFirebaseConfigured(): boolean {
  return readFirebaseConfig() !== null;
}

let app: FirebaseApp | null = null;
let db: Database | null = null;
let auth: Auth | null = null;

export function getFirebaseApp(): FirebaseApp {
  const cfg = readFirebaseConfig();
  if (!cfg) {
    throw new Error(
      'Firebase is not configured. Copy .env.example to .env and fill VITE_FIREBASE_* values.',
    );
  }
  if (!app) {
    app = getApps().length ? getApps()[0]! : initializeApp(cfg);
  }
  return app;
}

export function getFirebaseDb(): Database {
  if (!db) {
    db = getDatabase(getFirebaseApp());
  }
  return db;
}

/** Firebase Auth singleton (same app as RTDB). Free Spark — Google provider. */
export function getFirebaseAuth(): Auth {
  if (!auth) {
    auth = getAuth(getFirebaseApp());
  }
  return auth;
}
