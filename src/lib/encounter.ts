/**
 * Builds the payload that goes on the wire for a voice encounter.
 *
 * This lives outside the screen so the format is one testable function rather
 * than an object literal buried in a component. Every id is derived here on the
 * client, because the server uses these ids as primary keys and a collision
 * would silently drop a measurement.
 */

import { assessFlags, type ParsedSymptom, type ParsedVital } from './parse';
import { getDeviceId, newId } from './sync';

export interface EncounterPayload {
  id: string;
  patientId: string;
  workerId: string;
  deviceId: string;
  takenAt: string;
  lang: string;
  transcript: string | null;
  observations: ObservationPayload[];
  symptoms: SymptomPayload[];
  triage: TriagePayload[];
}

export interface ObservationPayload {
  id: string;
  loinc: string;
  display: string;
  value: number | null;
  /** diastolic half of a blood pressure; null for single-value measures */
  secondaryValue: number | null;
  unit: string;
  ucumCode: string;
  source: 'voice' | 'tap' | 'manual';
  preliminary: boolean;
}

export interface SymptomPayload {
  id: string;
  code: string;
  icon: string;
  source: 'voice' | 'tap' | 'manual';
  durationValue: number | null;
  durationUnit: 'hours' | 'days' | 'weeks' | null;
  negative: boolean;
}

export interface TriagePayload {
  id: string;
  label: string;
  severity: 'info' | 'medium' | 'high';
  detail: string | null;
}

export function buildEncounterPayload(input: {
  patientId: string;
  workerId: string;
  deviceId: string;
  lang: string;
  transcript: string | null;
  vitals: ParsedVital[];
  symptoms?: ParsedSymptom[];
}): EncounterPayload {
  const id = newId('enc');
  return {
    id,
    patientId: input.patientId,
    workerId: input.workerId,
    deviceId: input.deviceId,
    takenAt: new Date().toISOString(),
    lang: input.lang,
    transcript: input.transcript?.trim() ? input.transcript : null,
    observations: input.vitals.map((v, i) => ({
      // Index is part of the id so two identical readings in one encounter
      // (say, two temperatures) stay distinct rows.
      id: `${id}-obs-${i}`,
      loinc: v.loinc,
      display: v.display,
      value: v.value ?? null,
      secondaryValue: v.secondaryValue ?? null,
      unit: v.unit,
      ucumCode: v.ucumCode,
      source: 'voice' as const,
      preliminary: true,
    })),
    symptoms: (input.symptoms ?? []).map((s, i) => ({
      id: `${id}-sym-${i}`,
      code: s.code,
      icon: s.icon,
      source: s.source,
      durationValue: s.durationValue ?? null,
      durationUnit: s.durationUnit ?? null,
      negative: s.negative,
    })),
    triage: assessFlags({ vitals: input.vitals, symptoms: input.symptoms ?? [] }).map((f, i) => ({
      id: `${id}-tri-${i}`,
      label: f.label,
      severity: f.severity,
      detail: f.detail,
    })),
  };
}

export async function queueEncounter(
  input: Parameters<typeof buildEncounterPayload>[0]
): Promise<EncounterPayload> {
  const { enqueue, newId: nid } = await import('./sync');
  const deviceId = input.deviceId || (await getDeviceId());
  const payload = buildEncounterPayload({ ...input, deviceId });
  await enqueue({
    opId: nid('op'),
    kind: 'create_encounter',
    entityId: payload.id,
    baseVersion: 0,
    payload: payload as unknown as Record<string, unknown>,
    deviceId,
    workerId: input.workerId,
  });
  return payload;
}
