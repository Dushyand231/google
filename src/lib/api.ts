/**
 * Backend session and app state.
 *
 * The server is optional. If it is unreachable the app still starts, the
 * health worker still sees their patients, and every record still queues.
 * Nothing in the UI may depend on `session` being non-null.
 */

import { getStore } from './storage';
import { getDeviceId, newId, syncNow, pendingCount, conflicts, type SyncStatus } from './sync';

const K = { worker: 'worker:session', base: 'config:baseUrl' } as const;

export interface WorkerSession {
  workerId: string;
  name: string;
  /** Empty when the session is offline-only; sync must skip the network then. */
  token: string;
  baseUrl: string;
  /** true when the worker chose to continue without a server token. */
  offline?: boolean;
}

export const DEFAULT_BASE_URL = 'http://localhost:4000';

export async function loadSession(): Promise<WorkerSession | null> {
  const s = await getStore();
  return s.get<WorkerSession>(K.worker);
}

export async function saveSession(session: WorkerSession): Promise<void> {
  const s = await getStore();
  await s.set(K.worker, session);
}

export async function clearSession(): Promise<void> {
  const s = await getStore();
  await s.remove(K.worker);
}

/**
 * Development sign-in: the handset presents its device id and the server
 * replies with a scoped token. This is deliberately labelled as a demo in the
 * UI and is not a substitute for a supervisor-verified login.
 */
export class AuthRejectedError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`sign-in failed with status ${status}`);
    this.name = 'AuthRejectedError';
    this.status = status;
  }
}

export async function signIn(
  workerId: string,
  name: string,
  baseUrl: string
): Promise<WorkerSession> {
  const deviceId = await getDeviceId();
  // A network failure throws TypeError from fetch; a rejection returns a 4xx.
  // The two are kept apart by AuthRejectedError so the caller can offer
  // offline only for the former.
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workerId, deviceId }),
  });
  // Only a 4xx is the worker's mistake. A 5xx is the server's own trouble, and
  // treating it as a rejection would lock a health worker out of their
  // patients during a backend outage -- the one moment they most need the
  // offline queue. 5xx therefore surfaces as a generic failure, which the
  // login screen turns into an offer to continue offline.
  if (!res.ok) {
    if (res.status >= 400 && res.status < 500) throw new AuthRejectedError(res.status);
    throw new Error(`sign-in failed with status ${res.status}`);
  }
  const data = (await res.json()) as { token: string };
  const session: WorkerSession = { workerId, name, token: data.token, baseUrl };
  await saveSession(session);
  return session;
}

/**
 * Reachability, not connectivity.
 *
 * A device can sit on a Wi-Fi access point with no working uplink, so a socket
 * being open proves nothing. This asks the actual backend and requires a
 * response, which is why it is the signal the auto-sync loop trusts. The
 * timeout is short on purpose: this runs on app focus, and a health check that
 * hangs for a minute is worse than one that gives up in a few seconds.
 */
export async function health(baseUrl: string, timeoutMs = 5000): Promise<boolean> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(`${baseUrl}/api/health`, {
      ...(controller ? { signal: controller.signal } : {}),
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function currentSyncStatus(session: WorkerSession | null): Promise<SyncStatus> {
  const pending = await pendingCount();
  const conflictsCount = (await conflicts()).length;
  const s = await getStore();
  const meta = await s.get<{ lastAttemptAt: string | null; lastSuccessAt: string | null; lastError: string | null }>('sync:meta');
  // An offline-only session has no token, so probing it would always fail and
  // would also burn battery on a radio that is already known to be useless.
  const online = session && session.token ? await health(session.baseUrl) : false;
  return {
    pending,
    conflicts: conflictsCount,
    online,
    lastAttemptAt: meta?.lastAttemptAt ?? null,
    lastSuccessAt: meta?.lastSuccessAt ?? null,
    lastError: meta?.lastError ?? null,
  };
}

export { syncNow, getDeviceId, newId };
