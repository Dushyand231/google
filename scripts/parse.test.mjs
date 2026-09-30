import { parseVitals, toObservationInputs, assessFlags, SAMPLE_TRANSCRIPTS } from '../src/lib/parse';

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

console.log('\n=== word-form numerals end to end ===');
import { parseEncounter, SYMPTOM_SAMPLES } from '../src/lib/parse';

{
  const r = parseEncounter('இரத்த அழுத்தம் நூற்று நாற்பது தொண்ணூறு, சர்க்கரை நூற்று இருபது, எடை ஐம்பது இரண்டு கிலோ');
  const bp = r.vitals.find((v) => v.kind === 'bloodPressure');
  check('ta words bp 140/90', bp?.value === 140 && bp?.secondaryValue === 90, JSON.stringify(bp));
  check('ta words glucose 120', r.vitals.find((v) => v.kind === 'glucose')?.value === 120, JSON.stringify(r.vitals));
  check('ta words weight 52', r.vitals.find((v) => v.kind === 'weight')?.value === 52, JSON.stringify(r.vitals));
  // Weight and BP state their scale ("கிலோ", and BP is mmHg by the reading
  // form), so only the bare "sugar 120" is unit-inferred. The previous
  // assertion of zero uncertainties was not achievable honestly: nothing in
  // the sentence says mg/dL.
  const inferred = r.uncertainties.filter((u) => u.reason === 'unit_inferred').map((u) => u.field);
  check('ta words only glucose unit inferred', JSON.stringify(inferred) === JSON.stringify(['glucose']), JSON.stringify(r.uncertainties));
  check('ta weight is high confidence', r.vitals.find((v) => v.kind === 'weight')?.confidence === 'high', JSON.stringify(r.vitals));
  check('ta glucose is medium confidence', r.vitals.find((v) => v.kind === 'glucose')?.confidence === 'medium', JSON.stringify(r.vitals));
}

{
  const r = parseEncounter('வெப்பநிலை நூற்றி ஒன்று புள்ளி இரண்டு, மூன்று நாட்களாக இருமல்');
  check('ta decimal temp 101.2', r.vitals.find((v) => v.kind === 'temperature')?.value === 101.2, JSON.stringify(r.vitals));
  const cough = r.symptoms.find((s) => s.code === 'cough');
  check('ta duration 3 days', cough?.durationValue === 3 && cough?.durationUnit === 'days', JSON.stringify(cough));
  check('ta decimal does not eat next clause', r.symptoms.length === 1, JSON.stringify(r.symptoms));
}

{
  const r = parseEncounter('बीपी एक सौ चालीस नब्बे, चीनी दो सौ चालीस, तापमान एक सौ एक पाअंश दो');
  const bp = r.vitals.find((v) => v.kind === 'bloodPressure');
  check('hi words bp 140/90', bp?.value === 140 && bp?.secondaryValue === 90, JSON.stringify(bp));
  check('hi words glucose 240', r.vitals.find((v) => v.kind === 'glucose')?.value === 240, JSON.stringify(r.vitals));
  check('hi words temp 101.2', r.vitals.find((v) => v.kind === 'temperature')?.value === 101.2, JSON.stringify(r.vitals));
}

console.log('\n=== symptoms, durations, negation ===');
for (const s of SYMPTOM_SAMPLES) {
  const r = parseEncounter(s.text);
  console.log(`  [${s.lang}] ${s.label}: vitals=${r.vitals.length} symptoms=${r.symptoms.map((x) => x.code).join(',') || 'none'}`);
}

{
  const r = parseEncounter('तीन दिन से खाँसी, बुखार नहीं');
  const cough = r.symptoms.find((s) => s.code === 'cough');
  const fever = r.symptoms.find((s) => s.code === 'fever');
  check('hi cough 3 days', cough?.durationValue === 3 && cough?.durationUnit === 'days', JSON.stringify(cough));
  check('hi fever is negated', fever?.negative === true, JSON.stringify(fever));
  check('negated fever has no duration', fever?.durationValue === undefined, JSON.stringify(fever));
  check('negation is not an uncertainty', r.uncertainties.length === 0, JSON.stringify(r.uncertainties));
}

{
  const r = parseEncounter('temp 103.2, no cough, no vomiting');
  check('en cough negated', r.symptoms.find((s) => s.code === 'cough')?.negative === true, JSON.stringify(r.symptoms));
  check('en vomiting negated', r.symptoms.find((s) => s.code === 'vomiting')?.negative === true, JSON.stringify(r.symptoms));
  check('en negation yields no phantom symptom', r.symptoms.length === 2, JSON.stringify(r.symptoms));
  check('en no leak of temperature into duration', r.symptoms.every((s) => s.durationValue === undefined), JSON.stringify(r.symptoms));
}

{
  const r = parseEncounter('இருமல் இரண்டு வாரங்களாக');
  const cough = r.symptoms.find((s) => s.code === 'cough');
  check('ta inflected weeks 2', cough?.durationValue === 2 && cough?.durationUnit === 'weeks', JSON.stringify(cough));
}

{
  const r = parseEncounter('நேற்று முதல் காய்ச்சல்');
  const fever = r.symptoms.find((s) => s.code === 'fever');
  check('ta relative since yesterday', fever?.durationValue === 1 && fever?.durationUnit === 'days', JSON.stringify(fever));
}

console.log('\n=== uncertainty gate ===');
{
  const r = parseEncounter('130/90 120 52');
  check('keywordless bp is medium confidence', r.vitals.find((v) => v.kind === 'bloodPressure')?.confidence === 'medium', JSON.stringify(r.vitals));
  check('unbound numbers reported', r.uncertainties.some((u) => u.reason === 'unbound_number'), JSON.stringify(r.uncertainties));
  check('ambiguous binding reported', r.uncertainties.some((u) => u.reason === 'ambiguous_binding'), JSON.stringify(r.uncertainties));
}

{
  const r = parseEncounter('temp 45');
  check('implausible temp rejected not stored', r.vitals.find((v) => v.kind === 'temperature') === undefined, JSON.stringify(r.vitals));
  check('implausible temp surfaces as uncertainty', r.uncertainties.some((u) => u.reason === 'out_of_range'), JSON.stringify(r.uncertainties));
}

{
  const r = parseEncounter('இருமல்', { asrConfidence: 0.4 });
  check('low asr confidence raises gate', r.uncertainties.some((u) => u.reason === 'asr_low_confidence'), JSON.stringify(r.uncertainties));
  check('low asr confidence still parses', r.symptoms.length === 1, JSON.stringify(r.symptoms));
}

{
  const r = parseEncounter('இருமல்');
  check('missing duration raises gate', r.uncertainties.some((u) => u.reason === 'no_duration'), JSON.stringify(r.uncertainties));
}

console.log('\n=== never invent ===');
{
  for (const t of ['காய்ச்சல் இருக்கு', 'बुखार है', 'patient looks fine', '']) {
    const r = parseEncounter(t);
    check(`no vitals invented for ${JSON.stringify(t)}`, r.vitals.length === 0, JSON.stringify(r.vitals));
  }
}

console.log('\n=== triage ===');
{
  const r = parseEncounter('bp 180/110');
  check('severe bp is high severity', r.flags.some((f) => f.severity === 'high'), JSON.stringify(r.flags));
  const ok = parseEncounter('bp 120/80, weight 60, temp 98.6');
  check('normal readings are info only', ok.flags.length === 1 && ok.flags[0].severity === 'info', JSON.stringify(ok.flags));
  const br = parseEncounter('breathlessness');
  check('breathlessness is high severity', br.flags.some((f) => f.severity === 'high'), JSON.stringify(br.flags));
}


console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

// Regressions found by scripts/contract.test.mjs, which runs the real client
// payload builders through the real server sync engine.
{
  console.log('\n=== regressions: English durations ===');
  for (const [input, want] of [
    ['fever three days', 3],
    ['fever for two days', 2],
    ['fever since five days', 5],
    ['cough ten days', 10],
    ['headache twenty one days', 21],
  ]) {
    const r = parseEncounter(input, { lang: 'en' });
    const got = r.symptoms[0]?.durationValue;
    check(`en duration "${input}" -> ${want}`, got === want, `got ${JSON.stringify(got)}`);
  }
  const noNum = parseEncounter('fever for days', { lang: 'en' });
  check('bare unit word is not a 1-day duration', noNum.symptoms[0]?.durationValue === undefined, JSON.stringify(noNum.symptoms[0]));
  check('bare unit word raises no_duration', noNum.uncertainties.some((u) => u.reason === 'no_duration'), JSON.stringify(noNum.uncertainties));
}
{
  console.log('\n=== regressions: inferred units ===');
  const bare = parseEncounter('temperature 102', { lang: 'en' });
  check('bare temperature is medium confidence', bare.vitals[0]?.confidence === 'medium', JSON.stringify(bare.vitals[0]));
  check('bare temperature raises unit_inferred', bare.uncertainties.some((u) => u.reason === 'unit_inferred'), JSON.stringify(bare.uncertainties));
  const stated = parseEncounter('temperature 102 degrees', { lang: 'en' });
  check('stated unit is high confidence', stated.vitals[0]?.confidence === 'high', JSON.stringify(stated.vitals[0]));
  check('stated unit raises nothing', !stated.uncertainties.some((u) => u.reason === 'unit_inferred'), JSON.stringify(stated.uncertainties));
  const bp = parseEncounter('blood pressure 150 over 90', { lang: 'en' });
  check('bp has no inferred unit', !bp.uncertainties.some((u) => u.reason === 'unit_inferred'), JSON.stringify(bp.uncertainties));
}
