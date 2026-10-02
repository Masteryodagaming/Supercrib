/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_DATABASE_URL: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_APP_ID: string;
  readonly VITE_OWNER_USER_ID?: string;
  readonly VITE_OWNER_EMAIL?: string;
  readonly VITE_OWNER_USERNAME?: string;
  readonly VITE_TOURNAMENTS_PUBLIC_HOSTING?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
