/**
 * Minimal FHIR R4 resource shapes, profiled for the Indian context.
 *
 * Reference: ABDM Health Data Interchange Specifications via NRCeS
 * https://www.nrces.in/ndhm/fhir/r4/index.html
 *
 * We emit FHIR as the *sync payload itself* rather than retrofitting an export
 * step onto a proprietary schema. That is what makes JeevaCare plug into the
 * Ayushman Bharat Digital Mission instead of becoming another silo.
 */

export const LOINC = {
  bloodPressurePanel: '85354-9',
  systolic: '8480-6',
  diastolic: '8462-4',
  bloodGlucose: '2339-0',
  bodyWeight: '29463-7',
  bodyHeight: '8302-2',
  bodyTemperature: '8310-5',
  heartRate: '8867-4',
  oxygenSaturation: '2708-6',
} as const;

export const UCUM = 'http://unitsofmeasure.org';

export type LOINCCode = (typeof LOINC)[keyof typeof LOINC];

export interface Coding {
  system: string;
  code: string;
  display: string;
}

export interface Quantity {
  value: number;
  unit: string;
  system: string;
  code: string;
}

export interface CodeableConcept {
  coding: Coding[];
  text?: string;
}

export interface ObservationComponent {
  code: CodeableConcept;
  valueQuantity: Quantity;
}

export type ObservationStatus = 'preliminary' | 'final' | 'amended';

export interface FHIRObservation {
  resourceType: 'Observation';
  id: string;
  meta: { profile: string[] };
  status: ObservationStatus;
  category?: CodeableConcept[];
  code: CodeableConcept;
  component?: ObservationComponent[];
  valueQuantity?: Quantity;
  subject: { reference: string };
  encounter: { reference: string };
  performer: { reference: string }[];
  effectiveDateTime: string;
}

export interface FHIRObservationInput {
  loinc: LOINCCode;
  display: string;
  value: number;
  unit: string;
  ucumCode: string;
}

export interface PatientInput {
  id: string;
  name: string;
  age: number;
  sex: 'male' | 'female' | 'other';
  village: string;
  phone?: string;
  abha?: string;
}

export interface FhirPatient {
  resourceType: 'Patient';
  id: string;
  name: { text: string }[];
  gender: 'male' | 'female' | 'other';
  birthDate?: string;
  telecom?: { value: string; system: string }[];
  address?: { text: string }[];
  identifier?: { system: string; value: string }[];
  managingOrganization?: { display: string };
}

export function buildObservation(params: {
  id: string;
  patientId: string;
  encounterId: string;
  practitionerId: string;
  loinc: LOINCCode;
  display: string;
  value: number;
  unit: string;
  ucumCode: string;
  status: ObservationStatus;
  effectiveDateTime: string;
}): FHIRObservation {
  return {
    resourceType: 'Observation',
    id: params.id,
    meta: {
      profile: ['https://nrces.in/ndhm/fhir/r4/StructureDefinition/Observation'],
    },
    status: params.status,
    code: {
      coding: [{ system: 'http://loinc.org', code: params.loinc, display: params.display }],
      text: params.display,
    },
    valueQuantity: {
      value: params.value,
      unit: params.unit,
      system: UCUM,
      code: params.ucumCode,
    },
    subject: { reference: `Patient/${params.patientId}` },
    encounter: { reference: `Encounter/${params.encounterId}` },
    performer: [{ reference: `Practitioner/${params.practitionerId}` }],
    effectiveDateTime: params.effectiveDateTime,
  };
}

export function buildBloodPressureObservation(params: {
  id: string;
  patientId: string;
  encounterId: string;
  practitionerId: string;
  systolic: number;
  diastolic: number;
  status: ObservationStatus;
  effectiveDateTime: string;
}): FHIRObservation {
  return {
    resourceType: 'Observation',
    id: params.id,
    meta: {
      profile: ['https://nrces.in/ndhm/fhir/r4/StructureDefinition/Observation'],
    },
    status: params.status,
    category: [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/observation-category',
            code: 'vital-signs',
            display: 'Vital Signs',
          },
        ],
      },
    ],
    code: {
      coding: [
        {
          system: 'http://loinc.org',
          code: LOINC.bloodPressurePanel,
          display: 'Blood pressure',
        },
      ],
      text: 'Blood pressure',
    },
    component: [
      {
        code: {
          coding: [
            { system: 'http://loinc.org', code: LOINC.systolic, display: 'Systolic blood pressure' },
          ],
        },
        valueQuantity: {
          value: params.systolic,
          unit: 'mm[Hg]',
          system: UCUM,
          code: 'mm[Hg]',
        },
      },
      {
        code: {
          coding: [
            {
              system: 'http://loinc.org',
              code: LOINC.diastolic,
              display: 'Diastolic blood pressure',
            },
          ],
        },
        valueQuantity: {
          value: params.diastolic,
          unit: 'mm[Hg]',
          system: UCUM,
          code: 'mm[Hg]',
        },
      },
    ],
    subject: { reference: `Patient/${params.patientId}` },
    encounter: { reference: `Encounter/${params.encounterId}` },
    performer: [{ reference: `Practitioner/${params.practitionerId}` }],
    effectiveDateTime: params.effectiveDateTime,
  };
}

export function toFhirPatient(p: PatientInput, ashaName: string, village: string): FhirPatient {
  const approxBirthYear = new Date().getFullYear() - p.age;
  return {
    resourceType: 'Patient',
    id: p.id,
    name: [{ text: p.name }],
    gender: p.sex,
    birthDate: `${approxBirthYear}-01-01`,
    ...(p.phone
      ? { telecom: [{ system: 'phone', value: p.phone }] }
      : {}),
    address: [{ text: `${p.village}, Karnataka` }],
    ...(p.abha
      ? { identifier: [{ system: 'https://abdm.abdm.gov.in', value: p.abha }] }
      : {}),
    managingOrganization: { display: `${ashaName} · ${village} PHC` },
  };
}
