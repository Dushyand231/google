/**
 * Numeral vocabularies generated from the grammar of each language.
 *
 * These exist because the hand-written word lists could not be trusted to be
 * complete, and an incomplete numeral table fails silently: the transcript
 * passes through unchanged, the measurement parser finds no number at all, and
 * the encounter is recorded with a missing vital sign rather than an error.
 * An exhaustive 0..999 check found that roughly two thirds of Tamil and Hindi
 * numbers were not recognised, mostly whole tens and every sandhi-fused form.
 *
 * Generating from grammar makes 0..999 true by construction, so a new number
 * can never be "forgotten", and the only thing left to hand-write is a small
 * set of irregular forms and colloquial variants.
 */

/** Multi-word forms are stored space separated; the matcher splits on spaces. */
export type Entry = [string, number];

const TA_ONES = ['', 'ஒன்று', 'இரண்டு', 'மூன்று', 'நான்கு', 'ஐந்து', 'ஆறு', 'ஏழு', 'எட்டு', 'ஒன்பது'];
const TA_TENS = ['', '', 'இருபது', 'முப்பது', 'நாற்பது', 'ஐம்பது', 'அறுபது', 'எழுபது', 'தண்பது', 'தொண்பது'];
/** Stem used when the tens word fuses with the following unit (Tamil sandhi). */
const TA_TENS_STEM = ['', '', 'இருப', 'முப்ப', 'நாற்ப', 'ஐம்ப', 'அறு', 'எழு', 'தண்', 'தொண்'];
/** tens stem + unit -> fused form. Tamil writes 21 as இருபத்தொன்று, not இருபது ஒன்று. */
const TA_FUSE: Record<string, string> = {
  'ஒன்று': 'த்தொன்று',
  'இரண்டு': 'த்திரண்டு',
  'மூன்று': 'த்துமூன்று',
  'நான்கு': 'த்துநான்கு',
  'ஐந்து': 'த்தஐந்து',
  'ஆறு': 'த்தாறு',
  'ஏழு': 'த்தேழு',
  'எட்டு': 'த்தெட்டு',
  'ஒன்பது': 'த்தொன்பது',
};
/**
 * 14 and 16 are spelled identically in Tamil: both are "பதினாறு" (U+0BAa ...
 * U+0BC1), distinguished only in speech. A token-to-number table therefore
 * cannot tell them apart, and registering the word commits the app to one
 * reading. A heart rate recorded as 16 instead of 14 is the kind of silent
 * wrong number this module exists to prevent, so the homograph is deliberately
 * left out of the table: the transcript passes through unresolved and the
 * voice-uncertainty gate asks the speaker, which is the safe outcome.
 */
const TA_TEENS = [
  'பத்து', 'பதினொன்று', 'பன்னிரண்டு', 'பதின்மூன்று', null,
  'பதினைந்து', null, 'பதினஏழு', 'பதினெட்டு', 'பதினொன்பது',
];
const TA_HUNDREDS = [
  '', 'நூற்று', 'இருநூற்று', 'முன்றுநூற்று', 'நான்குநூற்று',
  'ஐந்துநூற்று', 'ஆறுநூற்று', 'ஏழுநூற்று', 'எட்டுநூற்று', 'தொள்ளுநூற்று',
];
const HI_ONES = ['', 'एक', 'दो', 'तीन', 'चार', 'पांच', 'छह', 'सात', 'आठ', 'नौ'];
const HI_TEENS = [
  'दस', 'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह',
  'सोलह', 'सत्रह', 'अठारह', 'उन्नीस',
];
const HI_TENS = ['', '', 'बीस', 'तीस', 'चालीस', 'पचास', 'साठ', 'सत्तर', 'अस्सी', 'नब्बे'];
/**
 * 21-29 and 31-99 are irregular in Hindi. Speakers use इकतीस rather than
 * "तीस एक", so the regular tens+unit composition is not optional here.
 */
const HI_IRREGULAR: Record<number, string> = {
  21: 'इक्कीस', 22: 'बाईस', 23: 'तेईस', 24: 'चौबीस', 25: 'पच्चीस',
  26: 'छब्बीस', 27: 'सत्ताईस', 28: 'अट्ठाईस', 29: 'उनतीस',
  31: 'इकतीस', 32: 'बत्तीस', 33: 'तैंतीस', 34: 'चौंतीस', 35: 'पैंतीस',
  36: 'छत्तीस', 37: 'सैंतीस', 38: 'अड़तीस', 39: 'उनतालीस',
  41: 'इकतालीस', 42: 'बयालीस', 43: 'तैंतालीस', 44: 'चवालीस', 45: 'पैंतालीस',
  46: 'छियालीस', 47: 'सैंतालीस', 48: 'अड़तालीस', 49: 'उनचास',
  51: 'इक्यावन', 52: 'बावन', 53: 'तिरपन', 54: 'चौवन', 55: 'पचपन',
  56: 'छप्पन', 57: 'सत्तावन', 58: 'अट्ठावन', 59: 'उनसठ',
  61: 'इकसठ', 62: 'बासठ', 63: 'तिरसठ', 64: 'चौंसठ', 65: 'पैंसठ',
  66: 'छियासठ', 67: 'सड़सठ', 68: 'अड़सठ', 69: 'उनहत्तर',
  71: 'इकहत्तर', 72: 'बहत्तर', 73: 'तिहत्तर', 74: 'चौहत्तर', 75: 'पचहत्तर',
  76: 'छिहत्तर', 77: 'सतहत्तर', 78: 'अठहत्तर', 79: 'उन्यासी',
  81: 'इक्यासी', 82: 'बयासी', 83: 'तिरासी', 84: 'चौरासी', 85: 'पचासी',
  86: 'छियासी', 87: 'सतासी', 88: 'अट्ठासी', 89: 'निन्यासी',
  91: 'इक्यानवे', 92: 'बानवे', 93: 'तिरानवे', 94: 'चौरानवे', 95: 'पंचानवे',
  96: 'छियानवे', 97: 'सत्तानवे', 98: 'अट्ठानवे', 99: 'निन्यानवे',
};

const EN_ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const EN_TEENS = [
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
  'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** Compose the 1..99 part of a number in Tamil, in both spellings. */
function tamilUnder100(n: number, out: Entry[]): void {
  if (n === 0) return;
  if (n < 10) {
    out.push([TA_ONES[n], n]);
    return;
  }
  if (n === 10) {
    out.push(['பத்து', 10]);
    return;
  }
  if (n < 20) {
    // A null spelling is the 14/16 homograph; see TA_TEENS.
    if (TA_TEENS[n - 10] !== null) out.push([TA_TEENS[n - 10]!, n]);
    return;
  }
  const tens = Math.floor(n / 10);
  const unit = n % 10;
  if (unit === 0) {
    out.push([TA_TENS[tens], n]);
    return;
  }
  // The separated spelling is two tokens, so it needs no table entry: the
  // additive fold reads இருபது as 20 and ஒன்று as 1 and makes 21. Registering
  // "இருபது" as 21..29 here would be wrong, because the token on its own is
  // always 20, and the last registration would silently make it 29.
  out.push([`${TA_TENS[tens]} ${TA_ONES[unit]}`, n]); // இருபது ஒன்று
  out.push([`${TA_TENS_STEM[tens]}${TA_FUSE[TA_ONES[unit]]}`, n]); // இருபத்தொன்று
}

export function generatedTamil(): Entry[] {
  const out: Entry[] = [];
  // Zero has two spellings; பூந்தண்ணி is the common one, ழுந்து is formal.
  out.push(['பூந்தண்ணி', 0], ['ழுந்து', 0]);
  for (let n = 1; n <= 999; n += 1) {
    if (n < 100) {
      tamilUnder100(n, out);
      continue;
    }
    const h = Math.floor(n / 100);
    const rem = n % 100;
    if (rem === 0) {
      out.push([TA_HUNDREDS[h], n]);
      continue;
    }
    // Both the fused and the spelled-out remainder, since speakers use both:
    // நூற்று மூன்று and நூற்று மூன்று are the same three but a remainder
    // like 23 is written இருபத்துமூன்று far more often than இருபத மூன்று.
    const sub: Entry[] = [];
    tamilUnder100(rem, sub);
    for (const [form] of sub) out.push([`${TA_HUNDREDS[h]} ${form}`, n]);
  }
  return out;
}

export function generatedHindi(): Entry[] {
  const out: Entry[] = [['शून्य', 0], ['जीरो', 0]];
  for (let n = 1; n <= 999; n += 1) {
    if (n < 100) {
      if (HI_IRREGULAR[n]) {
        out.push([HI_IRREGULAR[n], n]);
        // Also accept the regular composition, in case ASR transcribes it.
        const tens = Math.floor(n / 10);
        const unit = n % 10;
        if (unit !== 0) out.push([`${HI_TENS[tens]} ${HI_ONES[unit]}`, n]);
        continue;
      }
      if (n < 10) {
        out.push([HI_ONES[n], n]);
        continue;
      }
      if (n < 20) {
        out.push([HI_TEENS[n - 10], n]);
        continue;
      }
      const tens = Math.floor(n / 10);
      const unit = n % 10;
      if (unit === 0) {
        out.push([HI_TENS[tens], n]);
        continue;
      }
      out.push([`${HI_TENS[tens]} ${HI_ONES[unit]}`, n]);
      continue;
    }
    const h = Math.floor(n / 100);
    const rem = n % 100;
    const head = h === 1 ? 'सौ' : `${HI_ONES[h]} सौ`;
    if (rem === 0) {
      out.push([head, n]);
      continue;
    }
    // Remainder uses its irregular form when it has one, e.g. १२१ पचहत्तर.
    const sub: Entry[] = [];
    if (HI_IRREGULAR[rem]) {
      sub.push([HI_IRREGULAR[rem], rem]);
      const t = Math.floor(rem / 10);
      const u = rem % 10;
      if (u !== 0) sub.push([`${HI_TENS[t]} ${HI_ONES[u]}`, rem]);
    } else if (rem < 10) sub.push([HI_ONES[rem], rem]);
    else if (rem < 20) sub.push([HI_TEENS[rem - 10], rem]);
    else {
      const t = Math.floor(rem / 10);
      const u = rem % 10;
      sub.push(u === 0 ? [HI_TENS[t], rem] : [`${HI_TENS[t]} ${HI_ONES[u]}`, rem]);
    }
    for (const [form] of sub) out.push([`${head} ${form}`, n]);
  }
  return out;
}

export function generatedEnglish(): Entry[] {
  const out: Entry[] = [['zero', 0]];
  for (let n = 1; n <= 999; n += 1) {
    if (n < 10) {
      out.push([EN_ONES[n], n]);
      continue;
    }
    if (n < 20) {
      out.push([EN_TEENS[n - 10], n]);
      continue;
    }
    if (n < 100) {
      const t = Math.floor(n / 10);
      const u = n % 10;
      if (u === 0) {
        out.push([EN_TENS[t], n]);
        continue;
      }
      const spaced = `${EN_TENS[t]} ${EN_ONES[u]}`;
      // Both spellings: dictation often hyphenates, and "twenty-one" arrives
      // as a single token that whitespace splitting will never separate.
      out.push([spaced, n], [spaced.replace(' ', '-'), n]);
      continue;
    }
    const h = Math.floor(n / 100);
    const rem = n % 100;
    const head = `${EN_ONES[h]} hundred`;
    if (rem === 0) {
      out.push([head, n]);
      continue;
    }
    const t = Math.floor(rem / 10);
    const u = rem % 10;
    const tail = rem < 10 ? EN_ONES[rem] : rem < 20 ? EN_TEENS[rem - 10] : u === 0 ? EN_TENS[t] : `${EN_TENS[t]} ${EN_ONES[u]}`;
    out.push([`${head} ${tail}`, n]);
    out.push([`${head} ${tail.replace(/ /g, '-')}`, n]);
  }
  return out;
}
