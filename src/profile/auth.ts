/**
 * Firebase Auth: Google + Email/Password (Spark).
 * First successful sign-in (either method) creates the Firebase / Supercrib account
 * (Login + Home + Settings use the same cloud hydrate/sync).
 *
 * Joshua — enable in Firebase Console before Sign in works:
 *   Authentication → Sign-in method → Google → Enable
 *   Authentication → Sign-in method → Email/Password → Enable
 *   (also add your hosting domain under Authentication → Settings → Authorized domains)
 *
 * Google: popup first; on popup-blocked / network-request-failed / cancelled-popup, fall back
 * to signInWithRedirect (phones / in-app browsers). Call getGoogleRedirectResult() on boot.
 *
 * Guest / play-without-login stays available for AI and room-code multiplayer.
 */
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getRedirectResult,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { getFirebaseAuth, isFirebaseConfigured } from '../multiplayer/firebase';

export interface AuthUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  /** Primary Firebase providerId, e.g. 'google.com' | 'password'. */
  providerId: string | null;
}

/** Firebase Auth codes that typically mean the popup path cannot complete. */
const REDIRECT_FALLBACK_CODES = new Set([
  'auth/popup-blocked',
  'auth/network-request-failed',
  'auth/cancelled-popup-request',
]);

function primaryProviderId(user: User): string | null {
  const ids = user.providerData.map((p) => p.providerId);
  if (ids.includes('google.com')) return 'google.com';
  if (ids.includes('password')) return 'password';
  return ids[0] ?? null;
}

function toAuthUser(user: User): AuthUser {
  return {
    uid: user.uid,
    displayName: user.displayName,
    email: user.email,
    photoURL: user.photoURL,
    providerId: primaryProviderId(user),
  };
}

/** Short UI label: Google vs Email vs Account. */
export function authProviderLabel(user: AuthUser | null | undefined): string {
  if (!user) return 'Account';
  if (user.providerId === 'google.com') return 'Google';
  if (user.providerId === 'password') return 'Email';
  return 'Account';
}

function authErrorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    return String((err as { code: unknown }).code);
  }
  return '';
}

function createGoogleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

function shouldFallbackToRedirect(err: unknown): boolean {
  const code = authErrorCode(err);
  if (REDIRECT_FALLBACK_CODES.has(code)) return true;
  const message = err instanceof Error ? err.message : String(err ?? '');
  return (
    /popup.?blocked/i.test(message) ||
    /network-request-failed/i.test(message) ||
    /cancelled-popup/i.test(message)
  );
}

export function subscribeAuth(cb: (user: AuthUser | null) => void): () => void {
  if (!isFirebaseConfigured()) {
    cb(null);
    return () => {};
  }
  try {
    return onAuthStateChanged(getFirebaseAuth(), (u) => cb(u ? toAuthUser(u) : null));
  } catch {
    cb(null);
    return () => {};
  }
}

export function formatAuthError(err: unknown): string {
  const code = authErrorCode(err);
  const message = err instanceof Error ? err.message : String(err ?? '');

  if (code === 'auth/operation-not-allowed' || /operation-not-allowed/i.test(message)) {
    return 'That sign-in method is not enabled yet. In Firebase Console: Authentication → Sign-in method → enable Google and/or Email/Password.';
  }
  if (code === 'auth/weak-password' || /weak-password/i.test(message)) {
    return 'Password is too weak. Use at least 6 characters.';
  }
  if (code === 'auth/email-already-in-use' || /email-already-in-use/i.test(message)) {
    return 'An account already exists with this email. Sign in instead, or use Google if you signed up that way.';
  }
  if (code === 'auth/wrong-password' || /wrong-password/i.test(message)) {
    return 'Incorrect password. Try again or tap Forgot password.';
  }
  if (code === 'auth/user-not-found' || /user-not-found/i.test(message)) {
    return 'No account found for that email. Create an account or check the address.';
  }
  if (code === 'auth/invalid-email' || /invalid-email/i.test(message)) {
    return 'That email address looks invalid. Check the spelling and try again.';
  }
  if (code === 'auth/missing-email' || /missing-email/i.test(message)) {
    return 'Enter your email to reset the password.';
  }
  if (code === 'auth/invalid-credential' || /invalid-credential/i.test(message)) {
    return 'Email or password is incorrect. Try again, tap Forgot password, or create an account.';
  }
  if (code === 'auth/too-many-requests' || /too-many-requests/i.test(message)) {
    return 'Too many attempts. Wait a moment and try again.';
  }
  if (code === 'auth/popup-blocked' || /popup.?blocked/i.test(message)) {
    return 'Sign-in popup was blocked. Allow popups for this site and try again.';
  }
  if (code === 'auth/popup-closed-by-user' || /popup-closed/i.test(message)) {
    return 'Sign-in cancelled.';
  }
  if (code === 'auth/unauthorized-domain' || /unauthorized-domain/i.test(message)) {
    return 'This domain is not authorized. Add it under Authentication → Settings → Authorized domains.';
  }
  if (code === 'auth/network-request-failed' || /network-request-failed/i.test(message)) {
    return 'Network error during sign-in. Check your connection and try again. (auth/network-request-failed)';
  }
  if (!isFirebaseConfigured()) {
    return 'Firebase is not configured (.env missing VITE_FIREBASE_* values).';
  }
  const base = message || 'Sign-in failed.';
  if (code && !base.includes(code)) {
    return `${base} (${code})`;
  }
  return base;
}

/**
 * Consume a pending Google redirect result (call once on app boot).
 * Returns the signed-in user, or null if this load was not a redirect return.
 */
export async function getGoogleRedirectResult(): Promise<AuthUser | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const cred = await getRedirectResult(getFirebaseAuth());
    return cred?.user ? toAuthUser(cred.user) : null;
  } catch (err) {
    throw new Error(formatAuthError(err));
  }
}

/** Full-page Google redirect (phones / popup-hostile browsers). Page will navigate away. */
export async function signInWithGoogleRedirect(): Promise<void> {
  if (!isFirebaseConfigured()) {
    throw new Error(formatAuthError({ code: 'auth/not-configured', message: 'not configured' }));
  }
  const auth = getFirebaseAuth();
  await signInWithRedirect(auth, createGoogleProvider());
}

/**
 * Google sign-in. Tries popup first; on popup-blocked / network-request-failed /
 * cancelled-popup, auto-falls back to signInWithRedirect.
 * Throws with a user-facing message via formatAuthError.
 */
export async function signInWithGoogle(): Promise<AuthUser> {
  if (!isFirebaseConfigured()) {
    throw new Error(formatAuthError({ code: 'auth/not-configured', message: 'not configured' }));
  }
  const auth = getFirebaseAuth();
  const provider = createGoogleProvider();
  try {
    const cred = await signInWithPopup(auth, provider);
    return toAuthUser(cred.user);
  } catch (err) {
    if (shouldFallbackToRedirect(err)) {
      try {
        await signInWithRedirect(auth, provider);
      } catch (redirectErr) {
        throw new Error(formatAuthError(redirectErr));
      }
      // Redirect initiated — keep caller pending until the page unloads.
      return new Promise<AuthUser>(() => undefined);
    }
    throw new Error(formatAuthError(err));
  }
}

/** Email/password sign-in. Throws with a user-facing message via formatAuthError. */
export async function signInWithEmail(email: string, password: string): Promise<AuthUser> {
  if (!isFirebaseConfigured()) {
    throw new Error(formatAuthError({ code: 'auth/not-configured', message: 'not configured' }));
  }
  const trimmed = email.trim();
  try {
    const cred = await signInWithEmailAndPassword(getFirebaseAuth(), trimmed, password);
    return toAuthUser(cred.user);
  } catch (err) {
    throw new Error(formatAuthError(err));
  }
}

/**
 * Create account with email/password. Optional displayName via updateProfile.
 * Cloud hydrate (playerCode, friends) runs the same as Google once auth state updates.
 */
export async function signUpWithEmail(
  email: string,
  password: string,
  displayName?: string,
): Promise<AuthUser> {
  if (!isFirebaseConfigured()) {
    throw new Error(formatAuthError({ code: 'auth/not-configured', message: 'not configured' }));
  }
  const trimmed = email.trim();
  const name = displayName?.trim().slice(0, 24) || undefined;
  try {
    const cred = await createUserWithEmailAndPassword(getFirebaseAuth(), trimmed, password);
    if (name) {
      await updateProfile(cred.user, { displayName: name });
    }
    return toAuthUser(cred.user);
  } catch (err) {
    throw new Error(formatAuthError(err));
  }
}

export async function signOutAuth(): Promise<void> {
  if (!isFirebaseConfigured()) return;
  try {
    await firebaseSignOut(getFirebaseAuth());
  } catch {
    // ignore
  }
}

/**
 * Email/password reset. Sends Firebase Auth reset link to the address.
 * Throws with a user-facing message via formatAuthError.
 */
export async function sendPasswordReset(email: string): Promise<void> {
  if (!isFirebaseConfigured()) {
    throw new Error(formatAuthError({ code: 'auth/not-configured', message: 'not configured' }));
  }
  const trimmed = email.trim();
  if (!trimmed) {
    throw new Error('Enter your email to reset the password.');
  }
  try {
    await sendPasswordResetEmail(getFirebaseAuth(), trimmed);
  } catch (err) {
    throw new Error(formatAuthError(err));
  }
}
