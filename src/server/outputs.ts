// Generated records: the client's copy, the exam binder for a notice, and the roll-forward package.
// Each is self-contained (one HTML file, no external references) and content-hashed.
import { packet } from './packet.ts';
import { stateFor, computeOursFor, allFindings, signoffViews } from './derive.ts';
import { loadEvents, sha256, canonical, verifyChain } from './events.ts';
import { seasonNow } from './season.ts';
import { person } from './access.ts';
import { buildMasker } from '../shared/mask.ts';
import { getDb } from './db.ts';
import { basisChain } from './checks/rules.ts';

function docOfType(type: string, title?: RegExp) {
  return [...packet().docs.values()].find((d) => d.document_type === type && (!title || title.test(d.title)));
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const m = (n: unknown) => (typeof n === 'number' ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : esc(n));

const CSS = `body{font:13px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d2433;max-width:960px;margin:24px auto;padding:0 20px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px;border-bottom:1px solid #d6dae3;padding-bottom:4px}h3{font-size:13px;margin:16px 0 6px}
table{border-collapse:collapse;width:100%;margin:6px 0 12px}td,th{border:1px solid #dfe3ea;padding:4px 8px;text-align:left;vertical-align:top}th{background:#f4f6f9;font-weight:600}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}.muted{color:#5c6577}.box{border:1px solid #d6dae3;border-radius:6px;padding:10px 12px;margin:8px 0;background:#fafbfc}
.page{white-space:pre-wrap;font-family:ui-monospace,Consolas,monospace;font-size:12px;border:1px solid #d6dae3;padding:12px;background:#fff;margin:6px 0}
mark{background:#ffe58a;padding:0 2px}.ok{color:#11733f;font-weight:600}.warn{color:#9a5b00;font-weight:600}.hash{font-family:ui-monospace,Consolas,monospace;font-size:11px;word-break:break-all}
@media print{.noprint{display:none}h2{break-after:avoid}.page{break-inside:avoid}}`;

function shell(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;
}

function filedState(ws: string) {
  const s = stateFor(ws);
  const at = seasonNow(s);
  const ours = computeOursFor(s, at);
  let snapshot: any = null;
  if (s.filing.frozen) {
    const row = getDb().prepare('SELECT data FROM attachments WHERE id = ?').get(s.filing.frozen.snapshotId) as any;
    if (row) snapshot = JSON.parse(Buffer.from(row.data).toString('utf8'));
  }
  return { s, at, ours, snapshot };
}

function pageHtml(docId: string, page: number, highlight: string[] = []) {
  const P = packet();
  const mask = buildMasker(P.sensitive);
  const d = P.docs.get(docId)!;
  let text = esc(mask(d.pages.find((p) => p.page === page)?.printed_content ?? ''));
  for (const h of highlight) if (h) text = text.split(esc(h)).join(`<mark>${esc(h)}</mark>`);
  return `<div class="muted">${esc(d.id)} · ${esc(d.title)} · page ${page} of ${d.page_count} · received ${esc(d.received_at.slice(0, 10))} · file ${esc(d.file_name)}</div><div class="page">${text}</div>`;
}

export function clientCopy(ws: string): { html: string; hash: string } {
  const P = packet();
  const { s, ours, snapshot } = filedState(ws);
  const sum = snapshot?.summary ?? ours.summary;
  const mask = buildMasker(P.sensitive);
  const rows = (o: any) => Object.entries(o).filter(([k]) => k !== 'penalty' || o[k]).map(([k, v]) => `<tr><td>${esc(k.replace(/_/g, ' '))}</td><td class="n">${m(v)}</td></tr>`).join('');
  const subs = s.filing.submissions.map((x) => `<tr><td>${esc(x.jurisdiction)}</td><td>${esc(x.id)}</td><td>${esc(x.at.slice(0, 10))}</td><td>${esc(x.status)}</td><td>${esc(x.errors.map((e: any) => e.code).join(', '))}</td></tr>`).join('');
  const body = `<h1>2025 tax return — your copy</h1><div class="muted">${esc(P.household.people.filter((p: any) => p.role !== 'dependent').map((p: any) => p.name).join(' & '))} · married filing jointly · prepared by ${esc(P.firm.name)} (${esc(P.firm.firm_identity.address)})</div>
<div class="box">${s.filing.frozen ? `<span class="ok">Filed and accepted.</span> Frozen ${esc(s.filing.frozen.at.slice(0, 10))}. Content hash <span class="hash">${esc(s.filing.frozen.hash)}</span>` : '<span class="warn">Draft — not yet filed.</span>'}</div>
<h2>Federal (Form 1040)</h2><table>${rows(sum.federal)}</table><h2>California (Form 540NR, part-year resident)</h2><table>${rows(sum.california)}</table>
<h2>E-file</h2><table><tr><th>Jurisdiction</th><th>Submission</th><th>Date</th><th>Status</th><th>Errors</th></tr>${subs || '<tr><td colspan=5 class="muted">Not transmitted yet.</td></tr>'}</table>
<h2>Your e-file authorization (Forms 8879 / FTB 8879)</h2><p>${s.filing.clientApproval ? `Approved and signed by ${esc(person(s.filing.clientApproval.actor)?.name)} on ${esc(s.filing.clientApproval.at.slice(0, 10))} with PIN ${esc(s.filing.clientApproval.pinMasked)}.` : 'Not yet signed.'} Prior-year AGI used for e-signature: ${m(P.household.prior_year_agi_for_esignature)}. Refund / payment account: ${esc(mask(P.household.bank_account_for_refund_or_payment.account))} at ${esc(P.household.bank_account_for_refund_or_payment.bank)}.</p>
<p class="muted">Keep this copy and your records for at least 7 years. Amounts reflect the return as finalized in the workpaper (engine version ${esc(ours.base.version)} plus reviewed adjustments).</p>`;
  const html = shell('Your 2025 return', body);
  return { html, hash: sha256(html) };
}

export function examBinder(ws: string, noticeId: string): { html: string; hash: string } {
  const P = packet();
  const { s, ours, snapshot, at } = filedState(ws);
  const notice = P.p.tax_agency_records.notices.find((n: any) => n.id === noticeId) ?? P.p.tax_agency_records.notices.find((n: any) => n.document === 'D72');
  const lines = snapshot?.lines ?? Object.fromEntries(ours.values);
  const val = (k: string) => lines[k];
  const findings = allFindings(s, ours, at);
  const adjs = [...s.adjustments.values()].filter((a) => a.status === 'approved');
  const adjFor = (keys: string[]) => adjs.filter((a) => a.changes.some((c) => keys.includes(c.target)));
  const trail = (keys: string[]) => {
    const relevant = loadEvents(ws).filter((e) => (e.payload?.changes || []).some((c: any) => keys.includes(c.target)) || keys.includes(String(e.payload?.target ?? '')) || adjFor(keys).some((a) => a.id === e.payload?.id));
    return relevant.map((e) => `<tr><td>${esc(e.at.slice(0, 16).replace('T', ' '))}</td><td>${esc(person(e.actor)?.name ?? e.actor)}</td><td>${esc(e.type)}</td><td>${esc(e.payload?.reason ?? e.payload?.note ?? e.payload?.type ?? '')}</td><td class="hash">${esc(e.hash.slice(0, 16))}</td></tr>`).join('');
  };
  // 1. Noncash contributions
  const stock = docOfType('donation_receipt', /noncash/i)!;
  const car = [...P.docs.values()].find((d) => d.document_type === '1098-C')!;
  const shares = P.evByDoc.get(stock.id)!.find((e) => e.field === 'shares');
  const fmv = P.evByDoc.get(stock.id)!.find((e) => e.field === 'fmv');
  const basisEv = P.evByDoc.get(stock.id)!.find((e) => e.field === 'basis');
  const box4c = P.evByDoc.get(car.id)!.find((e) => e.field === 'box4c');
  const nonCashKeys = ['F8283.A1.stock', 'F8283.A1.vehicle', 'SchA.12'];
  // 2. Gross receipts
  const necs = [...P.docs.values()].filter((d) => d.document_type === '1099-NEC');
  const necRows = necs.map((d) => { const e = P.evByDoc.get(d.id)!.find((x) => x.field === 'box1')!; return { d, v: Number(e.value) }; });
  const necTotal = necRows.reduce((x, r) => x + r.v, 0);
  const k = [...P.docs.values()].find((d) => d.document_type === '1099-K')!;
  const kAmt = Number(P.evByDoc.get(k.id)!.find((e) => e.field === 'box1a')!.value);
  const detail = [...P.docs.values()].find((d) => d.document_type === 'books_transaction_detail')!;
  const dEvs = P.evByDoc.get(detail.id)!;
  const atlasTotal = Number(dEvs.find((e) => e.field === 'atlas_total')!.value);
  const atlasViaK = Number(dEvs.find((e) => e.field === 'atlas_paywell')!.value);
  const non1099 = Number(dEvs.find((e) => e.field === 'unreported_small')!.value);
  const pl = [...P.docs.values()].find((d) => d.document_type === 'books_profit_loss')!;
  const books = Number(P.evByDoc.get(pl.id)!.find((e) => e.field === 'total_income')!.value);
  const filedGross = val('SchC.1');
  const chain = verifyChain(ws);
  const grossOk = filedGross === necTotal + non1099 && necTotal + non1099 === books;
  const body = `<h1>Examination response — ${esc(notice.type)}</h1>
<div class="muted">Tax year ${esc(notice.tax_year)} · letter dated ${esc(notice.dated)} · response due <b>${esc(notice.response_due)}</b> · taxpayers ${esc(P.household.people.filter((p: any) => p.role !== 'dependent').map((p: any) => p.name).join(' and '))} · prepared by ${esc(P.firm.name)}</div>
<div class="box"><b>Items under examination</b><ol>${notice.items_under_examination.map((i: string) => `<li>${esc(i)}</li>`).join('')}</ol>
${s.filing.frozen ? `<span class="ok">Return as filed</span> — frozen ${esc(s.filing.frozen.at.slice(0, 10))}, snapshot hash <span class="hash">${esc(s.filing.frozen.hash)}</span>` : '<span class="warn">DRAFT: the return has not been filed in this workpaper; figures are the current workpaper values.</span>'}
<br>Packet sha256 <span class="hash">${esc(P.sha256)}</span> · audit log ${chain.ok ? `<span class="ok">intact</span> (${chain.count} events, head <span class="hash">${esc(chain.head.slice(0, 16))}</span>)` : `<span class="warn">broken at ${chain.brokenAt}</span>`}</div>

<h2>1. Noncash charitable contributions (Schedule A line 12, Form 8283)</h2>
<table><tr><th>Gift</th><th>Donee / acknowledgment</th><th>Date</th><th>How valued</th><th class="n">Deducted</th></tr>
<tr><td>${m(shares?.value)} shares Northlake Total Market Index Fund (held since 04/2019, long-term)</td><td>Austin Community Foundation (donor-advised fund) — ${esc(stock.id)}, "no goods or services provided"</td><td>${esc(P.evByDoc.get(stock.id)!.find((e) => e.field === 'date')?.value)}</td><td>Publicly traded: mean of high and low on the date of gift, 72.50 × ${m(shares?.value)} = ${m(fmv?.value)} (no qualified appraisal required). Cost basis ${m(basisEv?.value)}.</td><td class="n">${m(val('F8283.A1.stock'))}</td></tr>
<tr><td>2012 Subaru Outback (VIN in ${esc(car.id)})</td><td>Lone Star Kids Auto Donation — Form 1098-C ${esc(car.id)}, box 6a no goods or services</td><td>${esc(P.evByDoc.get(car.id)!.find((e) => e.field === 'date')?.value)}</td><td>Charity sold it in an arm's-length sale (box 4a): deduction limited to gross proceeds, box 4c ${m(box4c?.value)} (IRC §170(f)(12)(A)(ii)). The client's estimate of 6,000 was not used.</td><td class="n">${m(val('F8283.A1.vehicle'))}</td></tr>
<tr><th colspan=4>Schedule A line 12 as filed</th><th class="n">${m(val('SchA.12'))}</th></tr></table>
${Number(val('F8283.A1.vehicle')) !== Number(box4c?.value) ? '<p class="warn">The vehicle deduction on this return does not equal Form 1098-C box 4c. Address before responding.</p>' : ''}
<h3>Acknowledgments and valuation evidence</h3>${pageHtml(stock.id, 1, [String(fmv?.text_as_read), '72.50'])}${pageHtml(car.id, 1, [String(box4c?.text_as_read)])}
<h3>Workpaper trail for these lines</h3><table><tr><th>When</th><th>Who</th><th>Event</th><th>Why</th><th>Event hash</th></tr>${trail(nonCashKeys) || '<tr><td colspan=5 class="muted">No workpaper changes: engine values as computed.</td></tr>'}</table>

<h2>2. Schedule C gross receipts reconciliation</h2>
<table><tr><th>Source</th><th>Document</th><th class="n">Amount</th></tr>
${necRows.map((r) => `<tr><td>Form 1099-NEC — ${esc(r.d.issuer)}</td><td>${esc(r.d.id)}</td><td class="n">${m(r.v)}</td></tr>`).join('')}
<tr><th colspan=2>Total Forms 1099-NEC</th><th class="n">${m(necTotal)}</th></tr>
<tr><td>Deposits from 11 small clients who issued no Form 1099</td><td>${esc(detail.id)} p3</td><td class="n">${m(non1099)}</td></tr>
<tr><th colspan=2>Total receipts</th><th class="n">${m(necTotal + non1099)}</th></tr>
<tr><td>Books revenue (QuickBooks, cash basis)</td><td>${esc(pl.id)}</td><td class="n">${m(books)}</td></tr>
<tr><td>Schedule C line 1 as filed</td><td>return</td><td class="n">${m(filedGross)}</td></tr>
<tr><td>Form 1099-K — ${esc(k.issuer)} (card payments)</td><td>${esc(k.id)}</td><td class="n">${m(kAmt)}</td></tr></table>
<div class="box">The ${m(kAmt)} on Form 1099-K is not additional income. It is the part of Atlas Outdoor Gear's ${m(atlasTotal)} that Atlas paid by card through ${esc(k.issuer)} (${m(atlasViaK)}); Atlas also reported the full ${m(atlasTotal)} on its Form 1099-NEC (${esc(necs.find((d) => /Atlas/.test(d.issuer))?.id)}). Third-party forms therefore total ${m(necTotal + kAmt)} but describe ${m(necTotal)} of receipts. ${m(necTotal)} + ${m(non1099)} = ${m(necTotal + non1099)} = books = Schedule C line 1. ${grossOk ? '<span class="ok">Reconciles.</span>' : '<span class="warn">Does not reconcile on this return — see workpaper finding PAYMENT_CARD_DOUBLE.</span>'}</div>
${pageHtml(detail.id, 3, [atlasTotal.toLocaleString('en-US', { minimumFractionDigits: 2 }), atlasViaK.toLocaleString('en-US', { minimumFractionDigits: 2 }), non1099.toLocaleString('en-US', { minimumFractionDigits: 2 })])}${pageHtml(k.id, 1, ['12,400.00'])}${pageHtml(pl.id, 1, ['151,300.00'])}
${necRows.map((r) => pageHtml(r.d.id, 1, [r.v.toLocaleString('en-US', { minimumFractionDigits: 2 })])).join('')}
<h3>Workpaper trail for gross receipts</h3><table><tr><th>When</th><th>Who</th><th>Event</th><th>Why</th><th>Event hash</th></tr>${trail(['SchC.1']) || '<tr><td colspan=5 class="muted">No workpaper changes.</td></tr>'}</table>

<h2>3. Review record</h2>
<table><tr><th>Finding</th><th>Status</th><th>Resolution</th></tr>${findings.filter((f) => /VEHICLE|PAYMENT_CARD|NONCASH|LOW_CONFIDENCE/.test(f.id)).map((f) => `<tr><td>${esc(f.title)}</td><td>${esc(f.status)}</td><td>${esc(f.resolution?.note ?? '')}${f.resolution ? ` — ${esc(person(f.resolution.actor)?.name ?? f.resolution.actor)}, ${esc(f.resolution.at.slice(0, 10))}` : ''}</td></tr>`).join('')}</table>
<table><tr><th>Sign-off</th><th>By</th><th>When</th><th>Hash of what was signed</th></tr>${signoffViews(s, ours, findings).filter((x) => ['area:deductions', 'area:business', 'return'].includes(x.scope)).map((x) => `<tr><td>${esc(x.scope)} (${esc(x.level)})</td><td>${esc(x.actorName)}</td><td>${esc(x.at.slice(0, 10))}</td><td class="hash">${esc(x.hash.slice(0, 24))}… ${x.valid ? '' : '(later reopened)'}</td></tr>`).join('') || '<tr><td colspan=4 class="muted">No sign-offs recorded.</td></tr>'}</table>
<p class="muted">Generated ${esc(new Date().toISOString())} from workspace ${esc(ws)}. Every figure links to a document page reproduced above; the event hashes let an examiner verify that the record was not edited after the fact.</p>`;
  const html = shell(`${notice.type} response binder`, body);
  return { html, hash: sha256(html) };
}

export function rollforwardPackage(ws: string) {
  const P = packet();
  const { s, ours, snapshot } = filedState(ws);
  const v = (k: string) => (snapshot?.lines ?? Object.fromEntries(ours.values))[k];
  const co = ours.base.carryovers_out;
  const sum = snapshot?.summary ?? ours.summary;
  const sep = Number(P.evByDoc.get(docOfType('retirement_contribution')?.id ?? '')?.find((e) => e.field === 'amount')?.value ?? 0);
  const k1Doc = docOfType('K-1-1065');
  const k1 = P.evByDoc.get(k1Doc?.id ?? '') || [];
  const k1v = (f: string) => Number(k1.find((e) => e.field === f)?.value ?? 0);
  const isoDoc = docOfType('3921');
  const iso = P.evByDoc.get(isoDoc?.id ?? '') || [];
  const isoV = (f: string) => Number(iso.find((e) => e.field === f)?.value ?? 0);
  const caAssets = ours.base.assets.filter((a: any) => a.california && a.cost && !a.disposed).map((a: any) => {
    const ourCa = v(`FTB3885A.${a.asset_id}`);
    const caAcc = (a.california.prior_accumulated ?? 0) + (typeof ourCa === 'number' ? ourCa : a.california.depreciation_2025);
    const fedAcc = a.federal.accumulated_end;
    return { asset: a.asset_id, description: a.description, federalRemaining: Math.round((a.cost - fedAcc) * 100) / 100, californiaRemaining: Math.round((a.cost - caAcc) * 100) / 100, difference: Math.round((fedAcc - caAcc) * 100) / 100 };
  }).filter((x: any) => Math.abs(x.difference) > 0.5);
  const hvac = ours.activeAdjustments.find((a) => a.whatIf === 'hvac_improvement' || a.changes.some((c) => c.target === 'SchE.14A'));
  const carryovers = [
    { item: 'Minimum tax credit (Form 8801)', federal: co.federal.minimum_tax_credit_from_2025_amt, california: null, history: [`2025 AMT ${v('F6251.11')} from the ISO exercise (F6251.2i ${v('F6251.2i')}), engine ${ours.base.version}`], note: ours.activeAdjustments.length ? 'Workpaper adjustments change 2025 AMT; recompute with the engine before using.' : '' },
    { item: 'SEP contribution not deductible for 2025 (carry forward)', federal: sep - Number(v('Sch1.16') ?? 0), california: null, history: [`Contributed ${sep.toLocaleString()} (${docOfType('retirement_contribution')?.id}); deductible ${Number(v('Sch1.16')).toLocaleString()} (20% × (net profit − ½ SE tax))`], note: 'Deductible in 2026 within that year\'s limit; consider a corrective withdrawal to avoid the §4972 excise.' },
    { item: 'ISO shares (1,000 Corvane, exercised 2025-07-30)', federal: { regularBasis: isoV('box3') * isoV('box5'), amtBasis: isoV('box4') * isoV('box5') }, california: null, history: [`Form 3921 (${isoDoc?.id}): exercise price ${isoV('box3')}, FMV ${isoV('box4')}, ${isoV('box5')} shares`], note: 'Track the AMT basis: on sale, the AMT gain is smaller and the credit may be used.' },
    { item: 'S corporation stock basis — Lindqvist Family Woodworks', federal: v('F7203.15'), california: v('F7203.15'), history: [basisChain({ P, asOf: '9999', base: ours.base, lines: P.lines.get(ours.base.version)!, params: P.p.engine_reference.parameters }), `2025: increases ${Number(v('F7203.4')).toLocaleString()}, distributions ${Number(v('F7203.6')).toLocaleString()}; excess ${Number(v('F7203.excess')).toLocaleString()} taxed as capital gain`], note: 'Any 2026 distribution beyond 2026 income is again a capital gain.' },
    { item: 'Partnership capital — Ridgeline Real Estate Fund III', federal: k1v('cap_end'), california: null, history: [`Beginning ${k1v('cap_begin').toLocaleString()} + income 9,870 − distributions ${k1v('box19a').toLocaleString()} − foreign taxes ${k1v('box21').toLocaleString()} = ${k1v('cap_end').toLocaleString()} (${k1Doc?.id})`], note: 'Outside basis was never computed by the prior preparer; build it from the capital account and liabilities.' },
    { item: 'Traditional IRA basis (Form 8606 line 14)', federal: v('F8606.14'), california: v('F8606.14'), history: ['2024 7,000 → 2025 contribution 7,000 → converted 14,026 → 0'], note: '' },
    { item: 'Capital loss carryover', federal: co.federal.capital_loss_short + co.federal.capital_loss_long, california: co.california.capital_loss, history: ['2024 ST 3,200 / LT 11,000 fully used in 2025'], note: '' },
    { item: 'Passive losses suspended', federal: co.federal.passive_1450_fremont + co.federal.passive_1200_barton_hills, california: co.california.passive, history: ['All prior-year losses released in 2025 (net passive income; condo sold)'], note: '' },
    ...caAssets.map((a: any) => ({ item: `California depreciation difference — ${a.asset} ${a.description}`, federal: a.federalRemaining, california: a.californiaRemaining, history: [`Federal remaining ${a.federalRemaining.toLocaleString()} vs California ${a.californiaRemaining.toLocaleString()}`], note: 'California-source only after the move if the asset is used in a California activity.' })),
    ...(hvac ? [{ item: 'New asset: HVAC heat pump, 1450 Fremont Way (27.5-year, placed in service 2025-08-12)', federal: 11000 - 150, california: 11000 - 150, history: [`Capitalized by ${hvac.id}`], note: '' }] : []),
    { item: 'Home cost basis — 7709 Barton Ridge Dr', federal: 685000, california: null, history: ['Purchased 2025-07-08 (D54); refinanced 2025-11-20; refinance points 3,200 amortized over 360 months'], note: 'Unamortized refinance points 3,191 deductible as the loan is paid or refinanced.' },
  ];
  const fedSafe = Math.round(Number(sum.federal.total_tax) * 1.1);
  const caSafe = Math.round(Number(sum.california.total_tax) * 1.1);
  const pr = P.p.planning_reference_2026;
  const plan = {
    federal: { basis: '110% of 2025 total tax (2025 AGI over 150,000)', annual: fedSafe, installments: pr.federal_estimate_due_dates.map((d: string) => ({ due: d, amount: Math.round(fedSafe / 4) })) },
    california: {
      basis: 'Lesser of 90% of 2026 tax or 110% of 2025 tax. In 2026 only California-source income is taxable (the Sacramento rental, Ridgeline\'s California share), so 90% of the projected 2026 tax will usually be far lower; project it before paying.',
      priorYearSafeHarbor: caSafe,
      installments: pr.california_estimate_due_dates.map((d: string, i: number) => ({ due: d, pct: pr.california_installment_percentages[i], amount: Math.round(caSafe * pr.california_installment_percentages[i]) })),
    },
    changes: pr.known_2026_changes_for_this_household,
  };
  const openItems = allFindings(s, ours, seasonNow(s)).filter((f) => f.kind === 'outside_filing' || (f.kind === 'judgment' && f.status !== 'resolved') || /SEP|3520|FBAR|1099-NEC|C6|AMT|composite/i.test(f.title)).map((f) => ({ id: f.id, title: f.title, status: f.status }));
  const pkg = { year: 2026, from: { year: 2025, frozen: s.filing.frozen ?? null, version: ours.base.version, summary: sum }, carryovers, plan, openItems, generatedAt: new Date().toISOString() };
  return { pkg, hash: sha256(canonical(pkg)) };
}
