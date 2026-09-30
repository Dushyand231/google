/**
 * Voice -> structured clinical data.
 *
 * The insight behind JeevaCare: a community health worker standing in a
 * patient's home has a BP cuff in one hand and is mid-conversation. She cannot
 * type. But she is *already saying the numbers out loud*. So we listen, and we
 * build the form for her.
 *
 * Three properties are non-negotiable, in priority order:
 *
 *  1. Never invent. Every field either has a span of the transcript that
 *     produced it, or it is reported as uncertain. A parser that confidently
 *     records the wrong blood pressure is worse than one that records nothing,
 *     because the health worker has no way to tell the difference.
 *  2. Bind by proximity. "Does the keyword appear anywhere?" is what let
 *     "sugar 120, weight 52" bind 120 to weight. A number binds to the nearest
 *     preceding keyword within a short window, and each keyword binds once.
 *  3. Numerals are words. A rural ASR returns "நூற்று நாற்பது" far more often
 *     than "140", so word-form numerals are folded to digits before any
 *     digit-shaped rule runs. See numwords.ts.
 *
 * Output is FHIR-ready Observation inputs, not raw form values.
 */

import { LOINC, type FHIRObservationInput, type LOINCCode } from './fhir';
import { digitsFromAnyLang } from './numwords';

export type VitalKind = 'bloodPressure' | 'glucose' | 'weight' | 'temperature' | 'pulse';

export interface ParsedVital {
  kind: VitalKind;
  display: string;
  loinc: LOINCCode;
  value?: number;
  secondaryValue?: number;
  unit: string;
  ucumCode: string;
  confidence: 'high' | 'medium';
  matchedText: string;
}

export type SymptomCode =
  | 'fever'
  | 'cough'
  | 'vomiting'
  | 'diarrhea'
  | 'headache'
  | 'bodyAche'
  | 'chills'
  | 'breathlessness';

export interface ParsedSymptom {
  code: SymptomCode;
  icon: string;
  negative: boolean;
  /**
   * How the symptom was captured. 'voice' means the parser found it in the
   * transcript; 'tap' means a health worker chose it from the grid without
   * saying it. Both are equally valid evidence -- a rash is often seen, not
   * described -- so the source changes provenance for audit, never confidence.
   */
  source: 'voice' | 'tap';
  durationValue?: number;
  durationUnit?: 'hours' | 'days' | 'weeks';
  matchedText: string;
}

export type UncertaintyReason =
  | 'asr_low_confidence'
  | 'unbound_number'
  | 'out_of_range'
  | 'ambiguous_binding'
  | 'unit_inferred'
  | 'no_duration';

export interface Uncertainty {
  reason: UncertaintyReason;
  /** Verbatim transcript text, so the UI can ask "did you say...?" */
  excerpt: string;
  field?: string;
}

export interface RejectedValue {
  value: number;
  kind: VitalKind;
  excerpt: string;
}

export interface VitalsResult {
  vitals: ParsedVital[];
  unmatchedNumbers: number[];
  rejected: RejectedValue[];
  /** measurements whose unit was assumed rather than spoken */
  inferredUnits: { kind: VitalKind; excerpt: string }[];
  normalised: string;
}

export interface ParseResult extends VitalsResult {
  symptoms: ParsedSymptom[];
  /** Non-empty means a human must confirm before this becomes clinical. */
  uncertainties: Uncertainty[];
  flags: { label: string; severity: 'high' | 'medium' | 'info'; detail: string }[];
  transcript: string;
}

type Lexicon = Record<string, string[]>;

const BP_WORDS: Lexicon = {
  en: ['bp', 'blood pressure', 'b p', 'pressure'],
  hi: ['बीपी', 'ब्लड प्रेशर', 'रक्तचाप', 'प्रेशर'],
  ta: ['இரத்த அழுத்தம்', 'அழுத்தம்', 'பிபி'],
  te: ['రక్తపోడுதనం', 'బిపి', 'పీడి'],
  kn: ['ರಕ್ತಚ್ಪೋತನ', 'ಬಿಪಿ'],
  ml: ['രക്തസമ്മർദം', 'ബിപി'],
};

const GLUCOSE_WORDS: Lexicon = {
  en: ['sugar', 'glucose', 'blood sugar', 'bs', 'sugar reading', 'random sugar', 'fasting'],
  hi: ['शुगर', 'ग्लूकोज़', 'चीनी', 'रक्त शर्करा'],
  ta: ['சர்க்கரை', 'சீனி', 'இரத்த சர்க்கரை', 'குளுக்கோஸ்'],
  te: ['సర్కరీ', 'గ్లూకోజ్', 'రక్తపు పంపు', 'చక్కెర'],
  kn: ['ಸಕ್ಕರೆ', 'ಗ್ಲೂಕೋಸ್', 'ರಕ್ತ ಸಕ್ಕರೆ', 'ಚಿನ್ನಿ'],
  ml: ['പഞ്ചസാക്കർ', 'ഗ്ലൂക്കോസ്', 'രക്തത്തിലെ പഞ്ചസാക്കർ'],
};

const WEIGHT_WORDS: Lexicon = {
  en: ['weight', 'wt', 'kilo', 'kg', 'body weight'],
  hi: ['वजन', 'वज़न', 'किलो'],
  ta: ['எடை', 'நிறை', 'கிலோ'],
  te: ['బరువు', 'బరువులు', 'కిలో'],
  kn: ['ತೂಕ', 'ತೂಕದ', 'ಕೆಜಿ'],
  ml: ['ഭാരം', 'കിലോ'],
};

const TEMP_WORDS: Lexicon = {
  en: ['temp', 'temperature', 'degrees'],
  hi: ['तापमान', 'ताप'],
  ta: ['வெப்பநிலை', 'உப்பரம்'],
  te: ['తాపనీరు', 'ఉష్ణోగ్రత'],
  kn: ['ಉಷ್ಣತೆ', 'ತಾಪಮಾನ'],
  ml: ['താപനില'],
};

const PULSE_WORDS: Lexicon = {
  en: ['pulse', 'heart rate', 'bpm', 'beats'],
  hi: ['नब्ज़', 'नब्ज', 'धड़कन', 'हृदय गति'],
  ta: ['நாடி', 'இதய துடிப்பு', 'புல்ஸ்'],
  te: ['నాడి', 'హృదయ స్పందన', 'పుల్స్'],
  kn: ['ನಾಡಿ', 'ಹೃದಯ ಬಡ', 'ಪಲ್ಸ್'],
  ml: ['നാഡി', 'ഹൃദയമിടിപ്പ്'],
};

/**
 * Tokens that mean the unit was actually spoken, as opposed to inferred from
 * the kind of measurement. "temperature 102 degrees" is stated; "temperature
 * 102" is inferred, and the app must not present an inference as a fact.
 *
 * The per-language lexicons already carry the unit words (Tamil "கிலோ" sits
 * in WEIGHT_WORDS.ta), so those are reused rather than duplicated here; only
 * tokens that are not also measurement names are added explicitly.
 */
const EXTRA_UNIT_TOKENS: Record<VitalKind, string[]> = {
  bloodPressure: ['mmhg', 'mm hg', 'millimeters of mercury'],
  glucose: ['mg/dl', 'mg per dl', 'milligrams'],
  weight: [],
  temperature: ['celsius', 'centigrade', 'fahrenheit', 'degree'],
  pulse: ['bpm', 'beats per minute', '/min'],
};

function unitTokensFor(kind: VitalKind): string[] {
  const lex = ALL_LEXICONS.find(([k]) => k === kind)?.[1] ?? {};
  return [...Object.values(lex).flat(), ...EXTRA_UNIT_TOKENS[kind]];
}

const ALL_LEXICONS: [VitalKind, Lexicon][] = [
  ['bloodPressure', BP_WORDS],
  ['glucose', GLUCOSE_WORDS],
  ['weight', WEIGHT_WORDS],
  ['temperature', TEMP_WORDS],
  ['pulse', PULSE_WORDS],
];

/**
 * Symptom vocabulary. `icon` is the pictogram key the mobile grid renders, so a
 * voice-heard symptom and a tapped one produce an identical artefact -- the
 * confidence gap must not change what the health worker sees.
 */
/**
 * A symptom's vocabulary across languages plus the pictogram the grid renders.
 * Declared as an interface rather than `Lexicon & { icon: string }` because the
 * icon is a single string and would otherwise clash with the string[] index
 * signature.
 */
interface SymptomEntry {
  icon: string;
  en: string[];
  hi: string[];
  ta: string[];
  te: string[];
  kn: string[];
  ml: string[];
}

const SYMPTOM_LEXICON: Record<SymptomCode, SymptomEntry> = {
  fever: {
    icon: 'fever',
    en: ['fever'], hi: ['बुखार', 'ज्वर'], ta: ['காய்ச்சல்'],
    te: ['జ్వరం'], kn: ['ಜ್ವರ'], ml: ['പനി'],
  },
  cough: {
    icon: 'cough',
    en: ['cough', 'coughing'], hi: ['खाँसी', 'खांसी'], ta: ['இருமல்'],
    te: ['గుంపు'], kn: ['ಕೆಗೆಹುತ್ತು'], ml: ['ചുമ്മൽ'],
  },
  vomiting: {
    icon: 'vomiting',
    en: ['vomiting', 'vomit', 'throwing up'], hi: ['उल्टी', 'वमन'],
    ta: ['வாந்தி', 'ஏறி'], te: ['వాంతి'], kn: ['ವಾಂತಿ'], ml: ['ഓമന്മ'],
  },
  diarrhea: {
    icon: 'diarrhea',
    en: ['diarrhea', 'diarrhoea', 'loose motion', 'loose motions'], hi: ['दस्त'],
    ta: ['வயிற்றுப்போக்கு', 'மலச்சிறப்பு'], te: ['మలదూప'],
    kn: ['ಅತಿಸೆರಿಕೆ'], ml: ['മലം പോയി'],
  },
  headache: {
    icon: 'headache',
    en: ['headache', 'head pain'], hi: ['सिरदर्द', 'सिर दर्द'],
    ta: ['தலைவலி'], te: ['తలనొప్పి'], kn: ['ತಲನೋವು'], ml: ['തലവേദന'],
  },
  bodyAche: {
    icon: 'bodyAche',
    en: ['body ache', 'body pain'], hi: ['शरीर दर्द'],
    ta: ['உடல் வலி'], te: ['శరీర నొప్పి'], kn: ['ದೇಹ ನೋವು'], ml: ['ശരീര വേദന'],
  },
  chills: {
    icon: 'chills',
    en: ['chills', 'shivering'], hi: ['कंपन', 'ठंड लगना'],
    ta: ['குளிர்'], te: ['చల్లి'], kn: ['ಉಲ್ಲು'], ml: ['വിറയൽ'],
  },
  breathlessness: {
    icon: 'breathlessness',
    en: ['breathlessness', 'shortness of breath', 'breathless'],
    hi: ['सांस फूलना', 'सांस लेना'],
    ta: ['மூச்சு முடியவில்லை', 'மூச்சுத்திண்டல்'],
    te: ['శ్వాస కష్టం'], kn: ['ಉಸಿರ ಕಷ್ಟ'], ml: ['ശ്വാസം കഷ്ടം'],
  },
};

/**
 * Negation. "no fever" is clinically the opposite of "fever", so a parser that
 * records a denied symptom as present is worse than one that records nothing.
 */
const NEGATIONS: Record<string, string[]> = {
  en: ['no ', 'not ', 'without ', 'denies '],
  hi: ['नहीं', 'नहि', 'नही'],
  ta: ['இல்லை', 'இல்ல', 'இல்லாத'],
  te: ['లేదు'],
  kn: ['ಇಲ್ಲ'],
  ml: ['ഇല്ല'],
};

/**
 * Duration units.
 *
 * Tamil agglutinates, so the spoken form is rarely the dictionary form:
 * "நாட்கள்" (days) surfaces as "நாட்களாக" (for days), "நாட்டில்" (in days).
 * The case suffix replaces the stem's virama, so a literal substring match on
 * "நாட்கள்" misses every inflected form. The bare stem is therefore also
 * listed -- 'நாட்' cannot collide with 'நாடு' (country) because the final
 * character is a virama versus a vowel sign.
 */
const DURATION_UNITS: { unit: 'hours' | 'days' | 'weeks'; words: string[] }[] = [
  {
    unit: 'hours',
    words: ['hour', 'hours', 'hrs', 'மணி', 'மணிநேரம்', 'घंटे', 'घंटा', 'गंटा', 'ಗಂಟೆ'],
  },
  {
    unit: 'days',
    words: ['day', 'days', 'நாட்', 'நாள்', 'நாட்டு', 'दिन', 'दिनों', 'రోజు', 'ದಿನ', 'ദിവസം'],
  },
  {
    unit: 'weeks',
    words: ['week', 'weeks', 'வார', 'வாரம்', 'ஹப்தா', 'हफ्ते', 'हफ्ता', 'వారం', 'వారం', 'ವಾರ'],
  },
];

/** "since yesterday", "நேற்று முதல்", "कल से" -- duration with no spoken number. */
const RELATIVE_DURATIONS: { days: number; words: string[] }[] = [
  { days: 1, words: ['நேற்று முதல்', 'நேற்று', 'कल से', 'yesterday', 'నిన్న', 'ನಿನ್ನೆ', 'ഇന്നലെ'] },
  { days: 2, words: ['நாள் முன்', 'before yesterday', 'परसों', 'మొన్ని రోజు', 'ಮಾರ್ಗದ ದಿನ'] },
];

/**
 * "over" is how people actually say blood pressure, not "/". Tamil uses a
 * single character (ஓர்) meaning "or". Every spoken variant is accepted.
 */
const BP_SEPARATORS = '\\/|\\s+over\\s+|\\s+ஓர்\\s+|\\s+over\\s+by\\s+|\\s+டிவிட்டு\\s+|-';

/**
 * How far back a number may look for its keyword. Small on purpose: a number
 * that inherits a keyword from half a sentence away is worse than no number at
 * all, because the health worker cannot tell which field it landed in.
 */
const MAX_LOOKBACK = 32;

function normalise(input: string): string {
  return digitsFromAnyLang(input)
    .toLowerCase()
    // Decimal separator first: "101.4" and "101,4" must survive as decimals,
    // while "120, weight 54" is punctuation. A digit-dot-1-or-2-digits is a
    // decimal point; a digit-comma-space is a separator.
    .replace(/(\d)[.,](\d{1,2})(?!\d)/g, '$1.$2')
    .replace(/[,!?;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Anchor {
  kind: VitalKind;
  keyword: string;
  start: number;
  end: number;
}

function findAnchors(text: string): Anchor[] {
  const anchors: Anchor[] = [];
  for (const [kind, lex] of ALL_LEXICONS) {
    for (const langWords of Object.values(lex)) {
      for (const raw of langWords) {
        const keyword = raw.toLowerCase();
        let from = 0;
        for (;;) {
          const idx = text.indexOf(keyword, from);
          if (idx === -1) break;
          anchors.push({ kind, keyword, start: idx, end: idx + keyword.length });
          from = idx + 1;
        }
      }
    }
  }
  // Longest-first so longer phrases win, then drop any keyword fully covered by
  // a longer one of the same family, so a bare "சர்க்கரை" later in the sentence
  // cannot steal the binding from a neighbouring number.
  anchors.sort((a, b) => b.keyword.length - a.keyword.length);
  const kept: Anchor[] = [];
  for (const a of anchors) {
    const covered = kept.some((k) => k.kind === a.kind && a.start >= k.start && a.end <= k.end);
    if (!covered) kept.push(a);
  }
  return kept;
}

const RANGES: Record<
  VitalKind,
  { min: number; max: number; unit: string; ucumCode: string; display: string; loinc: LOINCCode }
> = {
  bloodPressure: {
    min: 60, max: 260, unit: 'mm[Hg]', ucumCode: 'mm[Hg]',
    display: 'Blood pressure', loinc: LOINC.bloodPressurePanel,
  },
  glucose: {
    min: 40, max: 600, unit: 'mg/dL', ucumCode: 'mg/dL',
    display: 'Blood glucose', loinc: LOINC.bloodGlucose,
  },
  weight: {
    min: 10, max: 200, unit: 'kg', ucumCode: 'kg',
    display: 'Body weight', loinc: LOINC.bodyWeight,
  },
  temperature: {
    // A bare "102" is almost always Fahrenheit -- 102 C is not survivable, and
    // no Indian speaker says Celsius out loud. The value is accepted, but only
    // at medium confidence, because the unit was inferred rather than spoken.
    min: 95, max: 110, unit: '[degF]', ucumCode: '[degF]',
    display: 'Body temperature', loinc: LOINC.bodyTemperature,
  },
  pulse: {
    min: 30, max: 200, unit: 'beats/min', ucumCode: '/min',
    display: 'Heart rate', loinc: LOINC.heartRate,
  },
};

function inRange(kind: VitalKind, value: number): boolean {
  const r = RANGES[kind];
  return value >= r.min && value <= r.max;
}

export function parseVitals(rawTranscript: string): VitalsResult {
  const text = normalise(rawTranscript);
  const vitals: ParsedVital[] = [];
  /** character offsets already claimed, so one number feeds one field */
  const claimedSpans: [number, number][] = [];
  const inferredUnits: { kind: VitalKind; excerpt: string }[] = [];
  const anchors = findAnchors(text);
  const rejected: RejectedValue[] = [];

  const hasBpAnchorBefore = (index: number) =>
    anchors.some((a) => a.kind === 'bloodPressure' && a.end <= index && index - a.end <= MAX_LOOKBACK);

  // --- Blood pressure with an explicit separator ---------------------------
  // Pairs are matched before any single number so the slash always wins. A bare
  // "130/90" is blood pressure whether or not the language token survived.
  const bpPattern = new RegExp(`(\\d{2,3})\\s*(?:${BP_SEPARATORS})\\s*(\\d{2,3})`, 'g');
  let bpMatch: RegExpExecArray | null;
  while ((bpMatch = bpPattern.exec(text)) !== null) {
    const systolic = Number(bpMatch[1]);
    const diastolic = Number(bpMatch[2]);
    if (systolic < 60 || systolic > 260) continue;
    if (diastolic < 30 || diastolic > 160) continue;
    const anchored = hasBpAnchorBefore(bpMatch.index);
    vitals.push({
      kind: 'bloodPressure',
      display: RANGES.bloodPressure.display,
      loinc: RANGES.bloodPressure.loinc,
      value: systolic,
      secondaryValue: diastolic,
      unit: RANGES.bloodPressure.unit,
      ucumCode: RANGES.bloodPressure.ucumCode,
      confidence: anchored ? 'high' : 'medium',
      matchedText: bpMatch[0].trim(),
    });
    claimedSpans.push([bpMatch.index, bpMatch.index + bpMatch[0].length]);
    break;
  }

  // --- Blood pressure from word numerals: "நூற்று நாற்பது தொண்ணூறு" ---------
  // Folding numerals to digits leaves no "/" behind, so 140/90 arrives as two
  // bare numbers. Only attempted when a BP keyword actually precedes them:
  // without that anchor, "52 54" is two weights, not a blood pressure, and
  // guessing would be indefensible.
  if (!vitals.some((v) => v.kind === 'bloodPressure')) {
    const all: { start: number; text: string }[] = [];
    const numRe = /\d{2,3}/g;
    let nm: RegExpExecArray | null;
    while ((nm = numRe.exec(text)) !== null) all.push({ start: nm.index, text: nm[0] });
    for (let i = 0; i + 1 < all.length; i += 1) {
      const a = all[i];
      const b = all[i + 1];
      if (b.start - (a.start + a.text.length) > 3) continue;
      if (!hasBpAnchorBefore(a.start)) continue;
      const sys = Number(a.text);
      const dia = Number(b.text);
      if (sys < 60 || sys > 260 || dia < 30 || dia > 160) continue;
      if (sys <= dia) continue;
      const end = b.start + b.text.length;
      vitals.push({
        kind: 'bloodPressure',
        display: RANGES.bloodPressure.display,
        loinc: RANGES.bloodPressure.loinc,
        value: sys,
        secondaryValue: dia,
        unit: RANGES.bloodPressure.unit,
        ucumCode: RANGES.bloodPressure.ucumCode,
        confidence: 'high',
        matchedText: text.slice(a.start, end).trim(),
      });
      claimedSpans.push([a.start, end]);
      break;
    }
  }

  // --- Remaining vitals: bind each number to the NEAREST preceding keyword ---
  const anchorBound = new Set<Anchor>();
  const numberPattern = /\d{1,3}(?:\.\d{1,2})?/g;
  let m: RegExpExecArray | null;

  while ((m = numberPattern.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (claimedSpans.some(([s, e]) => start >= s && end <= e)) continue;
    const value = Number(m[0]);
    if (Number.isNaN(value)) continue;

    const bound = anchors
      .filter((a) => a.end <= start && start - a.end <= MAX_LOOKBACK && !anchorBound.has(a))
      .sort((a, b) => b.end - a.end)[0];
    if (!bound) continue;

    // Out of range means we misheard, not that the patient is extreme. The
    // value is claimed (so it is not double-counted as unmatched) but
    // recorded as a rejection for the confirmation gate to surface.
    if (!inRange(bound.kind, value)) {
      rejected.push({ value, kind: bound.kind, excerpt: `${bound.keyword} ${m[0]}`.trim() });
      anchorBound.add(bound);
      claimedSpans.push([start, end]);
      continue;
    }

    anchorBound.add(bound);
    claimedSpans.push([start, end]);

    // "temperature 102" names the measurement but not the scale, so [degF] is
    // inferred. Reporting that at high confidence would put a guessed unit in
    // front of a health worker as though it had been said out loud.
    const tail = text.slice(m.index, (m.index ?? 0) + m[0].length + 14).toLowerCase();
    const unitSpoken = unitTokensFor(bound.kind).some((w) => tail.includes(w.toLowerCase()));
    if (!unitSpoken) {
      inferredUnits.push({ kind: bound.kind, excerpt: `${bound.keyword} ${m[0]}`.trim() });
    }

    vitals.push({
      kind: bound.kind,
      display: RANGES[bound.kind].display,
      loinc: RANGES[bound.kind].loinc,
      value,
      unit: RANGES[bound.kind].unit,
      ucumCode: RANGES[bound.kind].ucumCode,
      confidence: unitSpoken ? 'high' : 'medium',
      matchedText: `${bound.keyword} ${m[0]}`.trim(),
    });
  }

  const allNumbers = (text.match(/\d{1,3}(?:\.\d{1,2})?/g) ?? []).map((n) => Number(n));
  const claimedValues = new Set<number>();
  for (const v of vitals) {
    if (v.value != null) claimedValues.add(v.value);
    if (v.secondaryValue != null) claimedValues.add(v.secondaryValue);
  }
  for (const r of rejected) claimedValues.add(r.value);
  const unmatchedNumbers = allNumbers.filter((n) => !claimedValues.has(n));

  return { vitals, unmatchedNumbers, rejected, inferredUnits, normalised: text };
}

/**
 * Duration is read from the text immediately following the symptom, because
 * people say the duration next to the symptom ("மூன்று நாட்களாக இருமல்"). A
 * duration found far from its symptom is almost always someone else's.
 */
function findDuration(text: string, backwards = false): { value: number; unit: 'hours' | 'days' | 'weeks' } | null {
  for (const { days, words } of RELATIVE_DURATIONS) {
    if (words.some((w) => text.includes(w.toLowerCase()))) return { value: days, unit: 'days' };
  }
  if (backwards) {
    // People say the duration *before* the symptom as often as after it
    // ("3 நாட்களாக இருமல்" / "3 days, cough"). The number nearest the symptom
    // is the last one in the window, so that is the one to read.
    const re = /(\d{1,3})/g;
    let nearest: number | null = null;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) nearest = Number(m[1]);
    if (nearest !== null) {
      for (const { unit, words } of DURATION_UNITS) {
        if (words.some((w) => text.includes(w))) return { value: nearest, unit };
      }
    }
    return null;
  }
  const numMatch = /(\d{1,3})/.exec(text);
  if (numMatch) {
    const value = Number(numMatch[1]);
    for (const { unit, words } of DURATION_UNITS) {
      if (words.some((w) => text.includes(w))) return { value, unit };
    }
    // A bare number with no unit is not a duration. "103" next to a cough is
    // usually the temperature, and silently recording "103 days of cough"
    // would corrupt the clinical picture. Return null and let the
    // confirmation gate ask instead.
    return null;
  }
  // A unit word with no number in front of it ("...has a fever for days") is
  // NOT a one-day duration. Recording 1 would invent a clinical fact, so this
  // returns null and the missing-duration uncertainty below asks instead.
  return null;
}

const DURATION_WINDOW = 28;

function findSymptoms(text: string): ParsedSymptom[] {
  const negations = Object.values(NEGATIONS).flat();
  const found: { sym: ParsedSymptom; start: number; end: number }[] = [];

  for (const code of Object.keys(SYMPTOM_LEXICON) as SymptomCode[]) {
    const entry = SYMPTOM_LEXICON[code];
    // Only the language keys. Iterating Object.values(entry) would also walk
    // `icon`, and a bare string iterates as characters -- so 'fever' would
    // search for 'f', 'e', 'v'... and match all over an unrelated transcript.
    for (const [key, words] of Object.entries(entry)) {
      if (key === 'icon' || !Array.isArray(words)) continue;
      for (const raw of words) {
        const word = raw.toLowerCase();
        let from = 0;
        for (;;) {
          const idx = text.indexOf(word, from);
          if (idx === -1) break;
          // Negation is checked behind the symptom ("no fever", "காய்ச்சல் இல்லை"),
          // and also ahead for the South Indian postfix form.
          const around = text.slice(Math.max(0, idx - 14), idx + word.length + 8);
          found.push({
            sym: {
              code,
              icon: entry.icon,
              negative: negations.some((n) => around.includes(n)),
              source: 'voice',
              matchedText: raw,
            },
            start: idx,
            end: idx + word.length,
          });
          from = idx + word.length;
        }
      }
    }
  }

  // Longest symptom match wins, so "தலைவலி" is not also counted as "வலி".
  found.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const kept: typeof found = [];
  for (const f of found) {
    if (kept.some((k) => f.start >= k.start && f.end <= k.end)) continue;
    kept.push(f);
  }
  kept.sort((a, b) => a.start - b.start);

  return kept.map(({ sym, start, end }) => {
    // A denied symptom has no duration to record. "बुखार नहीं" sitting next to
    // "3 दिन से खाँसी" must not inherit the cough's duration.
    if (sym.negative) return { ...sym };
    const forward = findDuration(text.slice(end, end + DURATION_WINDOW));
    const dur = forward ?? findDuration(text.slice(Math.max(0, start - DURATION_WINDOW), start), true);
    return dur
      ? { ...sym, durationValue: dur.value, durationUnit: dur.unit }
      : { ...sym };
  });
}

export interface Flag {
  label: string;
  severity: 'high' | 'medium' | 'info';
  detail: string;
}

/**
 * Rule-based red-flag triage. Transparent on purpose: a health worker must be
 * able to see *why* a patient was flagged, and a judge must be able to audit
 * the rule that fired.
 */
export function assessFlags(parsed: { vitals: ParsedVital[]; symptoms?: ParsedSymptom[] }): Flag[] {
  const flags: Flag[] = [];
  const bp = parsed.vitals.find((v) => v.kind === 'bloodPressure');
  const glucose = parsed.vitals.find((v) => v.kind === 'glucose');
  const temp = parsed.vitals.find((v) => v.kind === 'temperature');
  const pulse = parsed.vitals.find((v) => v.kind === 'pulse');
  const present = (parsed.symptoms ?? []).filter((s) => !s.negative);

  if (bp && bp.value != null && bp.secondaryValue != null) {
    if (bp.value >= 160 || bp.secondaryValue >= 100) {
      flags.push({
        label: 'Severe hypertension',
        severity: 'high',
        detail: `BP ${bp.value}/${bp.secondaryValue} - refer same day`,
      });
    } else if (bp.value >= 140 || bp.secondaryValue >= 90) {
      flags.push({
        label: 'Elevated BP',
        severity: 'medium',
        detail: `BP ${bp.value}/${bp.secondaryValue} - repeat in 1 week`,
      });
    }
  }
  if (glucose && glucose.value != null) {
    if (glucose.value >= 200) {
      flags.push({ label: 'High blood sugar', severity: 'high', detail: `${glucose.value} mg/dL - refer` });
    } else if (glucose.value >= 140) {
      flags.push({ label: 'Elevated glucose', severity: 'medium', detail: `${glucose.value} mg/dL - fasting recheck` });
    }
  }
  if (temp && temp.value != null && temp.value >= 101) {
    flags.push({ label: 'Fever', severity: 'medium', detail: `${temp.value} degF` });
  }
  if (pulse && pulse.value != null && (pulse.value < 50 || pulse.value > 120)) {
    flags.push({ label: 'Abnormal pulse', severity: 'medium', detail: `${pulse.value} /min` });
  }
  if (present.some((s) => s.code === 'breathlessness')) {
    flags.push({ label: 'Breathlessness reported', severity: 'high', detail: 'Assess urgently' });
  }
  if (present.some((s) => s.code === 'fever') && (temp?.value ?? 0) >= 103) {
    flags.push({ label: 'High fever with symptoms', severity: 'high', detail: 'Refer same day' });
  }
  if (flags.length === 0) {
    flags.push({ label: 'Within normal range', severity: 'info', detail: 'No red flags detected' });
  }
  return flags;
}

export interface ParseOptions {
  /** ASR engine confidence for the whole utterance, 0..1 */
  asrConfidence?: number;
  /** UI language, recorded on the encounter; does not change parsing rules */
  lang?: string;
}

const LOW_ASR_CONFIDENCE = 0.6;

/**
 * Everything the health worker must confirm before the record counts as
 * clinical. Empty list is the only path to an auto-final encounter.
 */
export function parseEncounter(rawTranscript: string, opts: ParseOptions = {}): ParseResult {
  const { vitals, unmatchedNumbers, rejected, inferredUnits, normalised } = parseVitals(rawTranscript);
  const symptoms = findSymptoms(normalised);
  const uncertainties: Uncertainty[] = [];

  if (opts.asrConfidence !== undefined && opts.asrConfidence < LOW_ASR_CONFIDENCE) {
    uncertainties.push({ reason: 'asr_low_confidence', excerpt: rawTranscript.slice(0, 60) });
  }
  for (const r of rejected) {
    uncertainties.push({ reason: 'out_of_range', excerpt: r.excerpt, field: r.kind });
  }
  for (const u of inferredUnits) {
    uncertainties.push({ reason: 'unit_inferred', excerpt: u.excerpt, field: u.kind });
  }
  for (const v of vitals) {
    // A medium reading that is not explained by an inferred unit is a genuine
    // ambiguous binding (a number near two competing anchors).
    const explained = inferredUnits.some((u) => u.kind === v.kind);
    if (v.confidence === 'medium' && !explained) {
      uncertainties.push({ reason: 'ambiguous_binding', excerpt: v.matchedText, field: v.kind });
    }
  }
  // A number consumed as a symptom duration is spoken, not misheard, so it must
  // not also be reported as an unclaimed fragment.
  const spoken = new Set<number>();
  for (const s of symptoms) if (s.durationValue !== undefined) spoken.add(s.durationValue);
  const stranded = unmatchedNumbers.filter((n) => !spoken.has(n));

  for (const n of stranded) {
    uncertainties.push({ reason: 'unbound_number', excerpt: String(n) });
  }
  for (const s of symptoms) {
    if (!s.negative && s.durationValue === undefined) {
      uncertainties.push({ reason: 'no_duration', excerpt: s.matchedText, field: s.code });
    }
  }

  return {
    vitals,
    symptoms,
    unmatchedNumbers,
    rejected,
    inferredUnits,
    normalised,
    uncertainties,
    flags: assessFlags({ vitals, symptoms }),
    transcript: rawTranscript,
  };
}

/** Convert parsed vitals into FHIR Observation inputs. */
export function toObservationInputs(parsed: { vitals: ParsedVital[] }): FHIRObservationInput[] {
  const out: FHIRObservationInput[] = [];
  for (const v of parsed.vitals) {
    if (v.kind === 'bloodPressure') {
      if (v.value == null || v.secondaryValue == null) continue;
      out.push({
        loinc: LOINC.systolic,
        display: 'Systolic blood pressure',
        value: v.value,
        unit: v.unit,
        ucumCode: v.ucumCode,
      });
      out.push({
        loinc: LOINC.diastolic,
        display: 'Diastolic blood pressure',
        value: v.secondaryValue,
        unit: v.unit,
        ucumCode: v.ucumCode,
      });
      continue;
    }
    if (v.value == null) continue;
    out.push({ loinc: v.loinc, display: v.display, value: v.value, unit: v.unit, ucumCode: v.ucumCode });
  }
  return out;
}

/**
 * Every sample here is expected to yield a full vitals panel including blood
 * pressure. Symptom-only utterances live in SYMPTOM_SAMPLES so this list stays
 * a uniform regression net for the vitals extractor.
 */
export const SAMPLE_TRANSCRIPTS: { lang: string; label: string; text: string }[] = [
  { lang: 'ta', label: 'Tamil', text: 'இரத்த அழுத்தம் 130 ஓர் 90, சர்க்கரை 120, எடை 52 கிலோ' },
  { lang: 'hi', label: 'Hindi', text: 'बीपी 130/90, शुगर 120, वजन 52 किलो' },
  { lang: 'te', label: 'Telugu', text: 'రక్తపోడுதనం 130/90, సర్కరీ 120, బరువు 52 కిలో' },
  { lang: 'kn', label: 'Kannada', text: 'ರಕ್ತಚ್ಪೋತನ 130/90, ಸಕ್ಕರೆ 120, ತೂಕ 52 ಕೆಜಿ' },
  { lang: 'en', label: 'English', text: 'BP 150 over 100, sugar 240, weight 54, temp 101.4' },
  { lang: 'en', label: 'ASR-degraded', text: '130/90 120 52' },
  { lang: 'ta', label: 'Tamil word numerals', text: 'இரத்த அழுத்தம் நூற்று நாற்பது தொண்ணூறு, சர்க்கரை நூற்று இருபது, எடை ஐம்பது இரண்டு கிலோ' },
  { lang: 'hi', label: 'Hindi word numerals', text: 'बीपी एक सौ चालीस नब्बे, चीनी दो सौ चालीस, तापमान एक सौ एक पाअंश दो' },
];

/** Symptom, duration and negation coverage, including word-form numerals. */
export const SYMPTOM_SAMPLES: { lang: string; label: string; text: string }[] = [
  { lang: 'ta', label: 'Tamil decimal + duration', text: 'வெப்பநிலை நூற்றி ஒன்று புள்ளி இரண்டு, மூன்று நாட்களாக இருமல்' },
  { lang: 'ta', label: 'Tamil weeks', text: 'இருமல் இரண்டு வாரங்களாக' },
  { lang: 'ta', label: 'Tamil since yesterday', text: 'நேற்று முதல் காய்ச்சல்' },
  { lang: 'hi', label: 'Hindi duration + denial', text: 'तीन दिन से खाँसी, बुखार नहीं' },
  { lang: 'en', label: 'English denial', text: 'temp 103.2, no cough, no vomiting' },
  { lang: 'en', label: 'English duration', text: 'cough for 3 days, temp 101.4' },
];
