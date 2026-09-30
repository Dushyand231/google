import { parseVitals, toObservationInputs, assessFlags, SAMPLE_TRANSCRIPTS } from '../src/lib/parseVitals';

let pass = 0;
let fail = 0;

function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${detail}`); }
}

const find = (r, k) => r.vitals.find((v) => v.kind === k);

console.log('\n=== multilingual extraction ===');
for (const s of SAMPLE_TRANSCRIPTS) {
  const r = parseVitals(s.text);
  const bp = find(r, 'bloodPressure');
  const g = find(r, 'glucose');
  const w = find(r, 'weight');
  const t = find(r, 'temperature');
  console.log(`\n[${s.lang}] "${s.text}"`);
  console.log(`   vitals: ${r.vitals.length}  bp=${bp ? bp.value + '/' + bp.secondaryValue : '-'} glucose=${g ? g.value : '-'} weight=${w ? w.value : '-'} temp=${t ? t.value : '-'}`);
  check(`${s.lang} finds bp`, bp != null, JSON.stringify(r));
  check(`${s.lang} bp parses 2 numbers`, bp && typeof bp.value === 'number' && typeof bp.secondaryValue === 'number', JSON.stringify(bp));
}

console.log('\n=== specific assertions ===');
let r = parseVitals('BP 150 over 100, sugar 240, weight 54, temp 101.4');
check('english hyphen BP', find(r, 'bloodPressure')?.value === 150 && find(r, 'bloodPressure')?.secondaryValue === 100, JSON.stringify(find(r, 'bloodPressure')));
check('english glucose 240', find(r, 'glucose')?.value === 240, JSON.stringify(find(r, 'glucose')));
check('english weight 54', find(r, 'weight')?.value === 54, JSON.stringify(find(r, 'weight')));
check('english temp 101.4', find(r, 'temperature')?.value === 101.4, JSON.stringify(find(r, 'temperature')));

r = parseVitals('இரத்த அழுத்தம் 130 ஓர் 90, சர்க்கரை 120, எடை 52 கிலோ');
check('tamil BP 130/90', find(r, 'bloodPressure')?.value === 130 && find(r, 'bloodPressure')?.secondaryValue === 90, JSON.stringify(find(r, 'bloodPressure')));
check('tamil sugar 120', find(r, 'glucose')?.value === 120, JSON.stringify(find(r, 'glucose')));
check('tamil weight 52', find(r, 'weight')?.value === 52, JSON.stringify(find(r, 'weight')));

r = parseVitals('130/90 120 52');
check('ASR-degraded still gets bp', find(r, 'bloodPressure') != null, JSON.stringify(r));
check('ASR-degraded bp is medium conf', find(r, 'bloodPressure')?.confidence === 'medium', find(r, 'bloodPressure')?.confidence);

r = parseVitals('130/90');
check('bare 130/90 has no keyword -> medium', find(r, 'bloodPressure')?.confidence === 'medium', find(r, 'bloodPressure')?.confidence);
r = parseVitals('BP 130/90');
check('BP keyword -> high confidence', find(r, 'bloodPressure')?.confidence === 'high', find(r, 'bloodPressure')?.confidence);

r = parseVitals('ಸಕ್ಕರೆ 95');
check('glucose floor 95 accepted', find(r, 'glucose')?.value === 95, JSON.stringify(find(r, 'glucose')));
r = parseVitals('ಸಕ್ಕರೆ 39');
check('glucose below 40 rejected', find(r, 'glucose') == null, JSON.stringify(find(r, 'glucose')));
r = parseVitals('BP 999/40');
check('implausible BP 999/40 rejected', find(r, 'bloodPressure') == null, JSON.stringify(find(r, 'bloodPressure')));

console.log('\n=== regression: proximity binding (the swap bug) ===');
r = parseVitals('sugar 120, weight 52');
check('english: 120->glucose', find(r, 'glucose')?.value === 120, JSON.stringify(find(r, 'glucose')));
check('english: 52->weight', find(r, 'weight')?.value === 52, JSON.stringify(find(r, 'weight')));
r = parseVitals('எடை 52 கிலோ, சர்க்கரை 120');
check('tamil: 52->weight', find(r, 'weight')?.value === 52, JSON.stringify(find(r, 'weight')));
check('tamil: 120->glucose', find(r, 'glucose')?.value === 120, JSON.stringify(find(r, 'glucose')));
r = parseVitals('வெப்பநிலை 101.4');
check('tamil temp 101.4 decimal survives', find(r, 'temperature')?.value === 101.4, JSON.stringify(find(r, 'temperature')));

console.log('\n=== FHIR conversion ===');
r = parseVitals('BP 130/90, sugar 120, weight 52');
const obs = toObservationInputs(r);
console.log('  ' + obs.map((o) => `${o.loinc}=${o.value}${o.unit}`).join('\n  '));
check('BP yields 2 components (systolic+diastolic)', obs.length === 4, `got ${obs.length}`);
check('LOINC systolic 8480-6 present', obs.some((o) => o.loinc === '8480-6'), 'missing');
check('LOINC diastolic 8462-4 present', obs.some((o) => o.loinc === '8462-4'), 'missing');
check('LOINC glucose 2339-0 present', obs.some((o) => o.loinc === '2339-0'), 'missing');
check('LOINC weight 29463-7 present', obs.some((o) => o.loinc === '29463-7'), 'missing');

console.log('\n=== triage flags ===');
const f1 = assessFlags(parseVitals('BP 170/105'));
console.log('  170/105 -> ' + f1.map((f) => `${f.label} [${f.severity}]`).join(', '));
check('severe HTN flagged high', f1.some((f) => f.severity === 'high'), JSON.stringify(f1));
const f2 = assessFlags(parseVitals('BP 130/90'));
console.log('  130/90 -> ' + f2.map((f) => `${f.label} [${f.severity}]`).join(', '));
check('130/90 = Stage 1 HTN per ACC/AHA', f2.length === 1 && f2[0].severity === 'medium' && /Elevated/.test(f2[0].label), JSON.stringify(f2));
const f2b = assessFlags(parseVitals('BP 118/76'));
console.log('  118/76 -> ' + f2b.map((f) => `${f.label} [${f.severity}]`).join(', '));
check('118/76 = normal', f2b.length === 1 && f2b[0].severity === 'info', JSON.stringify(f2b));
const f3 = assessFlags(parseVitals('BP 130/90, sugar 250'));
check('sugar 250 flagged high', f3.some((f) => f.severity === 'high' && /sugar/i.test(f.label)), JSON.stringify(f3));

console.log(`\n================ ${pass} passed, ${fail} failed ================\n`);
process.exit(fail > 0 ? 1 : 0);
