import { MemoryStore, __setStore } from '../src/lib/storage';
import {
  enqueue, pendingOps, pendingCount, conflicts, resolveConflict,
  syncNow, getDeviceId, __resetForTests,
} from '../src/lib/sync';

let pass = 0;
let fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${detail}`); }
};

function reset() {
  __setStore(new MemoryStore());
  __resetForTests();
}

const OP = (entityId, kind = 'create_patient', baseVersion = 0) => ({
  opId: `op-${entityId}-${kind}`,
  kind,
  entityId,
  baseVersion,
  payload: { name: 'Test Patient' },
  deviceId: 'dev-test',
  workerId: 'wrk-test',
});

function fakeFetch(results) {
  return async () => ({
    ok: true,
    status: results.some((r) => r.status === 'conflict') ? 207 : 200,
    text: async () => JSON.stringify({ results }),
  });
}

const API = { baseUrl: 'http://localhost:4000', token: 't' };

console.log('\n=== op-log ===');
reset();
{
  const a = await enqueue(OP('pat-1'));
  const b = await enqueue(OP('pat-2'));
  check('seq increments', a.seq === 1 && b.seq === 2, `${a.seq},${b.seq}`);
  check('retry count starts at 0', a.retryCount === 0, String(a.retryCount));
  check('pending count is 2', (await pendingCount()) === 2, String(await pendingCount()));
  const ops = await pendingOps();
  check('ops drain in seq order', ops[0].entityId === 'pat-1' && ops[1].entityId === 'pat-2', JSON.stringify(ops.map((o) => o.entityId)));
  check('device id is stable', (await getDeviceId()) === (await getDeviceId()), 'unstable');
}

console.log('\n=== offline keeps the queue ===');
reset();
await enqueue(OP('pat-1'));
await enqueue(OP('pat-2'));
{
  const out = await syncNow({ ...API, isOnline: () => false });
  check('offline applies nothing', out.applied === 0, JSON.stringify(out));
  check('offline keeps both ops', (await pendingCount()) === 2, String(await pendingCount()));
  check('offline reports reason', out.status.lastError === 'offline', String(out.status.lastError));
  check('offline reports not online', out.status.online === false, String(out.status.online));
}

console.log('\n=== empty queue is a no-op ===');
reset();
{
  const out = await syncNow({ ...API, fetchImpl: async () => { throw new Error('must not be called'); } });
  check('no fetch when nothing pending', out.applied === 0, JSON.stringify(out));
  check('no error on empty queue', out.status.lastError === null, String(out.status.lastError));
}

console.log('\n=== applied ops leave the queue ===');
reset();
await enqueue(OP('pat-1'));
await enqueue(OP('pat-2'));
{
  const out = await syncNow({
    ...API,
    fetchImpl: fakeFetch([
      { opId: 'op-pat-1-create_patient', status: 'applied' },
      { opId: 'op-pat-2-create_patient', status: 'applied' },
    ]),
  });
  check('two applied', out.applied === 2, JSON.stringify(out));
  check('queue drained', (await pendingCount()) === 0, String(await pendingCount()));
  check('success recorded', out.status.lastSuccessAt !== null, String(out.status.lastSuccessAt));
}

console.log('\n=== conflicts are parked, not dropped ===');
reset();
await enqueue(OP('pat-1', 'update_patient', 3));
{
  const out = await syncNow({
    ...API,
    fetchImpl: fakeFetch([
      {
        opId: 'op-pat-1-update_patient',
        status: 'conflict',
        serverVersion: 7,
        serverRecord: { id: 'pat-1', name: 'Server Copy' },
        reason: 'device had v3, server is at v7',
      },
    ]),
  });
  check('one conflict', out.conflicted === 1, JSON.stringify(out));
  check('conflicting op leaves the queue', (await pendingCount()) === 0, String(await pendingCount()));
  const c = await conflicts();
  check('conflict recorded', c.length === 1, JSON.stringify(c));
  check('conflict keeps server version', c[0].serverVersion === 7, JSON.stringify(c[0]));
  check('conflict keeps server record', c[0].serverRecord.name === 'Server Copy', JSON.stringify(c[0]));
  check('conflict carries the reason', /device had v3/.test(c[0].reason), c[0].reason);
  await resolveConflict('op-pat-1-update_patient');
  check('resolved conflict clears', (await conflicts()).length === 0, JSON.stringify(await conflicts()));
}

console.log('\n=== rejected ops do not block the queue ===');
reset();
await enqueue(OP('pat-1'));
await enqueue(OP('pat-2'));
{
  const out = await syncNow({
    ...API,
    fetchImpl: fakeFetch([
      { opId: 'op-pat-1-create_patient', status: 'rejected', reason: 'name is required' },
      { opId: 'op-pat-2-create_patient', status: 'applied' },
    ]),
  });
  check('one rejected one applied', out.rejected === 1 && out.applied === 1, JSON.stringify(out));
  check('poisoned op does not block', (await pendingCount()) === 0, String(await pendingCount()));
  check('rejection is not a conflict', (await conflicts()).length === 0, JSON.stringify(await conflicts()));
}

console.log('\n=== transport failure keeps everything queued ===');
reset();
const T0 = 1_760_000_000_000;
await enqueue(OP('pat-1'));
await enqueue(OP('pat-2'));
{
  const out = await syncNow({
    ...API,
    clock: () => T0,
    fetchImpl: async () => { throw new Error('network unreachable'); },
  });
  check('failure applies nothing', out.applied === 0, JSON.stringify(out));
  check('failure keeps both ops for retry', (await pendingCount()) === 2, String(await pendingCount()));
  check('failure reason recorded', out.status.lastError === 'network unreachable', String(out.status.lastError));
  // Backoff is in force: the ops are still on disk but not yet eligible, so an
  // immediate retry must make no request at all.
  const immediate = await syncNow({
    ...API,
    clock: () => T0,
    fetchImpl: () => { throw new Error('must not retry inside backoff'); },
  });
  check('backoff defers the retry', immediate.applied === 0 && (await pendingCount()) === 2,
    JSON.stringify(immediate));
  // Read past the window: pendingOps deliberately hides ops still backing off,
  // so inspect them once they are eligible again.
  const held = await pendingOps(100, T0 + 60_000);
  check('retry attempt was counted', held[0]?.retryCount === 1, JSON.stringify(held[0]));
  check('backoff error stored on the op', held[0]?.lastError === 'network unreachable', String(held[0]?.lastError));
  check('backoff window persisted', typeof held[0]?.nextAttemptAt === 'string', String(held[0]?.nextAttemptAt));

  // Once the window elapses, the same ops drain and are removed.
  const out2 = await syncNow({
    ...API,
    clock: () => T0 + 60_000,
    fetchImpl: fakeFetch([
      { opId: 'op-pat-1-create_patient', status: 'applied' },
      { opId: 'op-pat-2-create_patient', status: 'applied' },
    ]),
  });
  check('retry after backoff succeeds', out2.applied === 2, JSON.stringify(out2));
  check('queue empty after successful retry', (await pendingCount()) === 0, String(await pendingCount()));
}

console.log('\n=== http error keeps the queue ===');
reset();
await enqueue(OP('pat-1'));
{
  const out = await syncNow({
    ...API,
    fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'boom' }),
  });
  check('500 applies nothing', out.applied === 0, JSON.stringify(out));
  check('500 keeps the op', (await pendingCount()) === 1, String(await pendingCount()));
  check('500 records status', /status 500/.test(out.status.lastError ?? ''), String(out.status.lastError));
}


console.log('\n=== auth failure keeps local data ===');
reset();
const T1 = 1_760_000_000_000;
await enqueue(OP('pat-auth'));
{
  const out = await syncNow({
    ...API,
    clock: () => T1,
    fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'unauthorized' }),
  });
  check('401 applies nothing', out.applied === 0, JSON.stringify(out));
  check('401 keeps the record locally', (await pendingCount()) === 1, String(await pendingCount()));
  check('401 reason recorded', (await pendingOps(100, T1 + 60_000))[0]?.lastError === 'auth rejected (401)',
    String((await pendingOps(100, T1 + 60_000))[0]?.lastError));
  // A wrong token will still be wrong on the next attempt, but the record must
  // survive it: the worker signs in again and the queue drains.
  const out2 = await syncNow({
    ...API,
    clock: () => T1 + 600_000,
    fetchImpl: fakeFetch([{ opId: 'op-pat-auth-create_patient', status: 'applied' }]),
  });
  check('record survives auth failure and later syncs', out2.applied === 1, JSON.stringify(out2));
  check('queue empty after re-auth', (await pendingCount()) === 0, String(await pendingCount()));
}

console.log('\n=== batching splits a large backlog ===');
reset();
const T2 = 1_760_000_000_000;
for (let i = 0; i < 100; i++) await enqueue(OP(`pat-${i}`));
{
  const sizes = [];
  const fetchImpl = async (_url, init) => {
    const ops = JSON.parse(init.body).ops;
    sizes.push(ops.length);
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ results: ops.map((o) => ({ opId: o.opId, status: 'applied' })) }),
    };
  };
  let rounds = 0;
  let total = 0;
  // Drain in batches, exactly as the app does on a timer.
  while ((await pendingCount()) > 0 && rounds < 20) {
    const out = await syncNow({ ...API, clock: () => T2, fetchImpl, batchSize: 20 });
    total += out.applied;
    rounds++;
  }
  check('all 100 records synced', total === 100, String(total));
  check('five batches of twenty', JSON.stringify(sizes) === JSON.stringify([20, 20, 20, 20, 20]), JSON.stringify(sizes));
  check('queue drained', (await pendingCount()) === 0, String(await pendingCount()));
  check('no round left hanging', rounds === 5, String(rounds));
}

console.log('\n=== batch size is configurable ===');
reset();
for (let i = 0; i < 10; i++) await enqueue(OP(`cfg-${i}`));
{
  const sizes = [];
  const fetchImpl = async (_url, init) => {
    const ops = JSON.parse(init.body).ops;
    sizes.push(ops.length);
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ results: ops.map((o) => ({ opId: o.opId, status: 'applied' })) }),
    };
  };
  let rounds = 0;
  while ((await pendingCount()) > 0 && rounds < 20) {
    await syncNow({ ...API, fetchImpl, batchSize: 3 });
    rounds++;
  }
  check('batch size three honoured', JSON.stringify(sizes) === JSON.stringify([3, 3, 3, 1]), JSON.stringify(sizes));
}

console.log('\n=== queue survives a restart mid-sync ===');
reset();
const T3 = 1_760_000_000_000;
await enqueue(OP('pat-restart-1'));
await enqueue(OP('pat-restart-2'));
await enqueue(OP('pat-restart-3'));
{
  // Server applies the batch, then the connection dies before the client can
  // read the response: the classic lost-ack case.
  await syncNow({
    ...API,
    clock: () => T3,
    fetchImpl: async () => {
      throw new Error('connection reset after server write');
    },
  });
  check('records still queued after lost ack', (await pendingCount()) === 3, String(await pendingCount()));

  // Simulate the process being killed: drop the memoised store handle and
  // reopen against the same persisted storage, as a cold start would.
  __resetForTests();
  check('pending restored after restart', (await pendingCount()) === 3, String(await pendingCount()));

  // Replay. Server-side ids are deterministic, so this is a no-op there.
  const out = await syncNow({
    ...API,
    clock: () => T3 + 60_000,
    fetchImpl: fakeFetch([
      { opId: 'op-pat-restart-1-create_patient', status: 'applied' },
      { opId: 'op-pat-restart-2-create_patient', status: 'applied' },
      { opId: 'op-pat-restart-3-create_patient', status: 'applied' },
    ]),
  });
  check('sync resumes after restart', out.applied === 3, JSON.stringify(out));
  check('queue empty once confirmed', (await pendingCount()) === 0, String(await pendingCount()));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
