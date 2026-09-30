/**
 * Local patient records.
 *
 * A record is written to local storage first and queued second. If the queue
 * write fails the record is still readable locally, which is the safer order:
 * losing a patient from the list is worse than losing an upload.
 */

import { enqueue, newId, getDeviceId } from './sync';
import { getStore } from './storage';

export interface Patient {
  id: string;
  name: string;
  ageYears: number;
  sex: 'male' | 'female' | 'other';
  village: string;
  phone?: string;
  consent: boolean;
  workerId: string;
  createdAt: string;
  /** server version this device last saw, for the next sync op */
  version: number;
}

const KEY = 'patient:';

export async function listPatients(workerId: string): Promise<Patient[]> {
  const s = await getStore();
  const keys = await s.keys(KEY);
  const all = await Promise.all(keys.map((k) => s.get<Patient>(k)));
  return all
    .filter((p): p is Patient => p !== null && p.workerId === workerId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getPatient(id: string): Promise<Patient | null> {
  const s = await getStore();
  return s.get<Patient>(`${KEY}${id}`);
}

export interface NewPatientInput {
  name: string;
  ageYears: number;
  sex: Patient['sex'];
  village: string;
  phone?: string;
  consent: boolean;
  workerId: string;
}

export async function createPatient(input: NewPatientInput): Promise<Patient> {
  const s = await getStore();
  const deviceId = await getDeviceId();
  const patient: Patient = {
    id: newId('pat'),
    name: input.name.trim(),
    ageYears: input.ageYears,
    sex: input.sex,
    village: input.village.trim(),
    phone: input.phone?.trim() || undefined,
    consent: input.consent,
    workerId: input.workerId,
    createdAt: new Date().toISOString(),
    version: 0,
  };
  await s.set(`${KEY}${patient.id}`, patient);
  await enqueue({
    opId: newId('op'),
    kind: 'create_patient',
    entityId: patient.id,
    baseVersion: 0,
    // Keys match server/sync.ts PATIENT_COLUMNS exactly. id and worker_id are
    // already carried by entityId and op.workerId, so they are not repeated
    // here. The server rejects unknown keys, so a rename cannot slip through.
    payload: {
      name: patient.name,
      age: patient.ageYears,
      sex: patient.sex,
      village: patient.village,
      phone: patient.phone ?? null,
      consent_given: patient.consent,
    },
    deviceId,
    workerId: input.workerId,
  });
  return patient;
}
