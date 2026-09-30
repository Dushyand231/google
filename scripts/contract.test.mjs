/**
 * End-to-end contract test: the real client code, the real server code, one
 * in-memory store between them.
 *
 * Every other suite exercises one side in isolation, which means both sides can
 * agree on the wrong thing and the tests still pass. This one runs the actual
 * `createPatient` and `buildEncounterPayload` from src/lib, pushes the resulting
 * ops through the actual `processOps` from server/, and asserts on the rows
 * that land. A payload key the server does not read shows up here as a column
 * that arrives empty.
 */

import { MemoryBackend, check, tally } from './testing/memory.mjs';

import { __setStore } from '../src/lib/storage';
import { __resetForTests, pendingOps } from '../src/lib/sync';
import { createPatient } from '../src/lib/patients';
import { buildEncounterPayload } from '../src/lib/encounter';
import { parseVitals, parseEncounter } from '../src/lib/parse';
import { processOps } from '../server/sync';
import { __setDb } from '../server/db';

const backend = new MemoryBackend();
__setStore(backend);
__setDb(backend);
__resetForTests();

await backend.set('worker:session', {
  workerId: 'wrk-lakshmi',
  name: 'Lakshmi',
  token: 't',
  baseUrl: 'http://localhost:4000',
});
await backend.insertIgnore('worker', [
  { id: 'wrk-lakshmi', name: 'Lakshmi', role: 'HEALTH_WORKER', village: 'Honnavar' },
]);
await backend.insertIgnore('device', [{ id: 'dev-1', worker_id: 'wrk-lakshmi', label: 'field' }]);

console.log('\n=== register a patient: client payload -> server -> row ===');
const patient = await createPatient({
  name: 'Suresh Gowda',
  ageYears: 58,
  sex: 'male',
  village: 'Honnavar',
  phone: '9845012345',
  consent: true,
  workerId: 'wrk-lakshmi',
});
{
  const ops = await pendingOps();
  check('one op queued', ops.length === 1, JSON.stringify(ops.length));
  await processOps(ops);
  const row = await backend.selectOne('patient', patient.id);
  check('row exists', row !== null, 'no row');
  check('name survives', row.name === 'Suresh Gowda', JSON.stringify(row));
  check('age survives the wire', row.age === 58, `age=${JSON.stringify(row.age)}`);
  check('sex survives', row.sex === 'male', JSON.stringify(row));
  check('village survives', row.village === 'Honnavar', JSON.stringify(row));
  check('phone survives', row.phone === '9845012345', JSON.stringify(row));
  check('consent survives the wire', row.consent_given === true, `consent_given=${JSON.stringify(row.consent_given)}`);
}

console.log('\n=== voice encounter: multiple vitals in one utterance ===');
{
  const transcript = 'blood pressure 150 over 90 and temperature 102 fever since three days';
  const parsed = parseEncounter(transcript, { lang: 'en' });
  check('parser found two vitals', parsed.vitals.length === 2, JSON.stringify(parsed.vitals.map((v) => v.kind)));
  check('parser found the fever', parsed.symptoms.length > 0, JSON.stringify(parsed.symptoms));

  const payload = buildEncounterPayload({
    patientId: patient.id,
    workerId: 'wrk-lakshmi',
    deviceId: 'dev-1',
    lang: 'en',
    transcript,
    vitals: parsed.vitals,
    symptoms: parsed.symptoms,
  });

  const opIds = new Set(payload.observations.map((o) => o.id));
  check('observation ids are unique', opIds.size === payload.observations.length, JSON.stringify([...opIds]));

  await processOps([
    {
      opId: 'op-enc-1',
      kind: 'create_encounter',
      entityId: payload.id,
      baseVersion: 0,
      deviceId: 'dev-1',
      workerId: 'wrk-lakshmi',
      payload,
    },
  ]);

  const obs = await backend.selectMany('observation', { in: { encounter_id: payload.id } });
  check('both observations stored', obs.length === 2, `stored ${obs.length}`);

  const bp = obs.find((o) => o.loinc_code === '85354-9');
  check('blood pressure row exists', bp !== undefined, JSON.stringify(obs.map((o) => o.loinc_code)));
  check('systolic stored', bp?.value_quantity === 150, JSON.stringify(bp));
  check('diastolic survives the wire', bp?.secondary_value === 90, `secondary_value=${JSON.stringify(bp?.secondary_value)}`);

  const temp = obs.find((o) => o.loinc_code === '8310-5');
  check('temperature row exists', temp !== undefined, JSON.stringify(obs.map((o) => o.loinc_code)));
  // "temperature 102" with no unit spoken. 102 C is not survivable, so [degF]
  // is the only reading, and the row is flagged for confirmation rather than
  // silently converted to a number the speaker never said.
  check('temperature value stored as spoken', temp?.value_quantity === 102, JSON.stringify(temp));
  check('temperature unit stored', temp?.unit === '[degF]', JSON.stringify(temp));
  check('ucum code survives the wire', temp?.ucum_code === '[degF]', `ucum_code=${JSON.stringify(temp?.ucum_code)}`);
  check('voice source survives the wire', temp?.source === 'voice', JSON.stringify(temp));
  check('inferred unit is flagged for confirmation', parsed.uncertainties.some((u) => u.reason === 'unit_inferred'), JSON.stringify(parsed.uncertainties));
  check('loinc code stored', temp?.loinc_code === '8310-5', JSON.stringify(temp));
  check('no observation id is "undefined"', obs.every((o) => o.id !== 'undefined'), JSON.stringify(obs.map((o) => o.id)));
  check('voice observations are preliminary', obs.every((o) => o.status === 'preliminary'), JSON.stringify(obs.map((o) => o.status)));
  check('unconfirmed voice has no confirmer', obs.every((o) => o.confirmed_by === null), JSON.stringify(obs.map((o) => o.confirmed_by)));

  const syms = await backend.selectMany('symptom', { in: { encounter_id: payload.id } });
  check('symptoms stored', syms.length > 0, 'none');
  const fever = syms.find((s) => s.code === 'fever');
  check('fever duration survives', fever?.duration_value === 3, JSON.stringify(fever));
  check('fever duration unit survives', fever?.duration_unit === 'days', JSON.stringify(fever));

  const enc = await backend.selectOne('encounter', payload.id);
  check('transcript kept verbatim', enc.transcript === transcript, JSON.stringify(enc?.transcript));
}

console.log('\n=== replaying a whole batch after a dropped connection ===');
{
  const parsed = parseVitals('blood pressure 130 over 85');
  const payload = buildEncounterPayload({
    patientId: patient.id,
    workerId: 'wrk-lakshmi',
    deviceId: 'dev-1',
    lang: 'en',
    transcript: 'blood pressure 130 over 85',
    vitals: parsed.vitals,
  });
  const mk = (opId) => ({
    opId,
    kind: 'create_encounter',
    entityId: payload.id,
    baseVersion: 0,
    deviceId: 'dev-1',
    workerId: 'wrk-lakshmi',
    payload,
  });
  const first = await processOps([mk('op-r1')]);
  const second = await processOps([mk('op-r2')]);
  check('first apply succeeds', first.results[0].status === 'applied', JSON.stringify(first.results[0]));
  check('replay is a no-op', second.results[0].reason === 'already-present', String(second.results[0].reason));
  const obs = await backend.selectMany('observation', { in: { encounter_id: payload.id } });
  check('replay did not duplicate observations', obs.length === 1, `stored ${obs.length}`);
}

console.log('\n=== a malformed client payload must not half-apply ===');
{
  const before = await backend.count('patient');
  const r = await processOps([
    {
      opId: 'op-bad-1',
      kind: 'create_patient',
      entityId: 'pat-bad',
      baseVersion: 0,
      deviceId: 'dev-1',
      workerId: 'wrk-lakshmi',
      // A client sending the wrong key name must be rejected, not accepted
      // with the field silently missing.
      payload: { name: 'Typo Patient', age_years: 44 },
    },
  ]);
  check('unknown field rejected', r.results[0].status === 'rejected', JSON.stringify(r.results[0]));
  check('rejection names the bad field', /age_years/.test(r.results[0].reason ?? ''), String(r.results[0].reason));
  check('nothing was written', (await backend.count('patient')) === before, 'partial write happened');
}

process.exit(tally());
