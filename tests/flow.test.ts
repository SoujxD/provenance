// End to end through the command layer, as real people would act: fix findings, approve under the
// firm's rules, sign off, get client approval, e-file (reject → fix → accept), freeze, amend, replay
// the rest of the season, answer the 2028 notice and roll forward. Nothing is seeded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'wp-flow-')), 'flow.db');
const { createWorkspaceRow, append, verifyChain } = await import('../src/server/events.ts');
const { execute } = await import('../src/server/commands.ts');
const { deriveView, invalidateViews } = await import('../src/server/derive.ts');
const { examBinder, rollforwardPackage, clientCopy } = await import('../src/server/outputs.ts');
const { SEASON_START } = await import('../src/server/state.ts');
const { packet } = await import('../src/server/packet.ts');

function newWs(id: string) {
  createWorkspaceRow(id, 'test', packet().sha256);
  append(id, { actor: 'system', type: 'workspace.created', payload: { packetSha256: packet().sha256 }, at: '2026-01-12T17:06:00Z' });
  append(id, { actor: 'system', type: 'season.clock', payload: { to: SEASON_START }, at: SEASON_START });
  return id;
}
const PRIYA = 'st-01', DANIEL = 'st-02', HELEN = 'st-03', MARCUS = 'st-04', JO = 'st-05', SAM = 'st-06', NGOZI = 'cu-01';
const view = (ws: string, who = PRIYA) => { invalidateViews(ws); return deriveView(ws, who); };
const open = (f: any) => !['resolved', 'no_change'].includes(f.status);
const run = (ws: string, who: string, cmd: any) => execute(ws, who, cmd);
const refused = (fn: () => unknown, re: RegExp) => assert.throws(fn, re);

test('rules are enforced on the server', () => {
  const ws = newWs('ws-rules');
  const v = view(ws);
  const rsu = v.findings.find((f: any) => f.id === 'SUPPLEMENTAL_BASIS:D11');
  const r = run(ws, PRIYA, { type: 'adjustment.create', title: 'RSU', changes: rsu.proposed, reason: rsu.summary, findingIds: [rsu.id] });
  assert.equal(r.needs, 'partner');
  refused(() => run(ws, PRIYA, { type: 'adjustment.approve', id: r.id }), /cannot adjustment approve/);
  refused(() => run(ws, DANIEL, { type: 'adjustment.approve', id: r.id }), /require partner sign-off/);
  refused(() => run(ws, MARCUS, { type: 'unmask', ref: 'household:theo.ssn' }), /no sensitive-data clearance/);
  refused(() => run(ws, SAM, { type: 'review_note.create', target: 'line:SchC.1', text: 'x' }), /not active until 2027-01-04/);
  refused(() => run(ws, JO, { type: 'adjustment.create', title: 'x', changes: [{ target: 'SchC.1', value: 1 }], reason: 'x' }), /cannot adjustment create/);
  refused(() => run(ws, PRIYA, { type: 'judgment.record', title: 't', decision: 'd', authority: '' }), /authority/);
  refused(() => run(ws, PRIYA, { type: 'adjustment.create', title: 'x', changes: [{ target: 'SchC.1', value: 1 }], reason: 'x', judgment: true }), /authority/);
  const unmask = run(ws, PRIYA, { type: 'unmask', ref: 'household:theo.ssn' });
  assert.equal(unmask.value, '666-74-3309');
  assert.equal(view(ws, HELEN).unmaskLog.length, 1, 'every unmasked view is logged');
  run(ws, HELEN, { type: 'adjustment.approve', id: r.id });
  const v2 = view(ws);
  assert.equal(v2.findings.find((f: any) => f.id === rsu.id).status, 'resolved');
  assert.equal(v2.ours.summary.federal.agi, 445590 - 47620);
});

test('a sign-off reopens when what was signed changes, and nobody reviews their own work', () => {
  const ws = newWs('ws-signoff');
  run(ws, PRIYA, { type: 'signoff', scope: 'area:investments', level: 'preparer' });
  refused(() => run(ws, PRIYA, { type: 'signoff', scope: 'area:investments', level: 'reviewer' }), /cannot signoff reviewer/);
  run(ws, DANIEL, { type: 'signoff', scope: 'area:investments', level: 'reviewer' });
  assert.ok(view(ws).signoffs.every((s: any) => s.valid));
  run(ws, MARCUS, { type: 'adjustment.create', title: 'FX', changes: [{ target: 'SchB.1.6', value: 1871 }], reason: '2025 average rate' });
  const sos = view(ws, DANIEL).signoffs;
  assert.ok(sos.every((s: any) => !s.valid), 'both sign-offs reopened');
  assert.ok(sos[1].changes.some((c: string) => c.startsWith('SchB.1.6: 1747 → 1871')));
  assert.ok(view(ws, DANIEL).notifications.items.some((n: any) => /reopened/.test(n.text)));
  // Daniel recorded a verification in another area: he prepared it, so he cannot review it.
  run(ws, DANIEL, { type: 'verification.record', target: 'SchC.1', verificationType: 'recalculated' });
  run(ws, PRIYA, { type: 'signoff', scope: 'area:business', level: 'preparer' });
  refused(() => run(ws, DANIEL, { type: 'signoff', scope: 'area:business', level: 'reviewer' }), /may not review or sign off on work they prepared/);
});

test('the whole season: fix, approve, sign, approve, e-file reject → fix → accept, freeze, amend, notice, roll forward', () => {
  const ws = newWs('ws-season');
  // Messages in late June bring the crypto claim and the St. Brigid confirmation.
  run(ws, PRIYA, { type: 'season.advance' });
  run(ws, PRIYA, { type: 'season.advance' });
  let v = view(ws);
  assert.ok(v.findings.find((f: any) => f.id === 'LOW_CONFIDENCE_AMOUNT:ev-1049').evidence.includes('msg-08'));

  // 1. Propose every suggested fix that is not a judgment call, in one bulk action.
  const fixes = v.findings.filter((f: any) => f.source === 'check' && f.proposed?.length && !f.judgment && f.kind !== 'opportunity' && f.id !== 'TIN_CONSISTENCY:theo');
  const bulk = run(ws, PRIYA, { type: 'bulk', label: 'Apply suggested fixes', items: fixes.map((f: any) => ({ type: 'adjustment.create', title: f.title, changes: f.proposed, reason: f.summary, findingIds: [f.id] })) });
  assert.equal(bulk.errors.length, 0, JSON.stringify(bulk.errors));
  // Judgment calls, decided with authority.
  const hvac = v.findings.find((f: any) => f.id.startsWith('REPAIR_CAPITALIZATION'));
  run(ws, PRIYA, { type: 'adjustment.create', title: hvac.title, changes: hvac.proposed, reason: hvac.summary, findingIds: [hvac.id], judgment: true, authority: hvac.authorityHint, whatIf: hvac.whatIf });
  const c6 = v.findings.find((f: any) => f.id.startsWith('DIGITAL_ASSET_BASIS_EVIDENCE'));
  run(ws, PRIYA, { type: 'finding.resolve', findingId: c6.id, status: 'no_change', note: 'Keep $0 basis: one bank line is not enough to support 3,050; revisit if the client produces the statement.', authority: c6.authorityHint });
  // The organizer SSN: Priya decides (wrongly) the organizer is right — the agency will disagree.
  const tin = v.findings.find((f: any) => f.id === 'TIN_CONSISTENCY:theo');
  run(ws, PRIYA, { type: 'finding.resolve', findingId: tin.id, status: 'no_change', note: 'Client says the organizer is correct.' });

  // 2. Approvals: Daniel up to the threshold, Helen above it and for judgment calls.
  v = view(ws, DANIEL);
  for (const a of v.adjustments.filter((x: any) => x.status === 'pending' && x.needs === 'reviewer')) run(ws, DANIEL, { type: 'adjustment.approve', id: a.id });
  for (const a of view(ws, HELEN).adjustments.filter((x: any) => x.status === 'pending')) run(ws, HELEN, { type: 'adjustment.approve', id: a.id });
  v = view(ws);
  assert.equal(v.adjustments.filter((a: any) => a.status === 'pending').length, 0);
  assert.ok(v.ours.summary.federal.balance_due < 0, 'after the fixes the federal return shows a refund');

  // 3. Everything else that blocks: variances explained, engine warnings and remaining checks resolved.
  const blocking = v.findings.filter((f: any) => f.blocksFiling && open(f));
  run(ws, PRIYA, { type: 'bulk', label: 'Resolve remaining', items: blocking.map((f: any) => ({ type: 'finding.resolve', findingId: f.id, status: f.source === 'variance' ? 'resolved' : 'no_change', note: f.source === 'variance' ? `Explained: ${f.detail?.[0] ?? f.summary}` : 'Reviewed; addressed by adjustments or no change needed.', authority: f.authorityHint ?? (f.judgment ? 'See finding' : undefined) })) });
  // 4. Steps.
  for (const k of ['SchD.6', 'SchD.14', 'F8582.1c', 'F8606.2']) run(ws, PRIYA, { type: 'verification.record', target: k, verificationType: 'agreed_to_prior_year' });
  for (const k of ['F1040.26', 'F540NR.72']) run(ws, PRIYA, { type: 'verification.record', target: k, verificationType: 'agreed_to_third_party_record' });
  for (const step of ['Identity verified', 'Prior-year return reviewed', 'All documents accounted for']) run(ws, PRIYA, { type: 'step.complete', step });
  run(ws, PRIYA, { type: 'due_diligence.record', credit: 'ctc_odc', answers: { relationship: 'children', age: 'ok', residency: '12 months', support: 'parents', tin: 'see TIN finding', joint: 'no', documents: '1098-T, prior return' } });
  v = view(ws);
  assert.deepEqual(v.findings.filter((f: any) => f.blocksFiling && open(f)).map((f: any) => f.id), []);

  // 5. Sign-offs: preparer then reviewer for every area, then the partner for the return.
  for (const a of v.areas.filter((x: any) => x.id !== 'filing' && (x.lines || x.total))) {
    run(ws, PRIYA, { type: 'signoff', scope: `area:${a.id}`, level: 'preparer' });
    run(ws, DANIEL, { type: 'signoff', scope: `area:${a.id}`, level: 'reviewer' });
  }
  run(ws, HELEN, { type: 'signoff', scope: 'return', level: 'partner' });
  refused(() => run(ws, HELEN, { type: 'filing.transmit' }), /gated/);
  run(ws, HELEN, { type: 'filing.request_approval' });
  refused(() => run(ws, NGOZI, { type: 'filing.client_approve', pin: '123', consent: true }), /five-digit/);
  run(ws, NGOZI, { type: 'filing.client_approve', pin: '41207', consent: true });
  v = view(ws, HELEN);
  assert.equal(v.gate.ready, true, JSON.stringify(v.gate.blockers));

  // 6. E-file: the agency rejects the organizer SSN, exactly as in the packet.
  refused(() => run(ws, DANIEL, { type: 'filing.transmit' }), /cannot filing transmit/);
  const first = run(ws, HELEN, { type: 'filing.transmit' });
  assert.equal(first.status, 'rejected');
  assert.equal(first.errors[0].code, 'R0000-504-02');
  v = view(ws);
  assert.ok(v.findings.some((f: any) => f.id.startsWith('EFILE:') && f.severity === 'blocking'));
  assert.equal(v.filing.submissions.find((s: any) => s.jurisdiction === 'california').status, 'not_transmitted');
  // Fix: correct the SSN from the prior-year return; the return changed, so the client approves again.
  run(ws, PRIYA, { type: 'adjustment.create', title: 'Theo SSN', changes: [{ target: 'household:theo.ssn', value: '666-74-3390' }], reason: 'Organizer typo; prior-year return and SS card show 3390', findingIds: [tin.id] });
  const fix = view(ws).adjustments.at(-1);
  run(ws, DANIEL, { type: 'adjustment.approve', id: fix.id });
  v = view(ws, HELEN);
  assert.ok(v.signoffs.some((s: any) => s.scope === 'area:intake' && !s.valid), 'the intake sign-off reopened with the SSN change');
  assert.ok(!v.steps.find((s: any) => s.step === 'Client approval and e-file authorization').done, 'approval no longer matches the return');
  run(ws, PRIYA, { type: 'signoff', scope: 'area:intake', level: 'preparer' });
  run(ws, DANIEL, { type: 'signoff', scope: 'area:intake', level: 'reviewer' });
  run(ws, HELEN, { type: 'signoff', scope: 'return', level: 'partner' });
  run(ws, HELEN, { type: 'filing.request_approval' });
  run(ws, NGOZI, { type: 'filing.client_approve', pin: '41207', consent: true });
  const second = run(ws, HELEN, { type: 'filing.transmit' });
  assert.equal(second.status, 'accepted');
  v = view(ws);
  assert.ok(v.filing.frozen?.hash);
  assert.equal(v.filing.submissions.filter((s: any) => s.status === 'accepted').length, 2);

  // 7. Frozen: changes need an amendment, layered on top.
  refused(() => run(ws, PRIYA, { type: 'adjustment.create', title: 'x', changes: [{ target: 'SchC.8', value: 2000 }], reason: 'x' }), /frozen/);
  run(ws, HELEN, { type: 'amendment.open', reason: 'Late corrected 1099' });
  const amd = run(ws, PRIYA, { type: 'adjustment.create', title: 'Amended', changes: [{ target: 'SchC.8', value: 2000 }], reason: 'Corrected invoice' });
  assert.equal(view(ws).adjustments.find((a: any) => a.id === amd.id).layer, 'amendment');
  run(ws, PRIYA, { type: 'adjustment.revert', id: amd.id, note: 'Not needed after all' });

  // 8. The rest of the season plays: gates already satisfied, payments, QR, roll-forward, notice.
  for (let i = 0; i < 20; i++) {
    try { run(ws, PRIYA, { type: 'season.advance' }); } catch (e: any) { if (/season is over/.test(e.message)) break; throw e; }
  }
  v = view(ws, HELEN);
  assert.ok(v.notices.some((n: any) => n.id === 'N-2025-L566'));
  assert.ok(v.findings.some((f: any) => f.id === 'NOTICE:N-2025-L566'));
  assert.ok(v.people.find((p: any) => p.id === SAM).active, 'Sam is active from 2027');
  run(ws, SAM, { type: 'review_note.create', target: 'line:SchC.1', text: 'QR: reconciliation well documented', blocking: false });

  const binder = examBinder(ws, 'N-2025-L566');
  assert.match(binder.html, /142,000/);
  assert.match(binder.html, /151,300/);
  assert.match(binder.html, /Reconciles\./);
  assert.match(binder.html, new RegExp(v.filing.frozen.hash));
  assert.ok(!/666-\d\d-\d{4}/.test(binder.html), 'no full SSN in the binder');
  const rf = rollforwardPackage(ws);
  assert.ok(rf.pkg.carryovers.some((c: any) => /Minimum tax credit/.test(c.item)));
  assert.ok(rf.pkg.carryovers.some((c: any) => /HVAC/.test(c.item)));
  assert.equal(rf.pkg.plan.federal.installments.length, 4);
  assert.match(clientCopy(ws).html, /Filed and accepted/);
  assert.equal(verifyChain(ws).ok, true);
});

test('a masked value sent back by the browser resolves to the real value (masking never corrupts data)', async () => {
  const { buildMasker, maskDeep } = await import('../src/shared/mask.ts');
  const ws = newWs('ws-mask');
  const mask = buildMasker(packet().sensitive);
  const v = maskDeep(view(ws), mask); // exactly what the browser receives
  const tin = v.findings.find((f: any) => f.id === 'TIN_CONSISTENCY:theo');
  assert.equal(tin.proposed[0].value, '•••-••-3390');
  run(ws, PRIYA, { type: 'adjustment.create', title: 'Theo SSN', changes: tin.proposed, reason: 'Prior-year return shows 3390', findingIds: [tin.id] });
  const fact = view(ws).ours.facts['household:theo.ssn'];
  assert.equal(fact, '666-74-3390');
});
