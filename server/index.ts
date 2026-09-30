/**
 * JeevaCare sync server. Zero framework dependencies on purpose: the demo has
 * to start with a single command and no install step, and every route here is
 * small enough that a framework would only add surface area.
 *
 *   node server/index.ts
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

import {
  API_TOKEN_SECRET,
  LIVE,
  SUPABASE_URL,
  SYNC_PORT,
  audit,
  configProblem,
  getDb,
  verifySchema,
} from './db.ts';
import { processOps, type SyncOp } from './sync.ts';

type Handler = (
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  body: unknown
) => Promise<number>;

function send(res: import('node:http').ServerResponse, status: number, payload: unknown) {
  const json = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  });
  res.end(json);
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 8_000_000) reject(new Error('payload too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sign(deviceId: string): string {
  return createHmac('sha256', API_TOKEN_SECRET).update(deviceId).digest('hex');
}

function verifyToken(deviceId: string, token: string | null): boolean {
  if (!token) return false;
  const expected = Buffer.from(sign(deviceId));
  const got = Buffer.from(token);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

const handlers: Record<string, Handler> = {
  'GET /api/health': async (_req, res) => {
    const db = getDb();
    const missing = await verifySchema();
    if (missing.length > 0) {
      return send(res, 503, {
        ok: false,
        service: 'jeevacare-sync',
        database: 'supabase',
        missingTables: missing,
        hint: 'paste db/schema.sql into the Supabase SQL editor and run it',
      }) ?? 503;
    }
    return send(res, 200, {
      ok: true,
      service: 'jeevacare-sync',
      database: 'supabase',
      patients: await db.count('patient', LIVE),
      workers: await db.count('worker'),
      time: new Date().toISOString(),
    }) ?? 200;
  },

  'POST /api/auth/login': async (req, res, body) => {
    const { deviceId, workerId } = (body ?? {}) as { deviceId?: string; workerId?: string };
    if (!deviceId) return send(res, 400, { error: 'deviceId required' }) ?? 400;
    const w = await getDb().selectOne<{ id: string; role: string }>('worker', workerId ?? '');
    if (!w) return send(res, 401, { error: 'unknown worker' }) ?? 401;
    await audit({ deviceId, workerId: w.id, action: 'login', entity: 'worker', entityId: w.id, outcome: 'auth' });
    return send(res, 200, { token: sign(deviceId), workerId: w.id, role: w.role }) ?? 200;
  },

  'POST /api/sync': async (req, res, body) => {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const { deviceId, ops } = (body ?? {}) as { deviceId?: string; ops?: SyncOp[] };
    if (!deviceId || !verifyToken(deviceId, token)) {
      await audit({ deviceId, action: 'sync', outcome: 'auth', detail: { reason: 'bad token' } });
      return send(res, 401, { error: 'unauthorized' }) ?? 401;
    }
    if (!Array.isArray(ops)) return send(res, 400, { error: 'ops array required' }) ?? 400;

    const result = await processOps(ops);
    // This is an operational trace, not the idempotency mechanism. A replayed
    // batch gets a fresh client batchId, so this row will never be matched to
    // answer a duplicate request. Deduplication is enforced one level down, in
    // processOps: every entity id is the client-generated op.entityId and is the
    // table's primary key, and updates are compare-and-swap on version, so a
    // replay is a no-op rather than a second clinical record.
    const batchId = String((body as { batchId?: string } | null)?.batchId ?? `batch-${Date.now()}`);
    await getDb().insertIgnore('sync_receipt', [
      {
        id: batchId,
        device_id: deviceId,
        op_count: ops.length,
        applied: result.applied,
        conflicts: result.conflicts,
      },
    ]);
    // 207 signals "applied, but at least one op needs human reconciliation".
    // The client treats it as a partial success, not a failure to retry.
    return send(res, result.conflicts > 0 ? 207 : 200, result) ?? 200;
  },

  'GET /api/summary': async (_req, res) => {
    const db = getDb();
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const [patients, visits, recent, highTriage, workers, allEncounters] = await Promise.all([
      db.count('patient', LIVE),
      db.count('encounter', LIVE),
      db.count('encounter', { ...LIVE, gte: { created_at: dayAgo } }),
      db.count('triage', { eq: { severity: 'high' } }),
      db.selectMany<{ id: string; name: string; village: string | null }>('worker'),
      // One query for every encounter, then grouped in JS. Counting per worker
      // was one round-trip each, which on a 2G link is the whole request budget.
      db.selectMany<{ worker_id: string }>('encounter', LIVE),
    ]);
    const visitsPerWorker = new Map<string, number>();
    for (const e of allEncounters) {
      visitsPerWorker.set(e.worker_id, (visitsPerWorker.get(e.worker_id) ?? 0) + 1);
    }
    const byWorker = workers
      .map((w) => ({ name: w.name, village: w.village, visits: visitsPerWorker.get(w.id) ?? 0 }))
      .sort((a, b) => b.visits - a.visits);
    return send(res, 200, {
      patients,
      visits,
      visitsLast24h: recent,
      flagged: highTriage,
      workers: byWorker,
    }) ?? 200;
  },

  'GET /api/audit': async (_req, res) => {
    const entries = await getDb().selectMany<{
      at: string; action: string; entity: string | null; entity_id: string | null;
      outcome: string; version_before: number | null; version_after: number | null;
    }>('audit_log', { order: { column: 'at', ascending: false }, limit: 50 });
    return send(res, 200, { entries }) ?? 200;
  },

  'GET /api/encounters': async (_req, res) => {
    // Joined in JS rather than via PostgREST embedding: embedding needs
    // Supabase to have introspected the foreign keys, and silently returning
    // nulls when that cache is cold is worse than four small queries.
    const db = getDb();
    const encounters = await db.selectMany<{
      id: string; lang: string; transcript: string | null; created_at: string;
      patient_id: string; worker_id: string;
    }>('encounter', { ...LIVE, order: { column: 'created_at', ascending: false }, limit: 50 });
    const ids = encounters.map((e) => e.id);
    const scoped = ids.length ? { in: { encounter_id: ids } } : { in: { encounter_id: ['__none__'] } };
    const [patients, workers, obs, syms] = await Promise.all([
      db.selectMany<{ id: string; name: string }>('patient'),
      db.selectMany<{ id: string; name: string }>('worker'),
      // .in(), not .eq() with an array -- PostgREST only treats a list as IN
      // through the in-filter, so .eq() here silently matched nothing.
      db.selectMany<{ encounter_id: string }>('observation', scoped),
      db.selectMany<{ encounter_id: string }>('symptom', scoped),
    ]);
    const nameOf = new Map([...patients, ...workers].map((r) => [r.id, r.name]));
    const countBy = (rows: { encounter_id: string }[]) => {
      const m = new Map<string, number>();
      for (const r of rows) m.set(r.encounter_id, (m.get(r.encounter_id) ?? 0) + 1);
      return m;
    };
    const obsCount = countBy(obs);
    const symCount = countBy(syms);
    return send(res, 200, {
      encounters: encounters.map((e) => ({
        id: e.id,
        lang: e.lang,
        transcript: e.transcript,
        created_at: e.created_at,
        patient: nameOf.get(e.patient_id) ?? null,
        worker: nameOf.get(e.worker_id) ?? null,
        observations: obsCount.get(e.id) ?? 0,
        symptoms: symCount.get(e.id) ?? 0,
      })),
    }) ?? 200;
  },
};

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});

  const url = (req.url ?? '/').split('?')[0];
  const key = `${req.method} ${url}`;
  const handler = handlers[key];

  if (!handler) return send(res, 404, { error: 'not found', path: key });

  let body: unknown = null;
  if (req.method === 'POST') {
    const raw = await readBody(req);
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      return send(res, 400, { error: 'invalid JSON' });
    }
  }

  try {
    await handler(req, res, body);
  } catch (e) {
    send(res, 500, { error: e instanceof Error ? e.message : 'server error' });
  }
});

{
  const problem = configProblem();
  if (problem) {
    console.error(`[jeevacare] ${problem}`);
    console.error('[jeevacare] copy .env.example to .env and fill in the Supabase project values');
    process.exit(1);
  }
  try {
    const missing = await verifySchema();
    if (missing.length > 0) {
      console.error(`[jeevacare] schema incomplete, missing: ${missing.join(', ')}`);
      console.error('[jeevacare] paste db/schema.sql into the Supabase SQL editor and run it');
      process.exit(1);
    }
    console.log(`[jeevacare] supabase ${SUPABASE_URL} schema verified`);
  } catch (e) {
    console.error('[jeevacare] supabase unreachable:', e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

server.listen(SYNC_PORT, () => {
  console.log(`[jeevacare] sync server on http://localhost:${SYNC_PORT}`);
  console.log(`[jeevacare] routes: ${Object.keys(handlers).join('  ')}`);
});
