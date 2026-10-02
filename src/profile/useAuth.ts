import { useCallback, useEffect, useState } from 'react';
import { isFirebaseConfigured } from '../multiplayer/firebase';
import {
  AuthUser,
  formatAuthError,
  getGoogleRedirectResult,
  sendPasswordReset as sendPasswordResetAuth,
  signInWithEmail as signInWithEmailAuth,
  signInWithGoogle,
  signOutAuth,
  signUpWithEmail as signUpWithEmailAuth,
  subscribeAuth,
} from './auth';

export interface AuthState {
  ready: boolean;
  configured: boolean;
  user: AuthUser | null;
  busy: boolean;
  error: string | null;
  /** Google sign-in (popup / redirect). */
  signIn: () => Promise<AuthUser | null>;
  signInWithEmail: (email: string, password: string) => Promise<AuthUser | null>;
  signUpWithEmail: (
    email: string,
    password: string,
    displayName?: string,
  ) => Promise<AuthUser | null>;
  /** Email/password reset link. Returns true on success. */
  sendPasswordReset: (email: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

export function useAuth(): AuthState {
  const configured = isFirebaseConfigured();
  const [ready, setReady] = useState(!configured);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!configured) {
      setReady(true);
      setUser(null);
      return;
    }
    let cancelled = false;
    // Complete a pending signInWithRedirect (phones / popup fallback).
    void getGoogleRedirectResult()
      .then((u) => {
        if (cancelled || !u) return;
        setUser(u);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : formatAuthError(e));
      });
    const unsub = subscribeAuth((u) => {
      setUser(u);
      setReady(true);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [configured]);

  const signIn = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const u = await signInWithGoogle();
      setUser(u);
      return u;
    } catch (e) {
      const msg = e instanceof Error ? e.message : formatAuthError(e);
      setError(msg);
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    setBusy(true);
    setError(null);
    try {
      const u = await signInWithEmailAuth(email, password);
      setUser(u);
      return u;
    } catch (e) {
      const msg = e instanceof Error ? e.message : formatAuthError(e);
      setError(msg);
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const signUpWithEmail = useCallback(
    async (email: string, password: string, displayName?: string) => {
      setBusy(true);
      setError(null);
      try {
        const u = await signUpWithEmailAuth(email, password, displayName);
        setUser(u);
        return u;
      } catch (e) {
        const msg = e instanceof Error ? e.message : formatAuthError(e);
        setError(msg);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const sendPasswordReset = useCallback(async (email: string) => {
    setBusy(true);
    setError(null);
    try {
      await sendPasswordResetAuth(email);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : formatAuthError(e);
      setError(msg);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await signOutAuth();
      setUser(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : formatAuthError(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    ready,
    configured,
    user,
    busy,
    error,
    signIn,
    signInWithEmail,
    signUpWithEmail,
    sendPasswordReset,
    signOut,
    clearError: () => setError(null),
  };
}
