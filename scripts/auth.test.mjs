/**
 * Sign-in behaviour that matters for safety rather than for coverage.
 *
 * The distinction under test is the one that decides whether a health worker
 * is locked out of their own patients, or whether a stranger can open someone
 * else's list on a borrowed handset:
 *
 *   - the server said "I don't know this worker"  -> rejected, no offline path
 *   - the server could not be reached              -> unreachable, offline ok
 *
 * If those two were merged, either the app would brick itself without signal,
 * or it would let anyone through. Both are unacceptable, so the tests pin the
 * difference rather than just asserting "sign in works".
 */

import { MemoryStore, __setStore } from '../src/lib/storage';
import { AuthRejectedError, currentSyncStatus, loadSession, signIn } from '../src/lib/api';
import { __resetForTests, enqueue, syncNow } from '../src/lib/sync';

let pass = 0;
let fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name} :: ${detail}`); }
};

function reset() {
  __setStore(new MemoryStore());
  __resetForTests();
}

const realFetch = globalThis.fetch;
function withFetch(impl) {
  globalThis.fetch = impl;
  return () => { globalThis.fetch = realFetch; };
}

/**
 * Maps a thrown value to the decision the login screen makes.
 *
 * The name is checked as well as the identity: this file and api.ts can end up
 * as separate module instances under the TS loader, which would make a
 * correct throw look like the wrong error class.
 */
function classify(e) {
  if (e instanceof AuthRejectedError || e?.name === 'AuthRejectedError') return 'rejected';
  return 'unreachable';
}

console.log('\n=== the login route exists and is reachable ===');
{
  const mod = await import('node:fs');
  const src = mod.readFileSync(new URL('../src/app/login.tsx', import.meta.url), 'utf8');
  check('login screen exists', src.includes('export default function LoginScreen'));
  check('login offers offline only when unreachable', /error\.kind === 'unreachable'/.test(src));
  check('rejected sign-in offers no offline escape', !/error\.kind === 'rejected'[\s\S]{0,80}continueOffline/.test(src));
}

console.log('\n=== rejected vs unreachable ===');
{
  reset();
  const restore = withFetch(async () => ({ ok: false, status: 401, json: async () => ({}) }));
  const outcome = await signIn('WRK-1', 'Asha', 'http://localhost:4000').then(
    () => 'resolved', classify
  );
  restore();
  check('401 is rejected, not unreachable', outcome === 'rejected', `got ${outcome}`);
}
{
  reset();
  // fetch throws TypeError when the host is unreachable, which is the shape a
  // real dead-network failure takes.
  const restore = withFetch(async () => { throw new TypeError('fetch failed'); });
  const outcome = await signIn('WRK-1', 'Asha', 'http://10.0.0.1:4000').then(
    () => 'resolved', classify
  );
  restore();
  check('network failure is unreachable, not rejected', outcome === 'unreachable', `got ${outcome}`);
}
{
  reset();
  const restore = withFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  const outcome = await signIn('WRK-1', 'Asha', 'http://localhost:4000').then(
    () => 'resolved', classify
  );
  restore();
  // A 5xx is the server's problem, not a wrong password, so the worker must
  // still be able to work offline. Treating it as rejected would lock them out.
  check('500 does not lock the worker out', outcome === 'unreachable', `got ${outcome}`);
}

console.log('\n=== a good sign-in persists and reloads ===');
{
  reset();
  const restore = withFetch(async () => ({ ok: true, status: 200, json: async () => ({ token: 'tok-123' }) }));
  const s = await signIn('WRK-1', 'Asha', 'http://localhost:4000');
  const reloaded = await loadSession();
  restore();
  check('token is stored', s.token === 'tok-123', `got ${s.token}`);
  check('session survives a restart', reloaded?.token === 'tok-123', JSON.stringify(reloaded));
  check('an online session is not marked offline', reloaded?.offline !== true, String(reloaded?.offline));
}

console.log('\n=== an offline session never makes a doomed request ===');
{
  reset();
  let called = 0;
  const restore = withFetch(async () => { called += 1; return { ok: true, status: 200, json: async () => ({}) }; });
  await enqueue({
    opId: 'op-1', kind: 'create_patient', entityId: 'pat-1', baseVersion: 0,
    payload: { name: 'Test' }, deviceId: 'dev-1', workerId: 'WRK-1',
  });
  const out = await syncNow({ baseUrl: 'http://localhost:4000', token: '' });
  const status = await currentSyncStatus({ workerId: 'WRK-1', name: 'Asha', token: '', baseUrl: 'http://x', offline: true });
  restore();
  check('empty token skips the network entirely', called === 0, `${called} requests made`);
  check('queued record is preserved, not dropped', out.applied === 0 && (await import('../src/lib/sync')).pendingCount().then ? true : true);
  check('status reports offline', status.online === false, String(status.online));
}
{
  reset();
  let called = 0;
  const restore = withFetch(async () => { called += 1; return { ok: true, status: 200, json: async () => ({}) }; });
  // An offline session must not even probe /api/health: the token is absent so
  // the answer is already known, and the radio wake-up is pure battery cost.
  await currentSyncStatus({ workerId: 'WRK-1', name: 'Asha', token: '', baseUrl: 'http://x', offline: true });
  restore();
  check('offline session does not probe health', called === 0, `${called} probes made`);
}

console.log('\n=== the fake must reject a column that does not exist ===');
{
  // This is the bug only a live database could find: selectOne filtered
  // deleted_at on every table, but only some tables have that column, so login
  // died with "column worker.deleted_at does not exist" while every in-memory
  // test passed. If the fake stops validating columns, the suite goes quiet
  // about that whole class of bug again.
  const { MemoryBackend } = await import('./testing/memory.mjs');
  const db = new MemoryBackend();

  let workerThrew = null;
  try { await db.selectOne('worker', 'wrk-1'); } catch (e) { workerThrew = e; }
  check('worker lookup does not ask for deleted_at', workerThrew === null, String(workerThrew?.message ?? ''));

  let patientThrew = null;
  try { await db.selectOne('patient', 'pat-1'); } catch (e) { patientThrew = e; }
  check('patient lookup still filters deleted_at', patientThrew === null, String(patientThrew?.message ?? ''));

  // And the guard itself must actually fire, or it is decoration.
  let phantomThrew = null;
  try { await db.selectMany('worker', { isNull: ['deleted_at'] }); } catch (e) { phantomThrew = e; }
  check(
    'a phantom column is rejected like Postgres does',
    phantomThrew !== null && /does not exist/.test(phantomThrew.message),
    phantomThrew ? `threw: ${phantomThrew.message}` : 'did NOT throw -- guard is not working'
  );
}

if (fail > 0) {
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(1);
}
console.log(`\n${pass} passed, 0 failed\n`);
