/**
 * Session state for the whole app.
 *
 * Two facts drive the design:
 *
 * 1. The app is offline-first. A health worker in a village with no signal must
 *    still be able to open their patient list, so a failed sign-in must never
 *    become a dead end. That is why an unreachable server offers an explicit
 *    offline session rather than blocking the app.
 *
 * 2. A rejected worker ID must NOT fall back to offline. If the server said
 *    "I don't know this worker", continuing anyway would let anyone open a
 *    colleague's list on a borrowed handset, and the queued records would
 *    later be attributed to the wrong person. Those two failures are therefore
 *    kept distinct, not merged into one generic error.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  AuthRejectedError,
  DEFAULT_BASE_URL,
  clearSession,
  loadSession,
  saveSession,
  signIn as apiSignIn,
  type WorkerSession,
} from './api';

export type SignInFailure = 'rejected' | 'unreachable';

export class SignInError extends Error {
  readonly kind: SignInFailure;
  constructor(kind: SignInFailure, message: string) {
    super(message);
    this.name = 'SignInError';
    this.kind = kind;
  }
}

interface AuthValue {
  session: WorkerSession | null;
  /** false until the stored session has been read back from the device */
  hydrated: boolean;
  busy: boolean;
  signIn: (workerId: string, name: string, baseUrl: string) => Promise<void>;
  /**
   * Record a session with no server token. Records queue locally and sync once
   * a real sign-in succeeds later.
   */
  continueOffline: (workerId: string, name: string, baseUrl: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<WorkerSession | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await loadSession();
        if (!cancelled) setSession(stored);
      } finally {
        // Even a storage failure has to release the splash screen, otherwise
        // the app hangs on the loading page forever with no way forward.
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (workerId: string, name: string, baseUrl: string) => {
    setBusy(true);
    try {
      const next = await apiSignIn(workerId, name, baseUrl);
      setSession(next);
    } catch (e) {
      // AuthRejectedError means the server understood us and said no, which is
      // the only case that must not fall back to offline. Everything else --
      // a dead network, or a 5xx that is the server's own problem -- leaves
      // the worker able to carry on and queue their records.
      //
      // This checks the error type rather than pattern-matching the message.
      // A message that happened to contain "404" from an unrelated failure
      // would otherwise lock a health worker out of their own patients.
      if (e instanceof AuthRejectedError) throw new SignInError('rejected', e.message);
      throw new SignInError('unreachable', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const continueOffline = useCallback(async (workerId: string, name: string, baseUrl: string) => {
    setBusy(true);
    try {
      const next: WorkerSession = { workerId, name, token: '', baseUrl, offline: true };
      await saveSession(next);
      setSession(next);
    } finally {
      setBusy(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    setBusy(true);
    try {
      await clearSession();
      setSession(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ session, hydrated, busy, signIn, continueOffline, signOut }),
    [session, hydrated, busy, signIn, continueOffline, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export { DEFAULT_BASE_URL };
export type { WorkerSession };
