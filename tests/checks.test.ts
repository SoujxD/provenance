// Every independent check must fire on the packet's real issues, with the right numbers and evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packet } from '../src/server/packet.ts';
import { runChecks, CHECKS } from '../src/server/checks/rules.ts';
import { LineModel, estimateEffect } from '../src/server/calc.ts';

const P = packet();
const v3 = P.versions.get('v3')!;
const ctxAt = (asOf: string) => ({ P, asOf, base: v3, lines: P.lines.get('v3')!, params: P.p.engine_reference.parameters });
const all = runChecks(ctxAt('2026-07-02T00:00:00Z'));
const byId = (prefix: string) => all.findings.find((f) => f.id.startsWith(prefix));
const model = new LineModel(v3, P.p.engine_reference.parameters);
const effect = (prefix: string) => estimateEffect(model, byId(prefix)!.proposed!.filter((c) => !c.target.includes(':')));

test('no check throws', () => {
  assert.deepEqual(all.errors, []);
  assert.ok(CHECKS.length >= 30);
});

test('packet is loaded byte-exact', () => {
  assert.equal(P.sha256, 'ee01f8508bd2fd9854754b82fd9c4a055bdc55e2778a132002a25381c412ad19');
});

test('RSU lots N1/N3/N4 at $0 basis: supplement gives 19,100/19,100/9,420', () => {
  const f = byId('SUPPLEMENTAL_BASIS')!;
  const m = Object.fromEntries(f.proposed!.map((c) => [c.target, c.value]));
  assert.equal(m['F8949.B.N1'], 140);
  assert.equal(m['F8949.B.N3'], -620);
  assert.equal(m['F8949.E.N4'], 5880);
  assert.match(f.title, /47,620/);
  assert.ok(f.evidence.includes('D11') && f.evidence.includes('ev-0027'), 'cites the supplement and W-2 box 14');
  const e = effect('SUPPLEMENTAL_BASIS');
  assert.equal(e.fed, -15536);
});

test('Northlake interest 1,840 counted twice (composite sweep = standalone 1099-INT)', () => {
  const f = byId('DUPLICATE_INFO_RETURN')!;
  assert.deepEqual(f.proposed, [{ target: 'SchB.1.2', value: 0, note: 'Duplicate of SchB.1.1' }]);
  assert.equal(effect('DUPLICATE_INFO_RETURN').fed, -640);
});

test('Sparbanken converted at 2024 average 10.56 instead of 2025 average 9.86', () => {
  const f = byId('FX_RATE_PERIOD')!;
  assert.equal(f.proposed![0].value, 1871);
});

test('Schedule C gross receipts include the 1099-K 12,400 already inside Atlas deposits', () => {
  const f = byId('PAYMENT_CARD_DOUBLE')!;
  assert.equal(f.proposed![0].value, 151300);
  assert.ok(f.evidence.includes('ev-0109'), 'cites D15 page 3');
  assert.match(f.detail!.join(' '), /142,000.*9,300.*151,300/);
});

test('Mileage log page 3 is a duplicate scan of page 2: 11,800 → 8,100 miles', () => {
  const f = byId('DUPLICATE_PAGE:D23')!;
  assert.equal(f.proposed![0].target, 'SchC.44a');
  assert.equal(f.proposed![0].value, 8100);
  assert.equal(effect('DUPLICATE_PAGE:D23').fed, 919);
});

test('SE health insurance 14,400 disallowed: eligible for spouse\'s employer plan', () => {
  const f = byId('SEHI_SUBSIDIZED_PLAN')!;
  assert.ok(f.evidence.includes('qa-25'));
  assert.equal(effect('SEHI_SUBSIDIZED_PLAN').fed, 4464);
});

test('Phone 70%, internet 50%, Spotify personal deducted at 100% (1,524)', () => {
  const f = byId('MIXED_USE_EXPENSE')!;
  const m = Object.fromEntries(f.proposed!.map((c) => [c.target, c.value]));
  assert.equal(m['SchC.25'], 2172);
  assert.equal(m['SchC.27a.1'], 6634);
  assert.match(f.title, /1,524/);
});

test('HVAC 11,000 expensed as a repair: improvement, effect from the engine what-if', () => {
  const f = byId('REPAIR_CAPITALIZATION')!;
  assert.equal(f.whatIf, 'hvac_improvement');
  assert.ok(f.proposed!.some((c) => c.target === 'SchE.14A' && c.value === 2300));
});

test('Lonestar payoff interest 2,150 double counted (already in the 1098)', () => {
  assert.equal(byId('LENDER_INTEREST_DOUBLE')!.proposed![0].value, 19697);
});

test('Home property tax ignores the 6,912 seller credit; SALT then falls below the cap', () => {
  const f = byId('PROPERTY_TAX_PRORATION')!;
  assert.equal(f.proposed![0].value, 6508);
  const e = effect('PROPERTY_TAX_PRORATION');
  const a = e.anchors.find((x) => x.key === 'SchA.17')!;
  assert.equal(Math.round(a.delta), -5622, 'only the part below the 40,000 cap is lost');
  assert.equal(e.fed, 1462);
});

test('Subaru deducted at 6,000; Form 1098-C caps it at 2,900', () => {
  assert.equal(byId('VEHICLE_DONATION_1098C')!.proposed![0].value, 2900);
});

test('Q4 federal estimate 4,000 from the questionnaire; IRS transcript shows 3,000', () => {
  const f = byId('ESTIMATES_VS_TRANSCRIPT')!;
  assert.equal(f.proposed![0].value, 12000);
  assert.equal(effect('ESTIMATES_VS_TRANSCRIPT').fed, 1000);
});

test('CA estimates include the 09-15 payment the FTB applied to 2024', () => {
  assert.equal(byId('STATE_PAYMENT_DESIGNATION')!.proposed![0].value, 10500);
});

test('CA wages use W-2 box 16; paystub shows 22,469 CA-source for Halvorsen', () => {
  const f = byId('STATE_WAGE_SOURCING')!;
  assert.equal(f.proposed![0].value, 107100 + 22469);
  assert.equal(effect('STATE_WAGE_SOURCING').ca, -5685);
});

test('Meridian page 32 lot M18 never extracted explains the 250 summary/detail gap', () => {
  const f = byId('BROKER_SUMMARY_DETAIL:D31')!;
  assert.equal(f.proposed![0].target, 'F8949.B.M18');
  assert.equal(f.proposed![0].value, -60);
});

test('Corrected 1099 (D31) diffs vs D30: M6 wash, M9 basis, M14 term', () => {
  const f = byId('CORRECTED_FORM_DIFF:D31')!;
  const d = f.detail!.join('\n');
  assert.match(d, /M6.*735.*512/);
  assert.match(d, /M9.*6900.*4880/);
  assert.match(d, /M14.*short.*long/);
});

test('Crypto C6 zero basis vs client claim of 3,050 — judgment call, only after msg-07 arrives', () => {
  const before = runChecks(ctxAt('2026-06-23T09:00:00Z')).findings.find((f) => f.id.startsWith('DIGITAL_ASSET'))!;
  assert.equal(before.proposed, undefined);
  const after = byId('DIGITAL_ASSET_BASIS_EVIDENCE')!;
  assert.equal(after.judgment, true);
  assert.ok(after.evidence.includes('msg-07'));
  assert.ok(after.proposed!.some((c) => c.target === 'F8949.K.C6' && c.value === 2275), 'long-term with the claimed basis');
});

test('Theo SSN typo (organizer 3309 vs D06/D71 3390) caught before e-file, blocking', () => {
  const f = byId('TIN_CONSISTENCY:theo')!;
  assert.equal(f.severity, 'blocking');
  assert.equal(f.proposed![0].value, '666-74-3390');
  assert.match(f.summary, /transposed/);
  assert.ok(f.detectedAt < '2026-07-13', 'detectable from the prior-year return long before the rejection');
});

test('St. Brigid ambiguous 1/7 handwriting (0.41) resolved by msg-08 + check #2207', () => {
  const before = runChecks(ctxAt('2026-06-23T09:00:00Z')).findings.find((f) => f.id === 'LOW_CONFIDENCE_AMOUNT:ev-1049')!;
  assert.equal(before.blocksFiling, true);
  const after = byId('LOW_CONFIDENCE_AMOUNT:ev-1049')!;
  assert.ok(after.evidence.includes('msg-08'));
  assert.equal(after.blocksFiling, false);
});

test('SEP over the limit; the limit moves with Schedule C fixes', () => {
  const f = byId('RETIREMENT_DEDUCTION_LIMIT')!;
  assert.match(f.title, /2,786/);
  const ours = new Map<string, number | string>([['SchC.31', 81854 - 12400 + 2590 + 1524]]);
  const g = runChecks({ ...ctxAt('2026-07-02T00:00:00Z'), ours }).findings.find((x) => x.id.startsWith('RETIREMENT'))!;
  assert.ok(g.proposed && Number(g.proposed[0].value) < 15214, 'deductible SEP falls when net profit falls');
});

test('Outside filings: 1099-NEC not filed, FBAR, Form 3520, composites', () => {
  assert.ok(byId('INFO_RETURNS_DUE'));
  assert.ok(byId('FBAR_REQUIRED:D36'));
  assert.ok(byId('FOREIGN_GIFT_INHERITANCE:D36'));
  assert.ok(byId('COMPOSITE_RETURNS:D39'), 'Oregon composite');
  assert.ok(byId('COMPOSITE_RETURNS:D38'), 'Arizona composite');
  for (const f of all.findings.filter((x) => x.kind === 'outside_filing')) assert.equal(f.blocksFiling, false);
});

test('California AMT on the ISO not computed', () => {
  const f = byId('STATE_AMT_NOT_COMPUTED')!;
  assert.match(f.summary, /98\.\d%/);
});

test('8949 box A label nets wash adjustments 1,583.05 vs lots 2,258.05', () => {
  const f = byId('ADJUSTMENT_CODE_RECON:F8949.A.total')!;
  assert.match(f.title, /1,583\.05.*2,258\.05/);
});

test('Form 2441 provider name mismatch, and the transposed Little Sprouts EIN (a confident misread)', () => {
  assert.match(byId('PROVIDER_ID_MATCH:F2441.1a')!.title, /Bright Oak Kids Club/);
  const e = byId('EXTRACTION_MISMATCH:ev-1045')!;
  assert.match(e.title, /74-3829156/);
});

test('Client answers contradicting documents (qa-14, qa-31)', () => {
  assert.ok(byId('CLIENT_ANSWER_CONFLICT:qa-14'));
  const ira = byId('CLIENT_ANSWER_CONFLICT:qa-31')!;
  assert.match(ira.summary, /7,026 would be taxable/);
});

test('Checks are time-aware: nothing is detected before its evidence exists', () => {
  const early = runChecks({ ...ctxAt('2026-02-01T00:00:00Z'), base: P.versions.get('v1')!, lines: P.lines.get('v1')! });
  for (const f of early.findings) if (f.rule !== 'ELECTION_OPPORTUNITY') assert.ok(f.detectedAt <= '2026-02-01T00:00:00Z' || f.detectedAt <= P.versions.get('v1')!.computed_at, f.id);
});
