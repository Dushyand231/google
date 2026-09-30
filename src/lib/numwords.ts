/**
 * Word-form numerals for Tamil and Hindi.
 *
 * A rural ASR frequently returns spelled-out numbers rather than digits:
 * "வெப்பநிலை நூற்றி ஒன்று புள்ளி இரண்டு" for 101.2 °F. If the parser only reads
 * digits, that utterance records nothing at all — and silently dropping a fever
 * reading is worse than a wrong one.
 *
 * Both languages are ADDITIVE across a run of numeral words, with one wrinkle:
 *   Tamil  நூற்று நாற்பது  = 100 + 40  = 140   (fused hundred token)
 *   Hindi  एक सौ चालीस     = 1×100 + 40 = 140   (coefficient + सौ)
 * so a unit digit immediately before 100 is a hundreds multiplier, not an
 * addend. Getting that wrong turns 140 into 102, which is a plausible but
 * wrong blood pressure — the worst kind of parser bug.
 *
 * Explicit tables hold every irregular form (Tamil 90 is தொண்ணூறு, Hindi 19 is
 * उन्नीस, Tamil 50 is ஐம்பது not 40+10); none of these follow a pattern, so
 * they cannot be composed.
 *
 * Anything unrecognised returns null and is left untouched. We do not guess. An
 * unresolved numeral surfaces through the voice-uncertainty gate so a human
 * decides — never a silent wrong number.
 *
 * Output is the transcript with numerals substituted, so the digit-based vitals
 * parser downstream needs no changes and word/digit input converges on one path.
 */

import { generatedEnglish, generatedHindi, generatedTamil, type Entry } from './numwords.grammar';

export type NumLang = 'ta' | 'hi' | 'en';

const RAW_TAMIL: Record<string, number> = {
  'பூஜ்ஜியம்': 0, 'பூஜ்ஜிய': 0, 'சூஜ்யம்': 0,
  // units
  'ஒன்று': 1, 'ஒண்ணு': 1, 'வெற்று': 1,
  'இரண்டு': 2, 'ஈரண்டு': 2,
  'மூன்று': 3, 'முன்று': 3,
  'நான்கு': 4, 'நாலுங்கு': 4,
  'ஐந்து': 5, 'ஐதின்': 5,
  'ஆறு': 6,
  'ஏழு': 7,
  'எட்டு': 8,
  'ஒன்பது': 9,
  // teens
  'பத்து': 10, 'பத': 10,
  'பதினொன்று': 11,
  'பன்னிரண்டு': 12,
  'பத மூன்று': 13, 'பதமூன்று': 13, 'பதமுன்று': 13,
  'பதினாலு': 14,
  'பதினைந்து': 15,
  'பதினேழு': 17,
  'பதெட்டு': 18,
  'பத்தொன்பது': 19,
  // tens
  'இருபது': 20, 'முப்பது': 30, 'நாற்பது': 40, 'ஐம்பது': 50,
  'அற்பது': 60, 'எழுபது': 70, 'எண்பது': 80, 'தொண்ணூறு': 90,
  // fused 21-29: written as single words, unreachable by composition
  'இருபத்தொன்று': 21, 'இருபத்திரண்டு': 22, 'இருபத்துமூன்று': 23,
  'இருபத்தநால்கு': 24, 'இருபத்தைந்து': 25, 'இருபத்தாறு': 26,
  'இருபத்தேழு': 27, 'இருபத்தெட்டு': 28, 'இருபத்தொன்பது': 29,
  // hundreds. நூற்றி / நூறி are the linking forms used before another numeral
  // ("நூற்றி ஒன்று" = 101); நூறு / நூற்று are the bare forms.
  'நூறு': 100, 'நூற்று': 100, 'நூறி': 100, 'நூற்றி': 100,
  'இருநூறு': 200, 'இருநூற்று': 200, 'முன்றுநூறு': 300, 'நான்குநூறு': 400,
  'ஐந்துநூறு': 500, 'ஆறுநூறு': 600, 'ஏழுநூறு': 700, 'எட்டுநூறு': 800,
  'ஒன்பதுநூறு': 900,
  // decimal point
  'புள்ளி': -1, 'புல்ளி': -1, 'பொய்ளி': -1,
};

const RAW_HINDI: Record<string, number> = {
  'शून्य': 0, 'सून्य': 0, 'जीरो': 0,
  'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'पाच': 5,
  'छह': 6, 'छः': 6, 'चह': 6, 'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10,
  'ग्यारह': 11, 'बारह': 12, 'तेरह': 13, 'चौदह': 14, 'पंद्रह': 15, 'पन्द्रह': 15,
  'सोलह': 16, 'सत्रह': 17, 'अठारह': 18, 'उन्नीस': 19,
  'बीस': 20, 'इकतीस': 21, 'बत्तीस': 22, 'तैंतीस': 23, 'चौंतीस': 24, 'पैंतीस': 25,
  'छत्तीस': 26, 'सैंतीस': 27, 'अट्ठाईस': 28, 'उनतीस': 29,
  'तीस': 30, 'इकतालीस': 31, 'बत्तालीस': 32, 'तैंतालीस': 33, 'चवालीस': 34,
  'पैंतालीस': 35, 'छियालीस': 36, 'सैंतालीस': 37, 'अड़तीस': 38, 'उनतालीस': 39,
  // 41..47 are deliberately absent: Hindi reuses the x1 spelling for both
  // decades (इकतालीस is 31 *and* 41, likewise 33/43 through 37/47). Only the
  // x1 reading is stored; a bare homograph resolves to the smaller value and
  // the downstream physiological range check plus the confirmation gate catch
  // it if the speaker meant the other. Guessing a second value is not possible
  // from the text alone, and silently emitting both would be worse.
  'चालीस': 40, 'बयालीस': 42, 'अड़तालीस': 48, 'उनचास': 49,
  'पचास': 50, 'इक्यावन': 51, 'बावन': 52, 'तिरपन': 53, 'चौवन': 54, 'पचपन': 55,
  'छप्पन': 56, 'सत्तपन': 57, 'अट्ठपन': 58, 'उनसठ': 59,
  'साठ': 60, 'इकसठ': 61, 'बासठ': 62, 'तिरसठ': 63, 'चौंसठ': 64, 'पैंसठ': 65,
  'छियासठ': 66, 'सड़सठ': 67, 'अड़सठ': 68, 'उनहत्तर': 69,
  'सत्तर': 70, 'इकहत्तर': 71, 'बहत्तर': 72, 'तिहत्तर': 73, 'चौहत्तर': 74,
  'पचहत्तर': 75, 'छिहत्तर': 76, 'सतहत्तर': 77, 'अठहत्तर': 78, 'उन्यासी': 79,
  'अस्सी': 80, 'इक्यासी': 81, 'बयासी': 82, 'तिरयासी': 83, 'चौरासी': 84,
  'पचासी': 85, 'छियासी': 86, 'सतयासी': 87, 'अट्ठासी': 88, 'नवासी': 89,
  'नबासे': 90, 'नवासे': 90, 'नब्बे': 90, 'इक्यानवे': 91, 'बानवे': 92,
  'तिरानवे': 93, 'चौरानवे': 94, 'पंचानवे': 95, 'छियानवे': 96, 'सत्तानवे': 97,
  'अट्ठानवे': 98, 'निन्यानवे': 99,
  'सौ': 100, 'सो': 100,
  'दशमलव': -1, 'पाअंश': -1, 'दशमाश': -1,
};

const DECIMAL = -1;

/**
 * Canonicalise a token before lookup. Two things are stripped:
 *
 *  - Unicode punctuation. Dictations arrive punctuated ("தொண்ணூறு,"), and the
 *    comma must not turn a recognisable numeral into a miss.
 *  - Everything that is not a letter or digit, which also collapses
 *    whitespace and zero-width joiners.
 *
 * Devanagari and Tamil combining marks additionally arrive in inconsistent byte
 * sequences from different ASR engines and hand-edited JSON, so 'ஒன்று' can be
 * several distinct codepoint sequences that render identically. NFC makes them
 * one key. Without normalisation the same word silently drops the numeral.
 *
 * \p{M} must be preserved: the "ு" in "தொண்ணூறு" is a combining mark, not a
 * letter, and stripping it would change the word to "தொண்ணூற".
 */
function norm(s: string): string {
  return s.normalize('NFC').replace(/[^\p{L}\p{M}\p{N}]/gu, '');
}

function buildTable(raw: Record<string, number>, generated: Entry[] = []): Map<string, number> {
  const m = new Map<string, number>();
  for (const [k, v] of Object.entries(raw)) {
    const key = norm(k);
    // A fused word like 'சதமூன்று' contains its parts; prefer the longer
    // key by only inserting if absent, and never let a short key overwrite.
    if (!m.has(key)) m.set(key, v);
  }
  // Grammar is authoritative, so it overwrites the hand-written list. Where
  // the two disagree the hand-written entry is the bug, not the grammar.
  for (const [form, value] of generated) m.set(norm(form), value);
  return m;
}

/**
 * English numerals.
 *
 * Included because English is the app's default locale and is used as the
 * fallback for bilingual ASR output, so English number words reach the same
 * code path as Tamil and Hindi ones. Composition is additive, so "twenty one"
 * reads as 20 + 1. "one hundred and five" is NOT supported: the run breaks at
 * the "and" and yields 100. That is a known limit, not silent corruption --
 * the value still has to clear the confirmation gate.
 */
const RAW_ENGLISH: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};

/**
 * Generated entries are applied after the hand-written ones so that grammar
 * wins where they disagree. The hand-written lists carry colloquial variants
 * the grammar does not model (காலை for 25, "one and a half", and so on), but
 * an exhaustive 0..999 check showed they also contain outright gaps: whole
 * tens like அறுபது, most of the sandhi-fused forms, and most Hindi
 * irregulars were simply absent, and a numeral the table does not know is
 * passed through untouched rather than reported as an error.
 */
const TABLES: Record<NumLang, Map<string, number>> = {
  ta: buildTable(RAW_TAMIL, generatedTamil()),
  hi: buildTable(RAW_HINDI, generatedHindi()),
  en: buildTable(RAW_ENGLISH, generatedEnglish()),
};

export interface NumeralHit {
  start: number;
  end: number;
  text: string;
  value: number;
}

function isWhitespace(token: string): boolean {
  return /^\s*$/.test(token);
}

/**
 * Fold collected numeral values into a single number.
 *
 * A unit digit (1-9) sitting directly in front of 100 is a hundreds
 * multiplier (Hindi "दो सौ" = 200). A 100 with no such coefficient contributes
 * +100 (Tamil "நூற்று நாற்பது" = 140). Fused hundreds ("இருநூறு" = 200) are a
 * single token that already carries the multiplier.
 */
function fold(vals: number[]): number {
  let hundreds = 0;
  let sum = 0;
  let i = 0;
  while (i < vals.length) {
    const v = vals[i];
    if (v === 100) {
      if (hundreds === 0) hundreds = 100;
      i += 1;
      continue;
    }
    if (v >= 200 && v % 100 === 0) {
      if (hundreds === 0) hundreds = v;
      i += 1;
      continue;
    }
    // A unit digit directly in front of 100 is a hundreds coefficient. This
    // must be checked with lookahead, not by inspecting the previous token:
    // by the time 100 is reached the unit has already been summed, and
    // "एक सौ चालीस" would fold to 141 instead of 140.
    if (v >= 1 && v <= 9 && i + 1 < vals.length && vals[i + 1] === 100) {
      if (hundreds === 0) hundreds = v * 100;
      i += 2;
      continue;
    }
    sum += v;
    i += 1;
  }
  return hundreds + sum;
}

interface Run {
  value: number;
  consumed: number;
}

/**
 * Read a run of numeral words beginning at token index `i`, skipping the
 * whitespace between them. Returns null when the first real token is not a
 * numeral, so the caller can advance one token and retry.
 */
function readRun(words: string[], i: number, table: Map<string, number>): Run | null {
  const before: number[] = [];
  const after: number[] = [];
  let seenDecimal = false;
  let lastIndex = -1;
  let hundredsSeen = false;
  let tensAfterHundreds = false;
  let index = i;
  // Four terms covers 9 + 9 + 100-scaled forms and the fused irregulars; more
  // than that in one run is not a number, it is two adjacent numbers.
  const MAX_TERMS = 4;

  while (index < words.length) {
    if (isWhitespace(words[index])) {
      index += 1;
      continue;
    }
    const v = table.get(norm(words[index]));
    if (v === undefined) break;
    if (seenDecimal ? after.length >= 3 : before.length >= MAX_TERMS) break;
    // "एक सौ चालीस नब्बे" is blood pressure 140/90, two numbers, not 230.
    // After a hundreds term only one further tens-scale term may join the run;
    // a second one starts a new number. Bare unit terms are always allowed.
    if (!seenDecimal && v >= 10) {
      if (hundredsSeen) {
        if (tensAfterHundreds) break;
        tensAfterHundreds = true;
      }
      if (v === 100 || (v >= 200 && v % 100 === 0)) hundredsSeen = true;
    }

    if (v === DECIMAL) {
      seenDecimal = true;
    } else if (seenDecimal) {
      after.push(v);
    } else {
      before.push(v);
    }
    lastIndex = index;
    // Punctuation after the numeral word marks a phrase boundary. Without this
    // "நூற்றி ஒன்று புள்ளி இரண்டு, மூன்று நாட்களாக" folds the following
    // clause into the decimal and yields 101.23 instead of 101.2.
    if (norm(words[index]) !== words[index]) break;
    index += 1;
  }

  if (lastIndex < 0) return null;

  // Span ends at the last numeral, never the separator after it, so the next
  // scan resumes on the following word instead of eating its leading space.
  const value = fold(before) + (after.length ? after.reduce((a, d) => a * 10 + d, 0) / Math.pow(10, after.length) : 0);
  return { value, consumed: lastIndex - i + 1 };
}

export function findNumerals(text: string, lang: NumLang): NumeralHit[] {
  const words = text.split(/(\s+)/);
  const table = TABLES[lang];
  const hits: NumeralHit[] = [];

  let i = 0;
  while (i < words.length) {
    if (isWhitespace(words[i])) {
      i += 1;
      continue;
    }
    const run = readRun(words, i, table);
    if (run && run.consumed > 0) {
      const start = words.slice(0, i).join('').length;
      let end = start + words.slice(i, i + run.consumed).join('').length;
      // The span covers whole tokens, so it can include a trailing comma or
      // full stop. Trim it back to the last real character, otherwise the
      // replacement silently deletes the punctuation.
      while (end > start && !/[\p{L}\p{M}\p{N}]/u.test(text[end - 1])) end -= 1;
      hits.push({ start, end, text: text.slice(start, end), value: run.value });
      i += run.consumed;
      continue;
    }
    i += 1;
  }
  return hits;
}

/**
 * Rewrite a transcript with every recognised word-numeral replaced by digits.
 * Unrecognised input is returned untouched, so the caller can distinguish
 * "no measurement present" from "we failed to understand the number".
 */
export function digitsFromWords(text: string, lang: NumLang): string {
  const hits = findNumerals(text, lang);
  if (hits.length === 0) return text;
  let out = '';
  let cursor = 0;
  for (const h of hits) {
    out += text.slice(cursor, h.start) + h.value;
    cursor = h.end;
  }
  return out + text.slice(cursor);
}

/**
 * Substitute numerals in a transcript whose language is not known.
 *
 * The vocabularies are script-disjoint (Tamil script, Devanagari, and a
 * handful of unambiguous numerals), so a hit can only come from the language
 * that owns it. Collecting from both and sorting by offset is therefore safe,
 * and it lets the parser accept a raw dictation with no language flag — which
 * is the normal case, because the ASR layer does not reliably report one.
 */
export function digitsFromAnyLang(text: string): string {
  const hits = [...findNumerals(text, 'ta'), ...findNumerals(text, 'hi'), ...findNumerals(text, 'en')].sort(
    (a, b) => a.start - b.start
  );
  if (hits.length === 0) return text;
  let out = '';
  let cursor = 0;
  for (const h of hits) {
    if (h.start < cursor) continue;
    out += text.slice(cursor, h.start) + h.value;
    cursor = h.end;
  }
  return out + text.slice(cursor);
}

/**
 * Read a single number out of free text, accepting either typed digits or a
 * Tamil/Hindi word-numeral. Returns null rather than a guess when nothing
 * recognisable is present, because callers use null to block advancing.
 */
export function numeralToNumber(text: string): number | null {
  const typed = text.match(/-?\d+(?:\.\d+)?/);
  if (typed) {
    const n = Number.parseFloat(typed[0]);
    return Number.isFinite(n) ? n : null;
  }
  for (const lang of ['ta', 'hi', 'en'] as const) {
    for (const hit of findNumerals(text, lang)) {
      if (Number.isFinite(hit.value)) return hit.value;
    }
  }
  return null;
}
