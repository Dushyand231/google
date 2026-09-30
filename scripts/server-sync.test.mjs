import { MemoryBackend, check, tally } from './testing/memory.mjs';

import { processOps } from '../server/sync';
import { __setDb } from '../server/db';

function reset() {
  const db = new MemoryBackend();
  __setDb(db);
  return db;
}

const op = (over = {}) => ({
  opId: over.opId ?? 'op-1',
  kind: 'create_patient',
  entityId: 'pat-1',
  baseVersion: 0,
  deviceId: 'dev-1',
  workerId: 'wrk-1',
  payload: { name: 'Suresh', age: 58, sex: 'male', village: 'Honnavar' },
  ...over,
});

console.log('\n=== create patient ===');
{
  const db = reset();
  await db.insertIgnore('worker', [{ id: 'wrk-1', name: 'Lakshmi', role: 'HEALTH_WORKER' }]);
  const r = await processOps([op()]);
  check('applied', r.results[0].status === 'applied', JSON.stringify(r.results[0]));
  check('version 1', r.results[0].serverVersion === 1, JSON.stringify(r.results[0]));
  const row = await db.selectOne('patient', 'pat-1');
  check('name stored', row.name === 'Suresh', JSON.stringify(row));
  check('consent defaults false', row.consent_given === false, JSON.stringify(row));
}
{
  const db = reset();
  await db.insertIgnore('worker', [{ id: 'wrk-1', name: 'Lakshmi', role: 'HEALTH_WORKER' }]);
  const r = await processOps([op()]);
  await db.insertIgnore('patient', [{ id: 'pat-1', worker_id: 'wrk-1', name: 'Suresh', version: 1 }]);
  const again = await processOps([op({ opId: 'op-2' })]);
  check('replayed create is idempotent', again.results[0].status === 'applied', JSON.stringify(again.results[0]));
  check('replay reports already-present', again.results[0].reason === 'already-present', String(again.results[0].reason));
  check('replay made no duplicate', (await db.count('patient')) === 1, String(await db.count('patient')));
}
{
  reset();
  const r = await processOps([op({ payload: { age: 40 } })]);
  check('missing name rejected', r.results[0].status === 'rejected', JSON.stringify(r.results[0]));
  check('rejection explains why', /name is required/.test(r.results[0].reason), String(r.results[0].reason));
}

console.log('\n=== update patient: compare-and-swap ===');
{
  const db = reset();
  await db.insertIgnore('patient', [
    { id: 'pat-1', worker_id: 'wrk-1', name: 'Suresh', village: 'Honnavar', version: 3 },
  ]);
  const r = await processOps([
    op({ opId: 'op-u1', kind: 'update_patient', baseVersion: 3, payload: { village: 'Kumta' } }),
  ]);
  check('matching version applies', r.results[0].status === 'applied', JSON.stringify(r.results[0]));
  check('version advanced to 4', r.results[0].serverVersion === 4, JSON.stringify(r.results[0]));
  check('field changed', (await db.selectOne('patient', 'pat-1')).village === 'Kumta', 'unchanged');
}
{
  const db = reset();
  await db.insertIgnore('patient', [
    { id: 'pat-1', worker_id: 'wrk-1', name: 'Suresh', village: 'Honnavar', version: 7 },
  ]);
  const r = await processOps([
    op({ opId: 'op-u2', kind: 'update_patient', baseVersion: 3, payload: { village: 'Kumta' } }),
  ]);
  check('stale version conflicts', r.results[0].status === 'conflict', JSON.stringify(r.results[0]));
  check('conflict quotes both versions', /device had v3/.test(r.results[0].reason) && /server is at v7/.test(r.results[0].reason), String(r.results[0].reason));
  check('conflict returns server version', r.results[0].serverVersion === 7, JSON.stringify(r.results[0]));
  check('conflict returns server copy', r.results[0].serverRecord.village === 'Honnavar', JSON.stringify(r.results[0].serverRecord));
  check('stale write did not land', (await db.selectOne('patient', 'pat-1')).village === 'Honnavar', 'CLOBBERED');
}
{
  // The race: two devices read the same version and both write.
  const db = reset();
  await db.insertIgnore('patient', [
    { id: 'pat-1', worker_id: 'wrk-1', name: 'Suresh', village: 'Honnavar', version: 1 },
  ]);
  const a = await processOps([op({ opId: 'op-a', kind: 'update_patient', baseVersion: 1, payload: { village: 'A' } })]);
  const b = await processOps([op({ opId: 'op-b', kind: 'update_patient', baseVersion: 1, payload: { village: 'B' } })]);
  check('first writer wins', a.results[0].status === 'applied', JSON.stringify(a.results[0]));
  check('second writer conflicts', b.results[0].status === 'conflict', JSON.stringify(b.results[0]));
  check('only one writer landed', (await db.selectOne('patient', 'pat-1')).village === 'A', 'both landed');
}
{
  const db = reset();
  const r = await processOps([
    op({ opId: 'op-u3', kind: 'update_patient', baseVersion: 1, payload: { village: 'X' } }),
  ]);
  check('update of unknown patient rejected', r.results[0].status === 'rejected', JSON.stringify(r.results[0]));
}

console.log('\n=== create encounter and children ===');
{
  const db = reset();
  await db.insertIgnore('worker', [{ id: 'wrk-1', name: 'Lakshmi', role: 'HEALTH_WORKER' }]);
  await db.insertIgnore('device', [{ id: 'dev-1', worker_id: 'wrk-1', label: 'field' }]);
  await db.insertIgnore('patient', [{ id: 'pat-1', worker_id: 'wrk-1', name: 'Suresh', version: 1 }]);
  const enc = op({
    opId: 'op-e1',
    kind: 'create_encounter',
    entityId: 'enc-1',
    payload: {
      patientId: 'pat-1',
      lang: 'ta',
      transcript: 'temp 102 fever three days',
      observations: [
        { loinc: '8310-5', display: 'Body temperature', value: 38.9, unit: 'Cel', ucumCode: 'Cel' },
      ],
      symptoms: [{ code: 'fever', icon: 'thermometer', durationValue: 3, durationUnit: 'days' }],
      triage: [{ label: 'Moderate fever', severity: 'medium', detail: '38.9C' }],
    },
  });
  const r = await processOps([enc]);
  check('encounter applied', r.results[0].status === 'applied', JSON.stringify(r.results[0]));
  check('encounter row written', (await db.selectOne('encounter', 'enc-1')) !== null, 'missing');
  check('transcript preserved verbatim', (await db.selectOne('encounter', 'enc-1')).transcript === 'temp 102 fever three days', 'lost');
  check('language stored', (await db.selectOne('encounter', 'enc-1')).lang === 'ta', 'wrong');
  check('observation written', (await db.count('observation', { eq: { encounter_id: 'enc-1' } })) === 1, 'missing');
  check('symptom written', (await db.count('symptom', { eq: { encounter_id: 'enc-1' } })) === 1, 'missing');
  check('triage written', (await db.count('triage', { eq: { encounter_id: 'enc-1' } })) === 1, 'missing');
  check('duration unit preserved', (await db.selectMany('symptom', { in: { encounter_id: 'enc-1' } }))[0]?.duration_unit === 'days', 'wrong');

  // Replay: the whole batch is retried after a dropped connection.
  const again = await processOps([op({ ...enc, opId: 'op-e2' })]);
  check('replayed encounter is a no-op', again.results[0].reason === 'already-present', String(again.results[0].reason));
  check('replay did not duplicate observations', (await db.count('observation', { eq: { encounter_id: 'enc-1' } })) === 1, 'duplicated');
  check('replay did not duplicate symptoms', (await db.count('symptom', { eq: { encounter_id: 'enc-1' } })) === 1, 'duplicated');
  check('replay did not duplicate triage', (await db.count('triage', { eq: { encounter_id: 'enc-1' } })) === 1, 'duplicated');
}
{
  reset();
  const r = await processOps([
    op({ opId: 'op-e3', kind: 'create_encounter', entityId: 'enc-x', payload: { patientId: 'ghost' } }),
  ]);
  check('encounter for unknown patient rejected', r.results[0].status === 'rejected', JSON.stringify(r.results[0]));
  check('rejection explains why', /unknown patient/.test(r.results[0].reason), String(r.results[0].reason));
}

console.log('\n=== batch behaviour ===');
{
  reset();
  const r = await processOps([
    op({ opId: 'op-1', entityId: 'pat-1' }),
    op({ opId: 'op-2', entityId: 'pat-2', payload: { name: 'Lakshmi Bai' } }),
    op({ opId: 'op-3', kind: 'update_patient', entityId: 'pat-1', baseVersion: 99, payload: { village: 'Z' } }),
    op({ opId: 'op-4', kind: 'bogus_op' }),
  ]);
  check('all four answered', r.results.length === 4, String(r.results.length));
  check('two applied', r.applied === 2, JSON.stringify(r));
  check('one conflicted', r.conflicts === 1, JSON.stringify(r));
  check('one rejected', r.rejected === 1, JSON.stringify(r));
  check('unknown kind rejected not crashed', r.results[3].status === 'rejected', JSON.stringify(r.results[3]));
}

console.log('\n=== wire contract enforcement ===');
{
  reset();
  const r = await processOps([
    op({ opId: 'op-uc-1', payload: { name: 'A', age_years: 30 } }),
    op({ opId: 'op-uc-2', kind: 'update_patient', entityId: 'pat-1', baseVersion: 1, payload: { age_years: 30 } }),
  ]);
  check('create rejects unknown field', r.results[0].status === 'rejected', JSON.stringify(r.results[0]));
  check('update rejects unknown field', r.results[1].status === 'rejected', JSON.stringify(r.results[1]));
}
{
  const db = reset();
  await db.insertIgnore('worker', [{ id: 'wrk-1', name: 'L', role: 'HEALTH_WORKER' }]);
  await db.insertIgnore('patient', [{ id: 'pat-1', worker_id: 'wrk-1', name: 'S', version: 1 }]);
  const r = await processOps([
    op({
      opId: 'op-diastolic',
      kind: 'create_encounter',
      entityId: 'enc-bp',
      payload: {
        patientId: 'pat-1',
        observations: [
          { loinc: '85354-9', display: 'BP', value: 150, secondaryValue: 90, unit: 'mm[Hg]', ucumCode: 'mm[Hg]' },
          { loinc: '8310-5', display: 'Temp', value: 38.9, secondaryValue: null, unit: 'Cel', ucumCode: 'Cel' },
        ],
      },
    }),
  ]);
  check('two-observation encounter applied', r.results[0].status === 'applied', JSON.stringify(r.results[0]));
  const obs = await db.selectMany('observation', { in: { encounter_id: 'enc-bp' } });
  check('both observations kept', obs.length === 2, `kept ${obs.length}`);
  const bp = obs.find((o) => o.loinc_code === '85354-9');
  check('diastolic survives', bp?.secondary_value === 90, JSON.stringify(bp));
  check('ucum code survives', bp?.ucum_code === 'mm[Hg]', JSON.stringify(bp));
  check('derived ids are unique', new Set(obs.map((o) => o.id)).size === 2, JSON.stringify(obs.map((o) => o.id)));
  check('no derived id is "undefined"', obs.every((o) => o.id !== 'undefined'), JSON.stringify(obs.map((o) => o.id)));
  check('preliminary voice is not marked confirmed', obs.every((o) => o.confirmed_by === null), JSON.stringify(obs.map((o) => o.confirmed_by)));
}
{
  const db = reset();
  await db.insertIgnore('worker', [{ id: 'wrk-1', name: 'L', role: 'HEALTH_WORKER' }]);
  await db.insertIgnore('patient', [{ id: 'pat-1', worker_id: 'wrk-1', name: 'S', version: 1 }]);
  await processOps([
    op({ opId: 'op-final', kind: 'create_encounter', entityId: 'enc-fin', payload: { patientId: 'pat-1', observations: [{ loinc: '8310-5', display: 'T', value: 38, preliminary: false, source: 'tap' }] } }),
  ]);
  const row = (await db.selectMany('observation', { in: { encounter_id: 'enc-fin' } }))[0];
  check('explicit final becomes final', row?.status === 'final', JSON.stringify(row));
  check('final has a confirmer', row?.confirmed_by === 'wrk-1', JSON.stringify(row));
  check('tap source survives', row?.source === 'tap', JSON.stringify(row));
}
{
  const db = reset();
  await db.insertIgnore('patient', [
    { id: 'pat-1', worker_id: 'wrk-1', name: 'Live', version: 1, deleted_at: null },
    { id: 'pat-2', worker_id: 'wrk-1', name: 'Deleted', version: 1, deleted_at: '2026-01-01T00:00:00Z' },
  ]);
  check('selectOne hides a soft-deleted row', (await db.selectOne('patient', 'pat-2')) === null, 'still visible');
  check('selectOne shows a live row', (await db.selectOne('patient', 'pat-1')) !== null, 'hidden');
  check('count with LIVE excludes deleted', (await db.count('patient', { isNull: ['deleted_at'] })) === 1, String(await db.count('patient', { isNull: ['deleted_at'] })));
}

console.log('\n=== client/server route parity ===');
{
  // The phone hardcodes these paths. A typo here is a 404 that only shows up
  // in the field, so the two sides are read from source and compared.
  const { readFileSync } = await import('node:fs');
  const client = readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../server/index.ts', import.meta.url), 'utf8');
  const clientPaths = [...client.matchAll(/baseUrl}\$\{?`([^`]*\$\{baseUrl\}[^`]*)`/g)];
  const used = new Set();
  for (const m of client.matchAll(/`\$\{baseUrl\}([^`]*)`/g)) used.add(m[1]);
  for (const path of used) {
    const method = path.includes('/sync') ? 'POST /api/sync' : path.includes('login') ? 'POST /api/auth/login' : 'GET';
    const key = method.endsWith(path) ? method : `${method.split(' ')[0]} ${path}`;
    check(`server serves ${key}`, server.includes(`'${key}'`), `client calls ${path} but server has no ${key}`);
  }
}

process.exit(tally());
