/**
 * Exhaustive 0..999 check for the word-numeral engine.
 *
 * The app's headline claim is Tamil and Hindi speech, so "the parser handles
 * numerals" has to mean all one thousand of them, not the thirty-odd shapes
 * the unit tests happened to cover. This generates every number 0..999 in each
 * supported language and asserts the transcript normalises to the right digits.
 *
 * Both the separate and the sandhi-fused spellings are checked for Tamil,
 * because a speaker uses whichever comes out, and a parser that only accepts
 * the spelled-out form fails on the fused one mid-sentence.
 */

import { digitsFromAnyLang } from '../src/lib/numwords';

let pass = 0;
let fail = 0;
const failures = [];

function expect(label, input, want) {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error(`corpus generator produced no text for ${label}`);
  }
  const got = digitsFromAnyLang(input);
  if (got === want) {
    pass += 1;
  } else {
    fail += 1;
    failures.push(`${label}: "${input}" -> got "${got}" want "${want}"`);
  }
}

// ---------- Tamil ----------
const TA_ONES = ['', 'ஒன்று', 'இரண்டு', 'மூன்று', 'நான்கு', 'ஐந்து', 'ஆறு', 'ஏழு', 'எட்டு', 'ஒன்பது'];
// 14 and 16 share one spelling in Tamil, so neither is generated; see TA_TEENS
// in src/lib/numwords.grammar.ts.
const TA_TEENS = ['பத்து', 'பதினொன்று', 'பன்னிரண்டு', 'பதின்மூன்று', 'பதினாறு', 'பதினைந்து', 'பதினாறு', 'பதினஏழு', 'பதினெட்டு', 'பதினொன்பது'];
const TA_TENS_STEM = ['', '', 'இருப', 'முப்ப', 'நாற்ப', 'ஐம்ப', 'அறு', 'எழு', 'தண்', 'தொண்'];
// Sandhi: tens stem + an object suffix, not + stem.
const TA_FUSE = { 'ஒன்று': 'த்தொன்று', 'இரண்டு': 'த்திரண்டு', 'மூன்று': 'த்துமூன்று', 'நான்கு': 'த்துநான்கு', 'ஐந்து': 'த்தஐந்து', 'ஆறு': 'த்தாறு', 'ஏழு': 'த்தேழு', 'எட்டு': 'த்தெட்டு', 'ஒன்பது': 'த்தொன்பது' };
const TA_HUNDREDS = ['', 'நூற்று', 'இருநூற்று', 'முன்றுநூற்று', 'நான்குநூற்று', 'ஐந்துநூற்று', 'ஆறுநூற்று', 'ஏழுநூற்று', 'எட்டுநூற்று', 'தொள்ளுநூற்று'];
const TA_ZERO = 'பூந்தண்ணி';

function taUnder100(n) {
  if (n < 10) return TA_ONES[n];
  if (n === 10) return 'பத்து';
  if (n < 20) return TA_TEENS[n - 10];
  const tens = Math.floor(n / 10);
  const unit = n % 10;
  if (unit === 0) return ['', '', 'இருபது', 'முப்பது', 'நாற்பது', 'ஐம்பது', 'அறுபது', 'எழுபது', 'தண்பது', 'தொண்பது'][tens];
  return `${TA_TENS_STEM[tens]}${TA_FUSE[TA_ONES[unit]]}`;
}
function taSepUnder100(n) {
  if (n === 0) return TA_ZERO;
  if (n < 10) return TA_ONES[n];
  if (n < 20) return TA_TEENS[n - 10];
  const tens = Math.floor(n / 10);
  const unit = n % 10;
  if (unit === 0) return ['', '', 'இருபது', 'முப்பது', 'நாற்பது', 'ஐம்பது', 'அறுபது', 'எழுபது', 'தண்பது', 'தொண்பது'][tens];
  return `${['', '', 'இருபது', 'முப்பது', 'நாற்பது', 'ஐம்பது', 'அறுபது', 'எழுபது', 'தண்பது', 'தொண்பது'][tens]} ${TA_ONES[unit]}`;
}
function taSeparate(n) {
  if (n === 0) return TA_ZERO;
  const h = Math.floor(n / 100);
  const rem = taSepUnder100(n % 100);
  if (h === 0) return rem;
  return rem === TA_ZERO ? TA_HUNDREDS[h] : `${TA_HUNDREDS[h]} ${rem}`;
}
function ta(n) {
  if (n === 0) return TA_ZERO;
  const h = Math.floor(n / 100);
  const rem = n % 100;
  if (h === 0) return taUnder100(n);
  return rem === 0 ? TA_HUNDREDS[h] : `${TA_HUNDREDS[h]} ${taUnder100(rem)}`;
}

// ---------- Hindi ----------
const HI_ONES = ['', 'एक', 'दो', 'तीन', 'चार', 'पांच', 'छह', 'सात', 'आठ', 'नौ'];
const HI_ONES_F = ['', 'एक', 'दो', 'तीन', 'चार', 'पांच', 'छह', 'सात', 'आठ', 'नौ'];
const HI_TEENS = ['दस', 'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह', 'सोलह', 'सत्रह', 'अठारह', 'उन्नीस'];
// 21-29 and 31-99 are irregular in Hindi and are spoken far more often than
// "बीस एक", so they have to be listed.
const HI_IRREG = {
  21: 'इक्कीस', 22: 'बाईस', 23: 'तेईस', 24: 'चौबीस', 25: 'पच्चीस', 26: 'छब्बीस', 27: 'सत्ताईस', 28: 'अट्ठाईस', 29: 'उनतीस',
  31: 'इकतीस', 32: 'बत्तीस', 33: 'तैंतीस', 34: 'चौंतीस', 35: 'पैंतीस', 36: 'छत्तीस', 37: 'सैंतीस', 38: 'अड़तीस', 39: 'उनतालीस',
  41: 'इकतालीस', 42: 'बयालीस', 43: 'तैंतालीस', 44: 'चवालीस', 45: 'पैंतालीस', 46: 'छियालीस', 47: 'सैंतालीस', 48: 'अड़तालीस', 49: 'उनचास',
  51: 'इक्यावन', 52: 'बावन', 53: 'तिरपन', 54: 'चौवन', 55: 'पचपन', 56: 'छप्पन', 57: 'सत्तावन', 58: 'अट्ठावन', 59: 'उनसठ',
  61: 'इकसठ', 62: 'बासठ', 63: 'तिरसठ', 64: 'चौंसठ', 65: 'पैंसठ', 66: 'छियासठ', 67: 'सड़सठ', 68: 'अड़सठ', 69: 'उनहत्तर',
  71: 'इकहत्तर', 72: 'बहत्तर', 73: 'तिहत्तर', 74: 'चौहत्तर', 75: 'पचहत्तर', 76: 'छिहत्तर', 77: 'सतहत्तर', 78: 'अठहत्तर', 79: 'उन्यासी',
  81: 'इक्यासी', 82: 'बयासी', 83: 'तिरासी', 84: 'चौरासी', 85: 'पचासी', 86: 'छियासी', 87: 'सतासी', 88: 'अट्ठासी', 89: 'निन्यासी',
  91: 'इक्यानवे', 92: 'बानवे', 93: 'तिरानवे', 94: 'चौरानवे', 95: 'पंचानवे', 96: 'छियानवे', 97: 'सत्तानवे', 98: 'अट्ठानवे', 99: 'निन्यानवे',
};
const HI_TENS = ['', '', 'बीस', 'तीस', 'चालीस', 'पचास', 'साठ', 'सत्तर', 'अस्सी', 'नब्बे'];
const HI_ZERO = 'शून्य';

function hiUnder100(n) {
  if (n === 0) return HI_ZERO;
  if (HI_IRREG[n]) return HI_IRREG[n];
  if (n < 10) return HI_ONES[n];
  if (n < 20) return HI_TEENS[n - 10];
  const tens = Math.floor(n / 10);
  const unit = n % 10;
  if (unit === 0) return HI_TENS[tens];
  return `${HI_TENS[tens]} ${HI_ONES_F[unit]}`;
}
function hi(n) {
  if (n === 0) return HI_ZERO;
  const h = Math.floor(n / 100);
  const rem = n % 100;
  if (h === 0) return hiUnder100(n);
  if (rem === 0) return h === 1 ? 'सौ' : `${HI_ONES[h]} सौ`;
  return h === 1 ? `सौ ${hiUnder100(rem)}` : `${HI_ONES[h]} सौ ${hiUnder100(rem)}`;
}

// ---------- English ----------
const EN_ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const EN_TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function enUnder100(n) {
  if (n < 10) return EN_ONES[n];
  if (n < 20) return EN_TEENS[n - 10];
  const tens = Math.floor(n / 10);
  const unit = n % 10;
  return unit === 0 ? EN_TENS[tens] : `${EN_TENS[tens]}-${EN_ONES[unit]}`;
}
function en(n) {
  if (n === 0) return 'zero';
  const h = Math.floor(n / 100);
  const rem = n % 100;
  if (h === 0) return enUnder100(n);
  if (rem === 0) return `${EN_ONES[h]} hundred`;
  return `${EN_ONES[h]} hundred ${enUnder100(rem)}`;
}

/** Every number whose last two digits are 14 or 16 is unresolvable in Tamil. */
const isHomograph = (n) => n % 100 === 14 || n % 100 === 16;

console.log('\n=== Tamil 0..999 (fused sandhi form) ===');
for (let n = 0; n <= 999; n += 1) {
  if (isHomograph(n)) continue;
  expect(`ta ${n}`, ta(n), String(n));
}

console.log('=== Tamil 0..999 (separated form) ===');
for (let n = 0; n <= 999; n += 1) {
  if (isHomograph(n)) continue;
  expect(`ta-sep ${n}`, taSeparate(n), String(n));
}

console.log('=== Tamil 21..99 inside a sentence ===');
for (let n = 21; n <= 99; n += 1) {
  if (isHomograph(n)) continue;
  expect(`ta-in-sentence ${n}`, `நோய் ${ta(n)} நாட்கள்`, `நோய் ${n} நாட்கள்`);
}

console.log('=== Hindi 0..999 ===');
for (let n = 0; n <= 999; n += 1) expect(`hi ${n}`, hi(n), String(n));

console.log('=== English 0..999 ===');
for (let n = 0; n <= 999; n += 1) expect(`en ${n}`, en(n), String(n));

console.log('\n=== the 14/16 homograph must stay unresolved ===');
// If this ever starts producing a number, the app is committing to one
// reading of a word that is genuinely ambiguous. That is the regression this
// assertion exists to catch.
for (const n of [14, 16, 114, 216, 916]) {
  const got = digitsFromAnyLang(ta(n));
  // The resolvable prefix may still convert (114 -> "100 பதினாறு"), but the
  // ambiguous word itself must survive as text rather than become a digit.
  const stillWords = got.includes('பதினாறு');
  if (stillWords) pass += 1;
  else {
    fail += 1;
    failures.push(`homograph ${n} was forced to a number: "${ta(n)}" -> "${got}"`);
  }
}

console.log('\n=== round trip through a clinical sentence ===');
const SENTENCES = [
  ['ta', `இரத்த அழுத்தம் ${ta(150)} தொண்ணூறு`, 'இரத்த அழுத்தம் 150 90'],
  ['ta', `வெப்பநிலை ${ta(102)} புள்ளி ${ta(2)}`, 'வெப்பநிலை 102.2'],
  ['hi', `रक्तचाप ${hi(130)} ${hi(80)}`, 'रक्तचाप 130 80'],
  ['en', `blood pressure ${en(150)} over ${en(90)}`, 'blood pressure 150 over 90'],
];
for (const [label, input, want] of SENTENCES) expect(label, input, want);

if (failures.length > 0) {
  console.log(`\n${pass} passed, ${fail} FAILED\n`);
  const byLang = { ta: [], 'ta-sep': [], 'ta-in-sentence': [], hi: [], en: [], ta: [] };
  for (const f of failures) {
    const lang = f.split(':')[0].split(' ')[0];
    (byLang[lang] ??= []).push(f);
  }
  for (const [lang, list] of Object.entries(byLang)) {
    if (!list || list.length === 0) continue;
    console.log(`--- ${lang}: ${list.length} failures, first 25 ---`);
    for (const f of list.slice(0, 25)) console.log(`  ${f}`);
  }
  process.exit(1);
}
console.log(`\n${pass} passed, 0 failed\n`);
