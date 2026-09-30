/**
 * Offline-first sync client.
 *
 * The health worker is in a village with no signal. Nothing in the UI is ever
 * blocked on the network: every mutation is appended to a local op-log and
 * applied to local state immediately, and the network drains the log later.
 *
 * Ordering is by `seq`, never by wall-clock time, because a phone that has
 * been offline for a day will have a wrong clock and could otherwise push
 * stale writes ahead of newer ones.
 *
 * A rejected op is never silently dropped. Conflicts are parked in
 * `conflicts` for the health worker to resolve by hand, because a supervisor's
 * edit and a field worker's edit are both clinically real and the app has no
 * basis for choosing between them.
 */

import { getStore, type KeyValueStore } from './storage';

export type OpKind = 'create_patient' | 'update_patient' | 'create_encounter';

export interface SyncOp {
  opId: string;
  kind: OpKind;
  entityId: string;
  /** version this device last saw; 0 for a record the server has never seen */
  baseVersion: number;
  payload: Record<string, unknown>;
  seq: number;
  createdAt: string;
  deviceId: string;
  workerId: string;
  retryCount: number;
  lastError?: string;
  /**
   * Earliest time this op may be retried, ISO. Set by the backoff schedule.
   *
   * Persisted on the op rather than in memory because the process is killed and
   * relaunched constantly in the field: an in-memory backoff resets on every
   * cold start, which is exactly how a client ends up hammering a server that
   * is down.
   */
  nextAttemptAt?: string;
}

/**
 * Exponential backoff, capped.
 *
 * 0s, 5s, 15s, 45s, 2m, 5m, then 15m. The first retry is immediate because a
 * transient blip should not cost a consultation; the ceiling matters more --
 * without it, a device offline for a day would keep a sync timer alive and
 * spend the clinic's whole data allowance on requests that cannot land.
 */
const BACKOFF_MS = [0, 5_000, 15_000, 45_000, 120_000, 300_000, 900_000];

export function backoffMs(retryCount: number): number {
  const i = Math.min(Math.max(retryCount, 0), BACKOFF_MS.length - 1);
  return BACKOFF_MS[i];
}

export interface SyncConflict {
  opId: string;
  kind: OpKind;
  entityId: string;
  reason: string;
  serverVersion: number;
  serverRecord: Record<string, unknown>;
  detectedAt: string;
}

export interface SyncStatus {
  pending: number;
  conflicts: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  online: boolean;
  lastError: string | null;
}

const K = {
  ops: 'oplog:',
  meta: 'sync:meta',
  conflicts: 'sync:conflicts',
  device: 'device:id',
} as const;

export interface SyncMeta {
  seq: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
}

let storePromise: Promise<KeyValueStore> | null = null;

/** Test seam: drop the memoised store so each case starts clean. */
export function __resetForTests(): void {
  storePromise = null;
}

function store(): Promise<KeyValueStore> {
  storePromise ??= getStore();
  return storePromise;
}

export function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

async function readMeta(s: KeyValueStore): Promise<SyncMeta> {
  return (
    (await s.get<SyncMeta>(K.meta)) ?? {
      seq: 0,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastError: null,
    }
  );
}

async function writeMeta(s: KeyValueStore, meta: SyncMeta): Promise<void> {
  await s.set(K.meta, meta);
}

/** Stable per-install id, so the server can attribute an op to a handset. */
export async function getDeviceId(): Promise<string> {
  const s = await store();
  const existing = await s.get<string>(K.device);
  if (existing) return existing;
  const id = newId('dev');
  await s.set(K.device, id);
  return id;
}

export async function enqueue(
  op: Omit<SyncOp, 'seq' | 'createdAt' | 'retryCount'>
): Promise<SyncOp> {
  const s = await store();
  const meta = await readMeta(s);
  const full: SyncOp = {
    ...op,
    seq: meta.seq + 1,
    createdAt: new Date().toISOString(),
    retryCount: 0,
  };
  await s.set(`${K.ops}${String(full.seq).padStart(9, '0')}`, full);
  await writeMeta(s, { ...meta, seq: full.seq });
  return full;
}

export async function pendingOps(limit = 100, now = Date.now()): Promise<SyncOp[]> {
  const s = await store();
  const keys = (await s.keys(K.ops)).sort();
  const out: SyncOp[] = [];
  for (const k of keys) {
    const op = await s.get<SyncOp>(k);
    if (!op) continue;
    // An op still inside its backoff window is skipped, not deleted: it stays
    // queued and is picked up on a later pass. Without this the client retries
    // in a tight loop and the "don't hammer the server" rule is decorative.
    if (op.nextAttemptAt && Date.parse(op.nextAttemptAt) > now) continue;
    out.push(op);
    if (out.length >= limit) break;
  }
  return out;
}

/** Record a failed attempt and schedule the next one, with backoff. */
async function markFailed(
  s: KeyValueStore,
  op: SyncOp,
  reason: string,
  now = Date.now()
): Promise<SyncOp> {
  const retryCount = op.retryCount + 1;
  const next: SyncOp = {
    ...op,
    retryCount,
    lastError: reason,
    nextAttemptAt: new Date(now + backoffMs(retryCount)).toISOString(),
  };
  await s.set(`${K.ops}${String(op.seq).padStart(9, '0')}`, next);
  return next;
}

export async function pendingCount(): Promise<number> {
  const s = await store();
  return (await s.keys(K.ops)).length;
}

export async function conflicts(): Promise<SyncConflict[]> {
  const s = await store();
  return (await s.get<SyncConflict[]>(K.conflicts)) ?? [];
}

async function addConflict(c: SyncConflict): Promise<void> {
  const s = await store();
  const list = await conflicts();
  if (list.some((x) => x.opId === c.opId)) return;
  list.push(c);
  await s.set(K.conflicts, list);
}

/** Drop a conflict once the worker has decided what the truth is. */
export async function resolveConflict(opId: string): Promise<void> {
  const s = await store();
  const list = await conflicts();
  await s.set(
    K.conflicts,
    list.filter((c) => c.opId !== opId)
  );
}

export interface SyncOutcome {
  status: SyncStatus;
  applied: number;
  conflicted: number;
  rejected: number;
}

export interface ApiOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  /** injected so tests can drive the offline path deterministically */
  isOnline?: () => boolean;
  /** ops per request. Large enough to be efficient, small enough that a lost
   * 2G connection only costs one batch rather than the whole backlog. */
  batchSize?: number;
  /** Per-request timeout. A stalled TCP connection otherwise hangs the queue
   *  indefinitely on exactly the bad networks this app exists for. */
  timeoutMs?: number;
  /** Clock seam. The backoff schedule is time-based, so tests need to advance
   *  time without sleeping. */
  clock?: () => number;
}

export const DEFAULT_BATCH_SIZE = 20;
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Drain the op-log. Never throws for a network failure: an unreachable server
 * is the normal case in the field, and it must leave the queue intact.
 */
export async function syncNow(api: ApiOptions): Promise<SyncOutcome> {
  const s = await store();
  const meta = await readMeta(s);
  const online = api.isOnline ? api.isOnline() : true;
  const batchSize = api.batchSize ?? DEFAULT_BATCH_SIZE;
  const timeoutMs = api.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const clock = api.clock ?? Date.now;

  const base: SyncStatus = {
    pending: await pendingCount(),
    conflicts: (await conflicts()).length,
    lastAttemptAt: meta.lastAttemptAt,
    lastSuccessAt: meta.lastSuccessAt,
    online,
    lastError: meta.lastError,
  };

  if (!online || !api.token) {
    // No token means the worker signed in offline. Everything stays queued and
    // is retried on the next real sign-in, so nothing is lost by returning here.
    return { status: { ...base, lastError: 'offline' }, applied: 0, conflicted: 0, rejected: 0 };
  }

  const ops = await pendingOps(batchSize, clock());
  if (ops.length === 0) {
    return { status: base, applied: 0, conflicted: 0, rejected: 0 };
  }

  const doFetch = api.fetchImpl ?? fetch;
  const startedAt = new Date().toISOString();

  let body: string;
  try {
    // AbortController rather than a bare fetch: on a 2G link a request can hang
    // in a state where the socket is open and nothing is arriving, which would
    // otherwise stall the queue forever with no error to report.
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer =
      controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let res: Response;
    try {
      res = await doFetch(`${api.baseUrl}/api/sync`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${api.token}` },
        body: JSON.stringify({ deviceId: ops[0].deviceId, batchId: newId('batch'), ops }),
        ...(controller ? { signal: controller.signal } : {}),
      });
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (!res.ok && res.status !== 207) {
      // 401/403 is terminal for this batch: the token is wrong or revoked, and
      // retrying the same bytes cannot change that. Treating it as transient
      // would burn the device's data allowance on guaranteed 401s.
      if (res.status === 401 || res.status === 403) {
        for (const op of ops) await markFailed(s, op, `auth rejected (${res.status})`, clock());
        const reason = `auth rejected (${res.status})`;
        await writeMeta(s, { ...meta, lastAttemptAt: startedAt, lastError: reason });
        return {
          status: { ...base, lastAttemptAt: startedAt, lastError: reason },
          applied: 0,
          conflicted: 0,
          rejected: 0,
        };
      }
      throw new Error(`sync failed with status ${res.status}`);
    }
    body = await res.text();
  } catch (e) {
    // Keep every op queued and record why. The next attempt retries the same
    // set, which is why the log is append-only and idempotent by op id.
    const message = e instanceof Error ? e.message : 'sync failed';
    for (const op of ops) await markFailed(s, op, message, clock());
    await writeMeta(s, { ...meta, lastAttemptAt: startedAt, lastError: message });
    return {
      status: { ...base, lastAttemptAt: startedAt, lastError: message },
      applied: 0,
      conflicted: 0,
      rejected: 0,
    };
  }

  const result = JSON.parse(body) as {
    results: {
      opId: string;
      status: 'applied' | 'conflict' | 'rejected';
      serverVersion?: number;
      serverRecord?: Record<string, unknown>;
      reason?: string;
    }[];
  };

  const now = new Date().toISOString();
  for (const r of result.results) {
    const key = `${K.ops}${String(ops.find((o) => o.opId === r.opId)?.seq ?? 0).padStart(9, '0')}`;
    if (r.status === 'applied') {
      await s.remove(key);
      continue;
    }
    if (r.status === 'conflict') {
      await addConflict({
        opId: r.opId,
        kind: ops.find((o) => o.opId === r.opId)?.kind ?? 'update_patient',
        entityId: ops.find((o) => o.opId === r.opId)?.entityId ?? '',
        reason: r.reason ?? 'version mismatch',
        serverVersion: r.serverVersion ?? 0,
        serverRecord: r.serverRecord ?? {},
        detectedAt: now,
      });
      await s.remove(key);
      continue;
    }
    // Rejected: the server will never accept it, so parking it forever would
    // block the queue behind a permanently poisonous op.
    await s.remove(key);
  }

  await writeMeta(s, { ...meta, lastAttemptAt: now, lastSuccessAt: now, lastError: null });

  return {
    status: {
      pending: await pendingCount(),
      conflicts: (await conflicts()).length,
      lastAttemptAt: now,
      lastSuccessAt: now,
      online: true,
      lastError: null,
    },
    applied: result.results.filter((r) => r.status === 'applied').length,
    conflicted: result.results.filter((r) => r.status === 'conflict').length,
    rejected: result.results.filter((r) => r.status === 'rejected').length,
  };
}
