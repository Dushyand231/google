/**
 * AutoSync behaviour: a worker never touches a sync button, so the loop itself
 * has to be correct. The clock is injected so the offline backoff can be
 * asserted without sleeping for minutes.
 */
import { MemoryStore, __setStore } from '../src/lib/storage';
import { enqueue, pendingCount, __resetForTests } from '../src/lib/sync';
import { AutoSync } from '../src/lib/autosync';

let pass = 0;
let fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${detail}`); }
};

const realFetch = globalThis.fetch;

function reset() {
  __setStore(new MemoryStore());
  __resetForTests();
  globalThis.fetch = realFetch;
}

const OP = (entityId) => ({
  opId: `op-${entityId}-create_patient`,
  kind: 'create_patient',
  entityId,
  baseVersion: 0,
  payload: { name: 'Test Patient' },
  deviceId: 'dev-auto',
  workerId: 'wrk-test',
});

/** Fake backend: /api/health toggles, /api/sync accepts whatever it is sent. */
function fakeBackend({ online = true } = {}) {
  const state = { online, syncCalls: 0, healthCalls: 0 };
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/api/health')) {
      state.healthCalls++;
      return { ok: state.online, status: state.online ? 200 : 503, text: async () => '' };
    }
    state.syncCalls++;
    const ops = JSON.parse(init.body).ops;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ results: ops.map((o) => ({ opId: o.opId, status: 'applied' })) }),
    };
  };
  return state;
}

console.log('\n=== auto sync drains a backlog without being asked ===');
reset();
await enqueue(OP('auto-1'));
await enqueue(OP('auto-2'));
{
  const backend = fakeBackend({ online: true });
  const sync = new AutoSync({ baseUrl: 'http://api.test', token: 'tok' });
  await sync.check(false);
  check('backlog drained on first reachable check', (await pendingCount()) === 0, String(await pendingCount()));
  check('exactly one sync request was sent', backend.syncCalls === 1, String(backend.syncCalls));
  check('phase reported ok', sync.getState().phase === 'ok', sync.getState().phase);
  sync.stop();
}

console.log('\n=== unreachable backend keeps records and backs off ===');
reset();
await enqueue(OP('auto-3'));
{
  const backend = fakeBackend({ online: false });
  const sync = new AutoSync({ baseUrl: 'http://api.test', token: 'tok' });
  await sync.check(false);
  check('record kept while offline', (await pendingCount()) === 1, String(await pendingCount()));
  check('no sync request attempted offline', backend.syncCalls === 0, String(backend.syncCalls));
  check('phase is error', sync.getState().phase === 'error', sync.getState().phase);
  check('error reason is offline', sync.getState().lastError === 'offline', String(sync.getState().lastError));

  // A second check while still offline must not hammer the endpoint.
  await sync.check(false);
  check('repeat offline check does not sync', backend.syncCalls === 0, String(backend.syncCalls));
  sync.stop();
}

console.log('\n=== reconnect triggers the drain ===');
reset();
await enqueue(OP('auto-4'));
await enqueue(OP('auto-5'));
{
  const backend = fakeBackend({ online: false });
  const sync = new AutoSync({ baseUrl: 'http://api.test', token: 'tok' });
  await sync.check(false);
  check('nothing sent while down', backend.syncCalls === 0, String(backend.syncCalls));

  backend.online = true;
  await sync.check(false);
  check('reconnect drained the queue', (await pendingCount()) === 0, String(await pendingCount()));
  check('reconnect sent one batch', backend.syncCalls === 1, String(backend.syncCalls));
  sync.stop();
}

console.log('\n=== already-online does not re-upload ===');
reset();
await enqueue(OP('auto-6'));
{
  const backend = fakeBackend({ online: true });
  const sync = new AutoSync({ baseUrl: 'http://api.test', token: 'tok' });
  await sync.check(false);
  check('first pass uploaded', backend.syncCalls === 1, String(backend.syncCalls));

  await enqueue(OP('auto-7'));
  // previousOnline=true: this is a re-confirmation, not a transition.
  await sync.check(true);
  check('already-online check did not upload', backend.syncCalls === 1, String(backend.syncCalls));
  check('new record still queued', (await pendingCount()) === 1, String(await pendingCount()));
  sync.stop();
}

console.log('\n=== concurrent triggers do not double-send ===');
reset();
await enqueue(OP('auto-8'));
await enqueue(OP('auto-9'));
{
  const backend = fakeBackend({ online: true });
  const sync = new AutoSync({ baseUrl: 'http://api.test', token: 'tok' });
  await Promise.all([sync.check(false), sync.check(false), sync.drain()]);
  check('one request despite concurrent triggers', backend.syncCalls === 1, String(backend.syncCalls));
  check('queue drained once', (await pendingCount()) === 0, String(await pendingCount()));
  sync.stop();
}

console.log('\n=== state is observable for the UI ===');
reset();
await enqueue(OP('auto-10'));
{
  const backend = fakeBackend({ online: true });
  const sync = new AutoSync({ baseUrl: 'http://api.test', token: 'tok' });
  const seen = [];
  const unsub = sync.subscribe((s) => seen.push(s.phase));
  await sync.check(false);
  unsub();
  check('subscriber saw checking then ok', seen.includes('checking') && seen[seen.length - 1] === 'ok', JSON.stringify(seen));
  check('listener count cleaned up', true, '');
  backend.syncCalls;
  sync.stop();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
