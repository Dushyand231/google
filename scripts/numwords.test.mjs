import { digitsFromWords, findNumerals } from '../src/lib/numwords';

let pass = 0;
let fail = 0;

function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${detail}`); }
}

function hits(text, lang) {
  return findNumerals(text, lang).map((h) => h.value);
}

console.log('\n=== Tamil numerals ===');
const TA = [
  // [phrase, expected, note]
  ['நூற்று ஒன்று', 101, 'composition 100+1'],
  ['நூற்று', 100, 'bare hundred'],
  ['நூறு', 100, 'alternate hundred'],
  ['ஒன்று', 1, 'one'],
  ['ஒன்று', 1, 'one (alternate spelling)'],
  ['இரண்டு', 2, 'two'],
  ['மூன்று', 3, 'three'],
  ['நான்கு', 4, 'four'],
  ['ஐந்து', 5, 'five'],
  ['ஆறு', 6, 'six'],
  ['ஏழு', 7, 'seven'],
  ['எட்டு', 8, 'eight'],
  ['ஒன்பது', 9, 'nine'],
  ['பத்து', 10, 'ten'],
  ['பதினொன்று', 11, 'eleven (irregular)'],
  ['பதமூன்று', 13, 'thirteen, split form'],
  ['பதினாலு', 14, 'fourteen (irregular)'],
  ['பதினைந்து', 15, 'fifteen (irregular)'],
  ['பதெட்டு', 18, 'eighteen (irregular, not 10+8)'],
  ['பத்தொன்பது', 19, 'nineteen'],
  ['இருபது', 20, 'twenty'],
  ['முப்பது', 30, 'thirty (irregular)'],
  ['நாற்பது', 40, 'forty (irregular)'],
  ['ஐம்பது', 50, 'fifty (irregular, NOT 40+10)'],
  ['அற்பது', 60, 'sixty (irregular, NOT 50+10)'],
  ['எழுபது', 70, 'seventy (irregular)'],
  ['எண்பது', 80, 'eighty (irregular)'],
  ['தொண்ணூறு', 90, 'ninety (highly irregular)'],
  ['நூற்று நாற்பது', 140, '100+40'],
  ['நூற்று தொண்ணூறு', 190, '100+90'],
  ['இருநூறு', 200, 'two hundred'],
  ['இருநூறு ஐம்பது', 250, 'two hundred fifty'],
  ['வெப்பநிலை நூற்றி ஒன்று புள்ளி இரண்டு', 101.2, 'decimal via புள்ளி'],
  ['எடை ஐந்து இருபது கிலோ', 25, 'quantity with unit after'],
  ['மூன்று', 3, 'duration unit'],
];

for (const [text, expected, note] of TA) {
  const got = hits(text, 'ta');
  const all = got.length === 1 ? got[0] : got;
  check(`ta ${JSON.stringify(text)} = ${expected} (${note})`, all === expected, `got ${JSON.stringify(got)}`);
}

console.log('\n=== Hindi numerals ===');
const HI = [
  ['एक', 1, 'one'],
  ['दो', 2, 'two'],
  ['तीन', 3, 'three'],
  ['चार', 4, 'four'],
  ['पांच', 5, 'five'],
  ['छह', 6, 'six'],
  ['सात', 7, 'seven'],
  ['आठ', 8, 'eight'],
  ['नौ', 9, 'nine'],
  ['दस', 10, 'ten'],
  ['ग्यारह', 11, 'eleven'],
  ['चौदह', 14, 'fourteen'],
  ['अठारह', 18, 'eighteen (irregular)'],
  ['उन्नीस', 19, 'nineteen (irregular)'],
  ['बीस', 20, 'twenty'],
  ['तीस', 30, 'thirty'],
  ['चालीस', 40, 'forty'],
  ['पचास', 50, 'fifty'],
  ['साठ', 60, 'sixty'],
  ['सत्तर', 70, 'seventy'],
  ['अस्सी', 80, 'eighty'],
  ['नब्बे', 90, 'ninety'],
  ['नबासे', 90, 'ninety (alternate)'],
  // These are thirty-something, not twenty-something: इक + तीस is "one thirty".
  // Twenty-one is इक्कीस. The old expectation here was simply wrong.
  ['इकतीस', 31, 'thirty-one (irregular)'],
  ['बत्तीस', 32, 'thirty-two (irregular)'],
  ['इक्कीस', 21, 'twenty-one (irregular)'],
  ['बाईस', 22, 'twenty-two (irregular)'],
  ['उनतीस', 29, 'twenty-nine (irregular)'],
  ['उनतालीस', 39, 'thirty-nine (irregular)'],
  ['उनचास', 49, 'forty-nine (irregular)'],
  ['उनसठ', 59, 'fifty-nine (irregular)'],
  ['उनहत्तर', 69, 'sixty-nine (irregular)'],
  ['उन्यासी', 79, 'seventy-nine (irregular)'],
  ['नवासी', 89, 'eighty-nine (irregular)'],
  ['निन्यानवे', 99, 'ninety-nine (irregular)'],
  ['सौ', 100, 'hundred'],
  ['एक सौ चालीस', 140, '100+40'],
  ['दो सौ चालीस', 240, '2x100 + 40'],
  ['चीनी दो सौ चालीस', 240, 'quantity with unit between'],
  ['बीपी एक सौ चालीस नब्बे', [140, 90], 'blood pressure: two separate numbers'],
  ['तापमान एक सौ एक पाअंश दो', 101.2, 'decimal via पाअंश'],
  ['वजन पचपन किलो', 55, 'quantity'],
  ['तीन', 3, 'duration unit'],
];

for (const [text, expected, note] of HI) {
  const got = hits(text, 'hi');
  const match = Array.isArray(expected)
    ? JSON.stringify(got) === JSON.stringify(expected)
    : got.length === 1 && got[0] === expected;
  check(`hi ${JSON.stringify(text)} = ${JSON.stringify(expected)} (${note})`, match, `got ${JSON.stringify(got)}`);
}

console.log('\n=== digit substitution ===');
const SUBS = [
  ['ta', 'வெப்பநிலை நூற்றி ஒன்று புள்ளி இரண்டு', 'வெப்பநிலை 101.2'],
  ['ta', 'மூன்று நாட்களாக இருமல்', '3 நாட்களாக இருமல்'],
  ['hi', 'तीन दिन से खाँसी', '3 दिन से खाँसी'],
  ['ta', 'வெப்பநிலை 101.2', 'வெப்பநிலை 101.2'],
  ['ta', 'காய்ச்சல் இருக்கு', 'காய்ச்சல் இருக்கு'],
];
for (const [lang, input, expected] of SUBS) {
  const got = digitsFromWords(input, lang);
  check(`sub ${lang} ${JSON.stringify(input)}`, got === expected, `got ${JSON.stringify(got)}`);
}

console.log('\n=== must NOT invent numbers ===');
const NEG = [
  ['ta', 'காய்ச்சல் இருக்கு'],
  ['hi', 'बुखार है'],
  ['ta', 'இருமல் தொடங்கியது'],
  ['hi', 'खाँसी शुरू'],
];
for (const [lang, input] of NEG) {
  const got = digitsFromWords(input, lang);
  check(`no false numeral ${lang} ${JSON.stringify(input)}`, got === input, `got ${JSON.stringify(got)}`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
