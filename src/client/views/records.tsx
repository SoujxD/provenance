import { useMemo, useState } from 'react';
import { useStore, usePacketIndex } from '../store';
import { Panel, Num, Ref, Status, Who, Empty, readOnly } from '../components/ui';
import { DepreciationTable } from './panels';
import { SummaryTable, FED_ROWS, CA_ROWS } from './overview';
import { lineValue, signed, money, date } from '../../shared/format';

// ---------- Versions compare ----------
export function Versions() {
  const { view, packet, openTrace } = useStore();
  const ix = usePacketIndex();
  const opts = ['2024', ...(view?.versions.map((v: any) => v.version) ?? []), 'ours'];
  const [a, setA] = useState('v1');
  const [b, setB] = useState('ours');
  const [form, setForm] = useState('');
  const [onlyDiff, setOnlyDiff] = useState(true);
  const rows = useMemo(() => {
    if (!ix || !view) return [];
    const val = (ver: string, k: string) => (ver === 'ours' ? (view.ours.lines[k]?.value ?? ix.lines.get(view.baseVersion)?.get(k)?.value) : ver === '2024' ? packet.prior_years.return_2024.lines[k] : ix.lines.get(ver)?.get(k)?.value);
    const keys = new Set<string>();
    for (const v of ['v1', 'v2', 'v3']) for (const k of ix.lines.get(v)?.keys() ?? []) keys.add(k);
    for (const l of view.ours.added) keys.add(l.key);
    return [...keys].filter((k) => !form || k.startsWith(form)).map((k) => ({ k, label: ix.lines.get('v3')?.get(k)?.label ?? ix.lines.get('v1')?.get(k)?.label ?? view.ours.added.find((l: any) => l.key === k)?.label, a: val(a, k), b: val(b, k) }))
      .filter((r) => !onlyDiff || JSON.stringify(r.a) !== JSON.stringify(r.b));
  }, [ix, view, packet, a, b, form, onlyDiff]);
  if (!view || !ix) return null;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Return & versions</h1><p>The three engine runs, our version, and the 2024 return — compare any two. Each engine version lists its trigger and the documents it added.</p></div></div>
      <div className="grid3">
        {view.versions.map((v: any, i: number) => {
          const full = ix.versions.get(v.version);
          const prev = i > 0 ? ix.versions.get(view.versions[i - 1].version) : null;
          const addedDocs = prev ? full.documents_used.filter((d: string) => !prev.documents_used.includes(d)) : [];
          return <Panel key={v.version} title={`${v.version} · ${date(v.computed_at)}`}><div className="small">{v.trigger}</div><div className="small muted" style={{ marginTop: 4 }}>Fed tax {money(v.summary.federal.total_tax)} (balance {money(v.summary.federal.balance_due)}) · CA tax {money(v.summary.california.total_tax)}</div>{addedDocs.length > 0 && <div className="row wrap" style={{ marginTop: 6 }}>{addedDocs.map((d: string) => <Ref key={d} r={d} label={d} />)}</div>}{full.documents_superseded.length > 0 && <div className="small muted">superseded: {full.documents_superseded.join(', ')}</div>}</Panel>;
        })}
      </div>
      <div className="grid2" style={{ marginTop: 12, alignItems: 'start' }}>
        <Panel title="Federal summary across versions" pad={false}><SummaryTable rows={FED_ROWS} /></Panel>
        <Panel title="California summary across versions" pad={false}><SummaryTable rows={CA_ROWS} /></Panel>
      </div>
      <Panel title="Compare" right={<div className="row"><select value={a} onChange={(e) => setA(e.target.value)}>{opts.map((o) => <option key={o}>{o}</option>)}</select>↔<select value={b} onChange={(e) => setB(e.target.value)}>{opts.map((o) => <option key={o}>{o}</option>)}</select><input placeholder="Form prefix (SchD, F8949.D…)" value={form} onChange={(e) => setForm(e.target.value)} style={{ width: 170 }} /><label className="row small"><input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />differences only</label></div>} pad={false}>
        <div style={{ maxHeight: 560, overflow: 'auto' }}>
          <table className="t"><thead><tr><th>Line</th><th>Label</th><th className="n">{a}</th><th className="n">{b}</th><th className="n">Δ</th></tr></thead><tbody>
            {rows.slice(0, 700).map((r) => <tr key={r.k} className="clickable" onClick={() => openTrace({ kind: 'line', key: r.k }, true)}><td className="k">{r.k}</td><td>{r.label}</td><td className="n">{lineValue(r.a, r.k)}</td><td className="n">{lineValue(r.b, r.k)}</td><td className="n">{typeof r.a === 'number' && typeof r.b === 'number' ? signed(r.b - r.a, /^F8949\.[A-Z]\.[A-Z]+\d/.test(r.k)) : ''}</td></tr>)}
          </tbody></table>
          {rows.length === 0 && <Empty>No differences.</Empty>}
        </div>
      </Panel>
    </div>
  );
}

// ---------- Depreciation ----------
export function Depreciation() {
  const { packet } = useStore();
  return (
    <div className="page">
      <div className="page-head"><div><h1>Depreciation by asset</h1><p>Method, life, bonus, federal vs California vs AMT, disposals and recapture. California does not allow federal bonus depreciation; the differences carry forward.</p></div></div>
      <DepreciationTable />
      <Panel title="Prior-year depreciation history (from the prior preparer's schedule)" pad={false}>
        <table className="t"><thead><tr><th>Asset</th><th>Method</th><th>Federal by year</th><th>California by year</th></tr></thead><tbody>
          {packet.prior_years.asset_records.map((a: any) => <tr key={a.asset_id}><td><b>{a.asset_id}</b> <span className="muted small">{a.description}</span></td><td className="small">{a.method}</td><td className="small">{Object.entries(a.federal).map(([y, v]: any) => `${y}: ${money(v, { cents: true })}`).join(' · ')}</td><td className="small">{Object.entries(a.california).map(([y, v]: any) => `${y}: ${money(v, { cents: true })}`).join(' · ')}</td></tr>)}
        </tbody></table>
      </Panel>
    </div>
  );
}

// ---------- Carryovers ----------
export function Carryovers() {
  const { packet, view, cmd } = useStore();
  const ix = usePacketIndex();
  if (!ix || !view) return null;
  const cin = packet.prior_years.carryovers_into_2025;
  const out = ix.versions.get(view.baseVersion).carryovers_out;
  const rows: [string, any, string, any][] = [
    ['Capital loss — short-term', cin.capital_loss_short, 'SchD.6', out.federal.capital_loss_short],
    ['Capital loss — long-term', cin.capital_loss_long, 'SchD.14', out.federal.capital_loss_long],
    ['Passive — 1450 Fremont Way', cin.passive_1450_fremont, 'F8582.1c', out.federal.passive_1450_fremont],
    ['Passive — 1200 Barton Hills Dr 4C', cin.passive_1200_barton_hills, 'F8582.1c', out.federal.passive_1200_barton_hills],
    ['IRA nondeductible basis (Ngozi)', 7000, 'F8606.2', out.federal.ira_nondeductible_basis_ngozi],
    ['Minimum tax credit (from 2025 AMT)', cin.amt_credit, 'F6251.11', out.federal.minimum_tax_credit_from_2025_amt],
    ['SEP contribution not deductible for 2025', 0, 'Sch1.16', out.federal.sep_contribution_not_deductible_for_2025],
    ['S corporation stock basis (end)', null, 'F7203.15', out.federal.scorp_stock_basis_end],
    ['Ridgeline capital account (end)', 60000, 'SchE.28B', out.federal.ridgeline_capital_account_end],
    ['Section 1231 losses', cin.section_1231_losses, 'F4797.8', 0],
    ['Charitable / NOL / FTC / QBI loss', 0, '', 0],
  ];
  return (
    <div className="page">
      <div className="page-head"><div><h1>Carryovers & basis</h1><p>What came in from 2024 (agreed to the prior return and the prior preparer's file), what 2025 used, and what goes out to 2026.</p></div></div>
      <Panel title="Federal" pad={false}>
        <table className="t"><thead><tr><th>Item</th><th className="n">In from 2024</th><th>2025 line</th><th className="n">Out to 2026 (engine {view.baseVersion})</th><th>Verified</th></tr></thead><tbody>
          {rows.map(([l, i, k, o]) => { const v = view.verifications.find((x: any) => x.target === k && x.type === 'agreed_to_prior_year'); return <tr key={l}><td>{l}</td><td className="n">{i == null ? <span className="muted">unknown</span> : money(i)}</td><td>{k && <><span className="mono small">{k}</span> <Num k={k} /></>}</td><td className="n">{o == null ? '—' : money(o)}</td><td>{v ? <span className="pill ok">✓ agreed to prior year</span> : k && ['SchD.6', 'SchD.14', 'F8582.1c', 'F8606.2'].includes(k) ? (readOnly(view) ? <span className="pill warn">to verify</span> : <button className="btn sm" onClick={() => cmd({ type: 'verification.record', target: k, verificationType: 'agreed_to_prior_year', note: 'Agreed to the 2024 return (D06) and the prior preparer carryover worksheet (D07 p6)' }, { success: `${k} verified` })}>Verify: agreed to prior year</button>) : ''}</td></tr>; })}
        </tbody></table>
        <div className="pb small muted">Sources: 2024 return D06 pages 6 and 9; prior preparer carryover worksheet D07 page 6. Verify each from the line's trace (“Verify → agreed to prior year”); the filing gate requires it.</div>
      </Panel>
      <Panel title="California" pad={false}>
        <table className="t"><tbody>
          <tr><td>Capital loss / passive in</td><td className="n">{money(cin.california.capital_loss_short + cin.california.capital_loss_long)} / {money(cin.california.passive_1450_fremont + cin.california.passive_1200_barton_hills)}</td><td className="small muted">{cin.california.note}</td></tr>
          {Object.entries(out.california.depreciation_basis_differences).map(([k, v]: any) => <tr key={k}><td>Depreciation basis difference {k}</td><td className="n">{money(v, { cents: true })}</td><td className="small muted">remaining California basis above federal</td></tr>)}
        </tbody></table>
      </Panel>
      <Panel title="Basis records by year"><div className="small">
        <div><b>S corporation (Woodworks):</b> 2022 21,300 (client worksheet) → 2023 15,400 (D40) → 2024 2,300 → 2025 0 with 21,215 distributions in excess taxed as capital gain. See Areas › S corporation.</div>
        <div style={{ marginTop: 4 }}><b>Ridgeline capital:</b> 60,000 → 63,660; outside basis never computed.</div>
        <div style={{ marginTop: 4 }}><b>Home:</b> 7709 Barton Ridge Dr purchased 2025-07-08 for 685,000 (D54).</div>
        <div style={{ marginTop: 4 }}><b>ISO shares:</b> 1,000 Corvane, regular basis 12,000, AMT basis 52,000.</div>
      </div><div style={{ marginTop: 8 }}><a href="#/rollforward">Roll forward to 2026 →</a></div></Panel>
    </div>
  );
}

// ---------- Payments vs agency records ----------
export function Payments() {
  const { packet, view, openTrace, cmd } = useStore();
  const verifyBtn = (k: string, note: string) => { const v = view?.verifications.find((x: any) => x.target === k && x.type === 'agreed_to_third_party_record'); return v ? <span className="pill ok">✓ agreed to agency record</span> : readOnly(view) ? null : <button className="btn sm" onClick={() => cmd({ type: 'verification.record', target: k, verificationType: 'agreed_to_third_party_record', note }, { success: `${k} verified` })}>Verify: agreed to agency record</button>; };
  const ix = usePacketIndex();
  if (!ix || !view) return null;
  const tr = packet.tax_agency_records.irs_account_transcript_2025.filter((s: any) => s.as_of <= view.meta.asOf.slice(0, 10)).at(-1);
  const eftps = (ix.evByDoc.get('D67') || []).filter((e: any) => /amount/.test(e.field));
  const ftb = (ix.evByDoc.get('D68') || []).filter((e: any) => /amount/.test(e.field));
  const fa = packet.tax_agency_records.ftb_account;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Payments vs IRS and FTB records</h1><p>Every payment on the return agreed to the taxpayer's confirmation and to the agency's own account. Client recollection is never the only source.</p></div></div>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <Panel title="Federal estimated payments" right={verifyBtn('F1040.26', 'Agreed to the IRS account transcript (code 670) and EFTPS confirmations')} pad={false}>
          <table className="t"><thead><tr><th>Date</th><th className="n">EFTPS confirmation (D67)</th><th className="n">Client said</th><th className="n">IRS transcript</th></tr></thead><tbody>
            {['2025-04-15', '2025-06-16', '2025-09-15', '2026-01-15'].map((d, i) => {
              const c = eftps[i];
              const t = tr?.transactions.find((x: any) => x.code === '670' && x.date === d);
              return <tr key={d}><td>{d}</td><td className="n">{c ? <span className="numlink" onClick={() => openTrace({ kind: 'doc', id: 'D67', ev: c.id })}>{money(c.value)}</span> : <span className="muted">none uploaded</span>}</td><td className="n">{i === 3 ? <><Ref r="qa-41" label="qa-41" /> 4,000 (01/14)</> : ''}</td><td className="n">{t ? money(t.amount) : '—'}</td></tr>;
            })}
            <tr className="total"><td>Return (ours)</td><td className="n" colSpan={2}><Num k="F1040.26" /></td><td className="n">{money(tr?.transactions.filter((x: any) => x.code === '670' && /Estimated/.test(x.description)).reduce((s: number, x: any) => s + x.amount, 0))}</td></tr>
            <tr><td>Extension payment</td><td className="n" colSpan={2}><Num k="Sch3.10" /></td><td className="n">{money(packet.tax_agency_records.irs_account_transcript_2025.at(-1).transactions.find((x: any) => /extension/i.test(x.description))?.amount ?? 36000)}</td></tr>
          </tbody></table>
          <div className="pb small muted">Transcript as of {tr?.as_of} (pulled by the firm, D69).</div>
        </Panel>
        <Panel title="California estimated payments" right={verifyBtn('F540NR.72', 'Agreed to the FTB account and Web Pay confirmations (designated year checked)')} pad={false}>
          <table className="t"><thead><tr><th>Date</th><th className="n">Web Pay (D68)</th><th>Designated year</th><th>FTB account</th></tr></thead><tbody>
            {ftb.map((e: any) => {
              const n = e.field.replace('_amount', '');
              const yr = (ix.evByDoc.get('D68') || []).find((x: any) => x.field === `${n}_year`)?.value;
              const dt = (ix.evByDoc.get('D68') || []).find((x: any) => x.field === `${n}_date`)?.value;
              const inAcct = fa.tax_year_2025_payments.find((x: any) => x.date === dt);
              const held = fa.tax_year_2024_payments_after_filing.find((x: any) => x.date === dt);
              return <tr key={e.id} style={yr === '2024' && dt >= '2025-04-01' ? { background: 'var(--warn-soft)' } : undefined}><td>{dt}</td><td className="n"><span className="numlink" onClick={() => openTrace({ kind: 'doc', id: 'D68', ev: e.id })}>{money(e.value)}</span></td><td>{yr}</td><td className="small">{inAcct ? '2025 ✓' : held ? <span className="t-high">{held.note}</span> : 'tax year 2024'}</td></tr>;
            })}
            <tr className="total"><td>Return (ours)</td><td className="n"><Num k="F540NR.72" /></td><td colSpan={2} className="small">FTB 2025 payments total {money(fa.tax_year_2025_payments.reduce((s: number, x: any) => s + x.amount, 0))}</td></tr>
          </tbody></table>
        </Panel>
      </div>
      <Panel title="Withholding" pad={false}><table className="t"><tbody><tr><td>Federal (W-2 box 2)</td><td className="n"><Num k="F1040.25a" /></td></tr><tr><td>Excess social security (two employers)</td><td className="n"><Num k="Sch3.11" /></td></tr><tr><td>California (W-2 box 17)</td><td className="n"><Num k="F540NR.71" /></td></tr></tbody></table></Panel>
      {view.payments.length > 0 && <Panel title="After filing" pad={false}><table className="t"><tbody>{view.payments.map((p: any, i: number) => <tr key={i}><td>{p.date}</td><td>{p.jurisdiction} {p.kind.replace('_', ' ')}</td><td className="n">{money(Math.abs(p.amount))}</td><td className="small muted">{p.note}</td></tr>)}</tbody></table></Panel>}
    </div>
  );
}

// ---------- Prior preparer vs us ----------
export function Prior() {
  const { packet, view, go } = useStore();
  const ix = usePacketIndex();
  if (!ix || !view) return null;
  const ppw = packet.prior_years.prior_preparer_workpaper;
  const items: [string, string, string, string?][] = [
    ['Home office', 'Simplified, 300 sq ft ("2 rooms combined?" — client to confirm)', 'Simplified; client measured 220 sq ft (Sacramento) and 260 (Austin) → average 240. 2024 overstated by 400 (immaterial).', 'PRIOR_PREPARER_OPEN_ITEM:2'],
    ['Self-employed health insurance', '0 — Erik was covered on Ngozi\'s employer plan', 'Engine deducted 14,400; we disallow it again: eligibility for the spouse\'s plan (qa-25) bars it.', 'SEHI_SUBSIDIZED_PLAN:Sch1.17'],
    ['Woodworks S-corp basis', '2023 K-1 missing; "assumed basis sufficient" in 2024', 'Rolled forward with the 2023 K-1 (D40): 2024 ended at 2,300; 2025 distributions exceed basis by 21,215 (capital gain).', 'PRIOR_PREPARER_OPEN_ITEM:0'],
    ['IRA basis (Form 8606)', '7,000 "per client"; Form 5498 not obtained', 'Form 5498 for 2024 now in file (D42) confirms 7,000; the client\'s 2025 answer saying "no prior basis" is wrong.', 'CLIENT_ANSWER_CONFLICT:qa-31'],
    ['Foreign account', 'FBAR "filed by client separately"; Form 8938 filed (max 151,880)', 'FBAR identified as an outside filing for 2025; Form 8938 required again (year-end 123,254).', 'FBAR_REQUIRED:D36'],
    ['Form 3520 (2023 inheritance)', 'Open item: "discussed? (no note of resolution)"', 'Still unresolved: flagged as a high-severity outside filing with a drafted client question.', 'FOREIGN_GIFT_INHERITANCE:D36'],
    ['Foreign interest exchange rate', '2024 interest at the 2024 average 10.56 (correct for 2024)', 'The engine reused 10.56 for 2025; the 2025 average is 9.86.', 'FX_RATE_PERIOD:SchB.1.6'],
    ['Mileage', 'Standard mileage, 7,400 business miles', 'Standard mileage; 8,100 miles after removing the duplicate scanned page (engine had 11,800).', 'DUPLICATE_PAGE:D23:2:3'],
    ['Depreciation', 'Appliances 100% bonus federal; CA 5-yr 200DB', 'Same methods continued; CA remaining basis 241.92 on the appliances carries to 2026.'],
  ];
  return (
    <div className="page">
      <div className="page-head"><div><h1>Prior preparer vs us</h1><p>What Delta River Tax Services did for 2024 (D06, D07), and what we changed or carried forward. Their open items are tracked to resolution.</p></div></div>
      <Panel title="Positions and methods" pad={false}>
        <table className="t"><thead><tr><th>Topic</th><th>2024 (prior preparer)</th><th>2025 (this workpaper)</th><th /></tr></thead><tbody>
          {items.map(([t, a, b, f]) => { const fi = f && view.findings.find((x: any) => x.id === f); return <tr key={t}><td><b>{t}</b></td><td className="small">{a}</td><td className="small">{b}</td><td>{fi && <a href={`#/findings/${encodeURIComponent(fi.id)}`}><Status s={fi.status} /></a>}</td></tr>; })}
        </tbody></table>
      </Panel>
      <div className="grid2" style={{ marginTop: 12, alignItems: 'start' }}>
        <Panel title="Prior preparer's notes"><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{ppw.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul><div className="small muted" style={{ marginTop: 6 }}>{ppw.summary_memo}</div></Panel>
        <Panel title="Open items they left">{ppw.open_items_left_by_prior_preparer.map((t: string, i: number) => { const f = view.findings.find((x: any) => x.id === `PRIOR_PREPARER_OPEN_ITEM:${i}`); return <div key={i} className="list-row" onClick={() => f && go(`#/findings/${encodeURIComponent(f.id)}`)}><div style={{ flex: 1 }}><div className="title">{t}</div><div className="small muted">{f?.summary}</div></div>{f && <Status s={f.status} />}</div>; })}</Panel>
      </div>
      <Panel title="2024 return vs 2025 (ours), line by line" pad={false}><SummaryTable rows={FED_ROWS} showVersions={false} /></Panel>
    </div>
  );
}

// ---------- Completeness ----------
const TOPICS: [string, string][] = [
  ['wages', 'Wages, W-2s (two employers, duplicate photo)'], ['stock', 'Stock compensation: RSU, ESPP, ISO'], ['interest', 'Interest & dividends (incl. K-1 and foreign)'], ['sales', 'Brokerage sales (282 lots, corrected 1099)'], ['crypto', 'Digital assets (1099-DA, CSV)'],
  ['retirement', 'IRA / backdoor Roth / SEP'], ['hsa', 'HSA'], ['business', 'Schedule C business (books, 1099s, mileage, home office, equipment)'], ['rentals', 'Rental properties & passive losses'], ['sale', 'Sale of rental (Form 4797)'],
  ['scorp', 'S corporation K-1 and basis'], ['partnership', 'Partnership K-1 and capital'], ['foreign', 'Foreign accounts, 8938, FBAR, 3520'], ['charity', 'Charitable gifts (cash, stock, vehicle)'], ['mortgage', 'Home purchase, mortgage, refinance, property tax'],
  ['dependents', 'Dependents, CTC/ODC, due diligence'], ['education', 'Education (1098-T, scholarship, AOTC)'], ['childcare', 'Dependent care (two providers, FSA)'], ['payments', 'Estimated, extension and withholding payments'], ['california', 'California part-year allocation and AMT'],
  ['other_states', 'Other states (Oregon, Arizona composites; Texas, Nevada none)'], ['alimony', 'Alimony, gambling, unemployment, Social Security'], ['energy', 'Energy / EV credits'], ['household_employees', 'Household employees (Schedule H)'], ['gift_tax', 'Gift tax returns (Form 709)'], ['identity', 'Identity protection PIN, identity verification'],
];

export function Completeness() {
  const { view, cmd } = useStore();
  if (!view) return null;
  const ro = readOnly(view);
  const counts: Record<string, number> = {};
  for (const d of view.documents) counts[d.status] = (counts[d.status] ?? 0) + 1;
  const out = view.findings.filter((f: any) => f.kind === 'outside_filing');
  return (
    <div className="page">
      <div className="page-head"><div><h1>Completeness</h1><p>Every document accounted for, every area considered, every outside filing identified.</p></div></div>
      <div className="grid3">
        <Panel title="Documents accounted for"><div className="small">{Object.entries(counts).map(([k, v]) => <div key={k} className="row"><Status s={k} /><span className="spacer" /><b>{v}</b></div>)}</div><div className="small muted" style={{ marginTop: 6 }}>Every document has a status and, when it was not used, the reason. <a href="#/documents">Index →</a></div></Panel>
        <Panel title="Outside filings identified">{out.map((f: any) => <div key={f.id} className="small" style={{ marginBottom: 4 }}><a href={`#/findings/${encodeURIComponent(f.id)}`}>{f.title}</a></div>)}<div className="small muted">Plus: Ada's own 2025 return (related, consistent).</div></Panel>
        <Panel title="Required steps">{view.steps.map((s: any) => <div key={s.step} className="row small" style={{ padding: '2px 0' }}><span>{s.done ? '✅' : '⬜'}</span><span style={{ flex: 1 }}>{s.step}</span>{s.auto ? <span className="tiny muted">auto</span> : !ro && !s.done && <button className="btn sm" onClick={() => cmd({ type: 'step.complete', step: s.step, note: 'Completed in the workpaper' })}>Done</button>}</div>)}</Panel>
      </div>
      <Panel title="Every area considered" pad={false}>
        <table className="t"><thead><tr><th>Topic</th><th>Status</th><th>Note</th><th /></tr></thead><tbody>
          {TOPICS.map(([k, label]) => {
            const st = view.areaStatus[`topic:${k}`];
            return <tr key={k}><td>{label}</td><td>{st ? <span className={`pill ${st.status === 'not_applicable' ? '' : 'ok'}`}>{st.status.replace('_', ' ')}</span> : <span className="pill warn">not marked</span>}</td><td className="small">{st?.note}{st && <> · <Who id={st.actor} /></>}</td>
              <td>{!ro && <><button className="btn sm" onClick={() => cmd({ type: 'area.status', area: `topic:${k}`, status: 'considered', note: 'Considered; see the related area' })}>Considered</button> <button className="btn sm" onClick={() => { const note = prompt('Why not applicable?'); if (note) cmd({ type: 'area.status', area: `topic:${k}`, status: 'not_applicable', note }); }}>N/A…</button></>}</td></tr>;
          })}
        </tbody></table>
      </Panel>
    </div>
  );
}
