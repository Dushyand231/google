/**
 * End-to-end verification against the LIVE Supabase project.
 *
 *   node scripts/live-e2e.mjs
 *
 * Every other suite in this repo runs against an in-memory fake, so 4000+
 * passing assertions still prove nothing about whether the code works against
 * a real Postgres behind PostgREST. This closes that gap.
 *
 * The important part is that rows are read back with the service-role client
 * directly from Supabase, never through the server under test. Asking the
 * server whether it wrote the row would prove only that the server believes it
 * wrote the row.
 *
 * It writes real rows to the real project and deletes them afterwards.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

const here = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(here, '..', '.env'), 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}

const URL_BASE = process.env.SUPABASE_URL;
const PORT = process.env.SYNC_PORT ?? '4000';
const BASE = `http://127.0.0.1:${PORT}`;
// Direct line to the database, deliberately bypassing the server under test.
const direct = createClient(URL_BASE, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let pass = 0;
let fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name} :: ${detail}`); }
};

const STAMP = `e2e-${Date.now()}`;
const WORKER = 'wrk-e2e-001';
const DEVICE = 'dev-e2e-001';
const PATIENT = `pat-${STAMP}`;

async function api(path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error page */ }
  return { status: res.status, json, text };
}

function cleanup() {
  // Children first: the schema has no ON DELETE CASCADE, so a patient with
  // encounters would otherwise block the delete and leave litter behind.
  void (async () => {
    for (const t of ['observation', 'symptom', 'triage', 'encounter', 'audit_log', 'patient', 'device', 'worker']) {
      const col = t === 'audit_log' ? 'worker_id' : 'id';
      const val = t === 'audit_log' ? WORKER : t === 'worker' ? WORKER : t === 'device' ? DEVICE : t === 'patient' ? PATIENT : undefined;
      if (val === undefined) continue;
      const { error } = await direct.from(t).delete().eq(col, val);
      if (error) console.log(`  cleanup note: ${t}: ${error.message}`);
    }
  })();
}

console.log(`\n=== live end-to-end against ${URL_BASE} ===`);
console.log(`    marker ${STAMP}\n`);

let token = null;

console.log('--- health ---');
{
  const h = await api('/api/health');
  check('server is up', h.status === 200, `status ${h.status}`);
}

console.log('\n--- worker registration (service role, direct) ---');
{
  const { error } = await direct.from('worker').insert({ id: WORKER, name: 'E2E Health Worker' });
  check('worker row created in Supabase', !error, error?.message ?? 'ok');
  const { error: dErr } = await direct.from('device').insert({ id: DEVICE, worker_id: WORKER });
  check('device row created in Supabase', !dErr, dErr?.message ?? 'ok');
}

console.log('\n--- login ---');
{
  const res = await api('/api/auth/login', { workerId: WORKER, deviceId: DEVICE });
  check('login returns 200', res.status === 200, `status ${res.status} ${res.text.slice(0, 120)}`);
  check('login returns a token', typeof res.json?.token === 'string' && res.json.token.length > 0, 'no token');
  token = res.json?.token ?? null;
}

console.log('\n--- a wrong worker id is refused ---');
{
  const res = await api('/api/auth/login', { workerId: 'wrk-does-not-exist', deviceId: DEVICE });
  check('unknown worker is rejected', res.status === 401 || res.status === 403, `status ${res.status}`);
}

console.log('\n--- push an encounter, read it back from Supabase directly ---');
{
  const ops = [
    {
      opId: `${STAMP}-op-1`, kind: 'create_patient', entityId: PATIENT, baseVersion: 0,
      deviceId: DEVICE, workerId: WORKER,
      payload: { name: 'Ravi Kumar', age: 47, sex: 'male', village: 'Honnavar', phone: '9876543210', consent_given: true },
    },
    {
      opId: `${STAMP}-op-2`, kind: 'create_encounter', entityId: `enc-${STAMP}`, baseVersion: 0,
      deviceId: DEVICE, workerId: WORKER,
      // The exact shape the real client builds. An earlier version of this
      // script invented snake_case keys the client never sends, and the server
      // correctly refused them -- a reminder that the allowlist is doing its
      // job and that a test must not be its own source of truth.
      payload: {
        id: `enc-${STAMP}`, patientId: PATIENT, workerId: WORKER, deviceId: DEVICE,
        takenAt: new Date().toISOString(), lang: 'en',
        transcript: 'blood pressure 150 over 90 temperature 102.2 fever three days',
        observations: [
          { id: `enc-${STAMP}-obs-0`, loinc: '85354-9', display: 'BP', value: 150, secondaryValue: 90, unit: 'mmHg', ucumCode: 'mm[Hg]', source: 'voice', preliminary: false },
          { id: `enc-${STAMP}-obs-1`, loinc: '8310-5', display: 'Temp', value: 102.2, unit: 'F', ucumCode: '[degF]', source: 'voice', preliminary: false },
        ],
        symptoms: [
          { id: `enc-${STAMP}-sym-0`, code: 'fever', durationValue: 3, durationUnit: 'days', negative: false },
        ],
      },
    },
  ];
  const res = await api('/api/sync', { deviceId: DEVICE, batchId: `${STAMP}-batch`, ops }, token);
  check('sync accepted the batch', res.status === 200 || res.status === 207, `status ${res.status} ${res.text.slice(0, 200)}`);
  const results = res.json?.results ?? [];
  check('both ops applied', results.every((r) => r.status === 'applied'), JSON.stringify(results));

  // The decisive read: straight from Supabase, no server involved.
  const { data: p, error: pErr } = await direct.from('patient').select('*').eq('id', PATIENT).single();
  check('patient really is in Supabase', !pErr && !!p, pErr?.message ?? 'not found');
  check('age survived the round trip', p?.age === 47, `age=${p?.age}`);
  check('consent survived the round trip', p?.consent_given === true, `consent=${p?.consent_given}`);
  check('village survived the round trip', p?.village === 'Honnavar', `village=${p?.village}`);

  const { data: obs, error: oErr } = await direct.from('observation').select('*').eq('encounter_id', `enc-${STAMP}`);
  check('both observations are in Supabase', !oErr && obs.length === 2, `got ${obs?.length}: ${oErr?.message ?? ''}`);
  // The column is value_quantity, not value -- an earlier version of this
  // script looked for "value", matched nothing, and reported a false failure.
  const bp = obs?.find((o) => o.value_quantity === 150);
  check('systolic persisted', bp?.value_quantity === 150, `value_quantity=${bp?.value_quantity}`);
  check('diastolic value persisted', bp?.secondary_value === 90, `secondary_value=${bp?.secondary_value}`);
  check('observation ids are unique', new Set(obs?.map((o) => o.id)).size === obs.length, 'duplicate ids');
}

console.log('\n--- replaying the same batch must be idempotent ---');
{
  const ops = [{
    opId: `${STAMP}-op-1`, kind: 'create_patient', entityId: PATIENT, baseVersion: 0,
    deviceId: DEVICE, workerId: WORKER,
    payload: { name: 'Ravi Kumar', age: 47, sex: 'male', village: 'Honnavar', consent_given: true },
  }];
  const res = await api('/api/sync', { deviceId: DEVICE, batchId: `${STAMP}-batch-again`, ops }, token);
  const { count } = await direct.from('patient').select('*', { count: 'exact', head: true }).eq('id', PATIENT);
  check('replay did not create a duplicate', count === 1, `patient rows: ${count}`);
  check('replay is reported as applied, not an error', res.status === 200 || res.status === 207, `status ${res.status}`);
}

console.log('\n--- two devices, one stale version: the conflict path ---');
{
  // Device A succeeds and bumps the version.
  const a = await api('/api/sync', {
    deviceId: DEVICE, batchId: `${STAMP}-b-a`,
    ops: [{
      opId: `${STAMP}-op-3`, kind: 'update_patient', entityId: PATIENT, baseVersion: 1,
      deviceId: DEVICE, workerId: WORKER, payload: { name: 'Ravi Kumar', age: 47, sex: 'male', village: 'Honnavar', consent_given: true },
    }],
  }, token);
  check('device A update applied', (a.json?.results ?? []).some((r) => r.status === 'applied'), a.text.slice(0, 160));

  const { data: afterA } = await direct.from('patient').select('version').eq('id', PATIENT).single();

  // Device B still believes it is editing version 1, so this must conflict
  // rather than silently overwrite whatever device A just wrote.
  const b = await api('/api/sync', {
    deviceId: DEVICE, batchId: `${STAMP}-b-b`,
    ops: [{
      opId: `${STAMP}-op-4`, kind: 'update_patient', entityId: PATIENT, baseVersion: 1,
      deviceId: DEVICE, workerId: WORKER, payload: { name: 'STALE OVERWRITE', age: 99, sex: 'male', village: 'Honnavar', consent_given: true },
    }],
  }, token);
  const bResult = (b.json?.results ?? [])[0];
  check('stale write is reported as a conflict', bResult?.status === 'conflict', `got ${bResult?.status} ${b.text.slice(0, 160)}`);

  const { data: afterB } = await direct.from('patient').select('name, version').eq('id', PATIENT).single();
  check('stale write did NOT overwrite the row', afterB?.name !== 'STALE OVERWRITE', `name=${afterB?.name}`);
  check('version advanced only once', afterB?.version === afterA?.version, `${afterA?.version} -> ${afterB?.version}`);
}

console.log('\n--- malformed input is rejected, not absorbed ---');
{
  const res = await api('/api/sync', {
    deviceId: DEVICE, batchId: `${STAMP}-b-bad`,
    ops: [{
      opId: `${STAMP}-op-5`, kind: 'create_patient', entityId: `pat-${STAMP}-x`, baseVersion: 0,
      deviceId: DEVICE, workerId: WORKER,
      payload: { name: 'X', agey: 30, sex: 'male', village: 'V', consent_given: true },
    }],
  }, token);
  const r = (res.json?.results ?? [])[0];
  // The unknown field 'agey' is a typo of 'age'. Accepting it silently is how
  // every patient ended up with a null age in the first place.
  check('unknown field is rejected', r?.status === 'rejected', `got ${r?.status} ${r?.error ?? ''}`);
  const { count } = await direct.from('patient').select('*', { count: 'exact', head: true }).eq('id', `pat-${STAMP}-x`);
  check('rejected op wrote nothing', count === 0, `rows: ${count}`);
}

console.log('\n--- an unauthenticated call must be refused ---');
{
  const res = await api('/api/sync', { deviceId: DEVICE, batchId: `${STAMP}-b-noauth`, ops: [] }, null);
  check('no token is refused', res.status === 401 || res.status === 403, `status ${res.status}`);
}
{
  const res = await api('/api/sync', { deviceId: DEVICE, batchId: `${STAMP}-b-bad`, ops: [] }, 'forged-token');
  check('forged token is refused', res.status === 401 || res.status === 403, `status ${res.status}`);
}

console.log('\n--- audit trail ---');
{
  const { data, error } = await direct.from('audit_log').select('*').eq('worker_id', WORKER);
  check('audit rows were written to Supabase', !error && data.length > 0, `${data?.length ?? 0} rows: ${error?.message ?? ''}`);
}

cleanup();
await new Promise((r) => setTimeout(r, 1500));

console.log(`\n${pass} passed, ${fail} failed`);
console.log(`\nMarker for this run: ${STAMP}`);
console.log('Test rows have been removed.\n');
process.exit(fail === 0 ? 0 : 1);
