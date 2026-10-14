import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore, usePacketIndex } from '../store';
import { Num, Panel, Ref, Masked, readOnly } from '../components/ui';
import { lineValue, money, signed, pct } from '../../shared/format';

const ev = (ix: any, doc: string, field: string) => (ix.evByDoc.get(doc) || []).find((e: any) => e.field === field);
const evv = (ix: any, doc: string, field: string) => Number(ev(ix, doc, field)?.value ?? 0);
const docsOfType = (ix: any, t: string) => [...ix.docs.values()].filter((d: any) => d.document_type === t);
const lv = (view: any, ix: any, k: string) => { const o = view.ours.lines[k]; const b = ix.lines.get(view.baseVersion)?.get(k); return o ? o.value : b?.value; };
const EvCell = ({ id }: { id?: string }) => {
  const ix = usePacketIndex();
  const { openTrace } = useStore();
  const e = id ? ix?.ev.get(id) : null;
  if (!e) return <span className="muted">—</span>;
  return <span className="numlink" title={`${e.id} · ${e.label} · ${Math.round(e.confidence * 100)}%`} onClick={() => openTrace({ kind: 'doc', id: e.document_id, ev: e.id, page: e.page })}>{typeof e.value === 'number' ? money(e.value, { cents: e.value % 1 !== 0 }) : String(e.value)}</span>;
};

function LinesTable({ keys, title }: { keys: string[]; title?: string }) {
  const { view } = useStore();
  const ix = usePacketIndex();
  return (
    <table className="t">{title && <thead><tr><th colSpan={3}>{title}</th></tr></thead>}<tbody>
      {keys.map((k) => { const l = ix?.lines.get(view.baseVersion)?.get(k) ?? view.ours.added.find((x: any) => x.key === k); if (!l) return null; return <tr key={k} className={view.ours.lines[k] ? 'changed' : ''}><td className="k">{k}</td><td>{l.label}</td><td className="n"><Num k={k} /></td></tr>; })}
    </tbody></table>
  );
}

// ---------- Virtualized table ----------
type VRow = { type: 'group'; label: string; sub?: ReactNode } | { type: 'row'; cells: ReactNode[]; key: string; flag?: boolean };
export function VirtualTable({ cols, rows, height = 520, rowH = 30, header }: { cols: string; rows: VRow[]; height?: number; rowH?: number; header: ReactNode[] }) {
  const [top, setTop] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const start = Math.max(0, Math.floor(top / rowH) - 10);
  const end = Math.min(rows.length, start + Math.ceil(height / rowH) + 20);
  return (
    <div ref={ref} className="vt" style={{ height }} onScroll={(e) => setTop((e.target as HTMLDivElement).scrollTop)}>
      <div className="vt-row vt-head" style={{ gridTemplateColumns: cols, height: rowH }}>{header.map((h, i) => <div key={i}>{h}</div>)}</div>
      <div style={{ height: rows.length * rowH, position: 'relative' }}>
        {rows.slice(start, end).map((r, i) => {
          const y = (start + i) * rowH;
          if (r.type === 'group') return <div key={`g${start + i}`} className="vt-row vt-group" style={{ gridTemplateColumns: '1fr auto', height: rowH, position: 'absolute', top: y, left: 0, right: 0 }}><div>{r.label}</div><div className="small">{r.sub}</div></div>;
          return <div key={r.key} className="vt-row" style={{ gridTemplateColumns: cols, height: rowH, position: 'absolute', top: y, left: 0, right: 0, background: r.flag ? 'var(--warn-soft)' : undefined }}>{r.cells.map((c, j) => <div key={j} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c}</div>)}</div>;
        })}
      </div>
    </div>
  );
}

// ---------- Wages & stock compensation ----------
function Wages() {
  const { view } = useStore();
  const ix = usePacketIndex()!;
  const w2s = docsOfType(ix, 'W-2');
  const boxes = [['box1', 'Box 1 wages'], ['box2', 'Box 2 fed w/h'], ['box3', 'Box 3 SS wages'], ['box4', 'Box 4 SS tax'], ['box5', 'Box 5 Medicare'], ['box10', 'Box 10 dep. care'], ['box12_D', '12 D 401(k)'], ['box12_W', '12 W HSA'], ['box16', 'Box 16 CA wages'], ['box17', 'Box 17 CA tax']];
  const dupOf = (d: any) => view.documents.find((x: any) => x.id === d.id)?.status === 'duplicate';
  const distinct = w2s.filter((d: any) => !dupOf(d));
  const ssMax = ix.params.ss_wage_base * 0.062;
  const ssWithheld = distinct.reduce((s: number, d: any) => s + evv(ix, d.id, 'box4'), 0);
  const sup = docsOfType(ix, 'stock_plan_supplement')[0];
  const lots = ['N1', 'N3', 'N4', 'N2'];
  return (
    <div className="col" style={{ gap: 12 }}>
      <Panel title="Forms W-2" right={<span className="small muted">Σ box 1 of distinct W-2s = <Num k="F1040.1a" /></span>} pad={false}>
        <table className="t"><thead><tr><th>Doc</th><th>Employer</th>{boxes.map(([, l]) => <th key={l} className="n">{l}</th>)}<th /></tr></thead><tbody>
          {w2s.map((d: any) => <tr key={d.id} style={dupOf(d) ? { opacity: 0.55 } : undefined}><td><Ref r={d.id} label={d.id} /></td><td>{d.issuer}</td>{boxes.map(([b]) => <td key={b} className="n"><EvCell id={ev(ix, d.id, b)?.id} /></td>)}<td>{dupOf(d) && <span className="pill">duplicate photo — counted once</span>}</td></tr>)}
        </tbody></table>
        <div className="pb small">
          Box 3 − box 1 reconciles to pre-tax 401(k) + HSA for each employer: {distinct.map((d: any) => `${d.issuer.split(' ')[0]} ${money(evv(ix, d.id, 'box3') - evv(ix, d.id, 'box1'))} = 12D ${money(evv(ix, d.id, 'box12_D'))}${evv(ix, d.id, 'box3') - evv(ix, d.id, 'box1') === evv(ix, d.id, 'box12_D') ? ' ✓' : ''}`).join(' · ')}.
          {' '}Excess social security: withheld {money(ssWithheld)} − maximum {money(ssMax, { cents: true })} = <Num k="Sch3.11" /> refundable (two employers).
        </div>
      </Panel>
      <Panel title="Stock compensation — broker 1099-B vs the stock plan supplement" pad={false}>
        <table className="t"><thead><tr><th>Lot</th><th>Description</th><th>Acquired</th><th>Sold</th><th className="n">Proceeds</th><th className="n">Broker basis</th><th className="n">Supplement basis</th><th className="n">Gain on return</th></tr></thead><tbody>
          {lots.map((id) => {
            const l = [...ix.lines.get(view.baseVersion)!.values()].find((x: any) => x.key.endsWith(`.${id}`));
            const supLot = id === 'N1' ? 'RSU-2502' : id === 'N3' ? 'RSU-2505' : id === 'N4' ? 'RSU-2308' : 'ESPP-2406';
            return <tr key={id}><td className="k">{id}</td><td>{ix.ev.get(l.sources[0])?.value}</td><td><EvCell id={l.sources.find((s: string) => /acquired/.test(ix.ev.get(s)?.field))} /></td><td><EvCell id={l.sources.find((s: string) => /_sold/.test(ix.ev.get(s)?.field))} /></td><td className="n"><EvCell id={l.sources.find((s: string) => /proceeds/.test(ix.ev.get(s)?.field))} /></td><td className="n"><EvCell id={l.sources.find((s: string) => /_basis/.test(ix.ev.get(s)?.field))} /></td><td className="n"><EvCell id={ev(ix, sup.id, `${supLot}_adjusted_basis`)?.id} /></td><td className="n"><Num k={l.key} cents /></td></tr>;
          })}
        </tbody></table>
        <div className="pb small">W-2 box 14 RSU <EvCell id={ev(ix, 'D08', 'box14_RSU')?.id} /> = the two 2025 vests (2 × 19,100) already in wages. ESPP disqualifying disposition: ordinary income <EvCell id={ev(ix, sup.id, 'ESPP-2406_ordinary')?.id} /> in W-2 box 14, adjustment code B on lot N2.</div>
      </Panel>
      <Panel title="Incentive stock option exercise (Form 3921) — AMT">
        <div className="kv small">
          {(() => { const d = docsOfType(ix, '3921')[0]; return <>
            <div>Granted / exercised</div><div><EvCell id={ev(ix, d.id, 'box1')?.id} /> / <EvCell id={ev(ix, d.id, 'box2')?.id} /></div>
            <div>Shares × (FMV − price)</div><div><EvCell id={ev(ix, d.id, 'box5')?.id} /> × (<EvCell id={ev(ix, d.id, 'box4')?.id} /> − <EvCell id={ev(ix, d.id, 'box3')?.id} />) = <Num k="F6251.2i" /> AMT preference (shares still held, qa-06)</div>
            <div>Federal AMT</div><div><Num k="F6251.11" /> → minimum tax credit carryforward</div>
            <div>California AMT</div><div><Num k="F540NR.61" /> — <span className="t-high">not computed by the engine; see the California AMT finding</span></div>
            <div>Basis to carry</div><div>Regular {money(evv(ix, d.id, 'box3') * evv(ix, d.id, 'box5'))} · AMT {money(evv(ix, d.id, 'box4') * evv(ix, d.id, 'box5'))}</div>
          </>; })()}
        </div>
      </Panel>
    </div>
  );
}

// ---------- Investments & digital assets ----------
function Investments() {
  const { view, openTrace } = useStore();
  const ix = usePacketIndex()!;
  const [mode, setMode] = useState<'all' | 'flagged'>('all');
  const lines = [...ix.lines.get(view.baseVersion)!.values()];
  const added = view.ours.added;
  const lots = [...lines, ...added].filter((l: any) => /^F8949\.[A-Z]\.[A-Z]+\d+$/.test(l.key) || /^F8949\.[A-Z]\.SCORP$/.test(l.key));
  const brokerOf = (l: any) => { const e = ix.ev.get(l.sources?.[0]); return e ? ix.docs.get(e.document_id)?.issuer : l.key.includes('SCORP') ? 'S corporation (Form 7203)' : 'Workpaper-added'; };
  const flagged = (l: any) => /basis 0\.00/.test(l.label) || /adjustment W/.test(l.label) || !!view.ours.lines[l.key] || l.rule === 'R-WORKPAPER-ADDED';
  const groups = new Map<string, any[]>();
  for (const l of lots) { if (mode === 'flagged' && !flagged(l)) continue; const g = `${brokerOf(l)} · box ${l.key.split('.')[1]}`; if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(l); }
  const rows: VRow[] = [];
  for (const [g, ls] of [...groups.entries()].sort()) {
    const tot = ls.reduce((s, l) => s + Number(view.ours.lines[l.key]?.value ?? l.value), 0);
    rows.push({ type: 'group', label: `${g} — ${ls.length} lots`, sub: `gain ${money(tot, { cents: true })}` });
    for (const l of ls) {
      const m = l.label.match(/^(.*) \(acquired ([^,]+), sold ([\d-]+); proceeds ([\d,.]+), basis ([\d,.]+)(?:, adjustment ([A-Z]) (-?[\d,.]+))?\)$/) || [];
      rows.push({ type: 'row', key: l.key, flag: /basis 0\.00/.test(l.label), cells: [<span className="mono tiny" key="k">{l.key.split('.').slice(1).join('.')}</span>, m[1] ?? l.label, m[2], m[3], <span key="p" className="num">{m[4]}</span>, <span key="b" className="num">{m[5]}</span>, <span key="a" className="num">{m[6] ? `${m[6]} ${m[7]}` : ''}</span>, <span key="g" className="num"><Num k={l.key} cents /></span>] });
    }
  }
  const composites = docsOfType(ix, '1099-composite');
  return (
    <div className="col" style={{ gap: 12 }}>
      <Panel title="Broker summary vs lot detail" pad={false}>
        <table className="t"><thead><tr><th>Statement</th><th>Status</th><th className="n">Summary proceeds</th><th className="n">Extracted lots</th><th className="n">Lot proceeds</th><th className="n">Difference</th><th>Explanation</th></tr></thead><tbody>
          {composites.map((d: any) => {
            const evs = ix.evByDoc.get(d.id) || [];
            const sums = evs.filter((e: any) => /(^b_summary_proceeds$|^(st|lt)_proceeds$)/.test(e.field));
            const summary = sums.reduce((s: number, e: any) => s + Number(e.value), 0) || (evv(ix, d.id, 'b_summary_proceeds'));
            const p2 = d.id === 'D28' ? (ix.docs.get(d.id).pages[1].printed_content.match(/proceeds ([\d,.]+)/g) || []).reduce((s: number, x: string) => s + Number(x.replace(/[^\d.]/g, '')), 0) : 0;
            const sumTotal = summary || p2;
            const lotsP = evs.filter((e: any) => /^[A-Z]\d+_proceeds$/.test(e.field));
            const tot = lotsP.reduce((s: number, e: any) => s + Number(e.value), 0);
            const st = view.documents.find((x: any) => x.id === d.id);
            const gap = Math.round((sumTotal - tot) * 100) / 100;
            const f = view.findings.find((x: any) => x.id === `BROKER_SUMMARY_DETAIL:${d.id}`);
            return <tr key={d.id}><td><Ref r={d.id} /></td><td>{st ? st.status : 'not received'}</td><td className="n">{money(sumTotal, { cents: true })}</td><td className="n">{lotsP.length}</td><td className="n">{money(tot, { cents: true })}</td><td className={`n ${gap ? 't-high' : ''}`}>{gap ? money(gap, { cents: true }) : '✓'}</td><td className="small">{gap ? (f ? <a href={`#/findings/${encodeURIComponent(f.id)}`}>{f.title}</a> : st?.status === 'superseded' ? 'superseded by the corrected statement' : '') : 'agrees'}</td></tr>;
          })}
        </tbody></table>
      </Panel>
      <Panel title={`Form 8949 — ${lots.length} dispositions (282 broker lots, 12 digital assets, S-corp excess distribution${added.length ? ', workpaper-added lots' : ''})`} right={<div className="seg"><button className={mode === 'all' ? 'on' : ''} onClick={() => setMode('all')}>All</button><button className={mode === 'flagged' ? 'on' : ''} onClick={() => setMode('flagged')}>Needs attention</button></div>} pad={false}>
        <VirtualTable cols="92px 1.6fr 92px 92px 100px 100px 90px 110px" rows={rows} header={['Lot', 'Description', 'Acquired', 'Sold', 'Proceeds', 'Basis', 'Adj', 'Gain/(loss)']} />
        <div className="pb small muted">Box totals: {['A', 'B', 'D', 'E', 'F', 'H', 'K'].map((b) => <span key={b} style={{ marginRight: 10 }}>{b} <Num k={`F8949.${b}.total`} /></span>)} → Schedule D <a onClick={() => openTrace({ kind: 'line', key: 'SchD.16' })}>line 16</a> <Num k="SchD.16" /></div>
      </Panel>
      <Panel title="Interest and dividends by payer" pad={false}><LinesTable keys={lines.filter((l: any) => /^SchB\.(1\.\d|5\.\d|2|6)$/.test(l.key)).map((l: any) => l.key)} /></Panel>
    </div>
  );
}

// ---------- Schedule C ----------
function Business() {
  const { view } = useStore();
  const ix = usePacketIndex()!;
  const pl = docsOfType(ix, 'books_profit_loss')[0];
  const b = (label: string) => (ix.evByDoc.get(pl.id) || []).find((e: any) => e.label === label);
  const v = (k: string) => Number(lv(view, ix, k) ?? 0);
  const bridge: [string, string | null, number, string, string][] = [
    ['Sales — client projects + print/licensing', 'total_income', v('SchC.1'), 'SchC.1', 'Engine adds Form 1099-K receipts it could not match to a deposit'],
    ['Advertising', 'Advertising', v('SchC.8'), 'SchC.8', ''],
    ['Car and truck — fuel', 'Car and truck - fuel', v('SchC.9'), 'SchC.9', 'Actual fuel replaced by standard mileage (business miles × rate)'],
    ['Contract labor', 'Contract labor', v('SchC.11'), 'SchC.11', ''],
    ['Depreciation (books: straight-line 5 yr)', 'Depreciation', v('SchC.13'), 'SchC.13', 'Tax: 100% special depreciation on 38,000 of equipment'],
    ['Insurance — business liability', 'Insurance - business liability', v('SchC.15'), 'SchC.15', ''],
    ['Insurance — health (Erik)', 'Insurance - health (Erik)', 0, 'Sch1.17', 'Moved out of Schedule C to the SE health insurance deduction'],
    ['Telephone + internet', null, v('SchC.25'), 'SchC.25', 'Books 2,160 + 1,320'],
    ['Legal and professional', 'Legal and professional', v('SchC.17'), 'SchC.17', ''],
    ['Meals', 'Meals', v('SchC.24b'), 'SchC.24b', '50% limit'],
    ['Office expenses', 'Office expenses', v('SchC.18'), 'SchC.18', ''],
    ['Software and subscriptions', 'Software and subscriptions', v('SchC.27a.1'), 'SchC.27a.1', ''],
    ['Bank and merchant fees', 'Bank and merchant fees', v('SchC.27a.2'), 'SchC.27a.2', ''],
    ['Supplies', 'Supplies', v('SchC.22'), 'SchC.22', ''],
    ['Travel', 'Travel', v('SchC.24a'), 'SchC.24a', ''],
    ['Home office (not in books)', null, v('SchC.30'), 'SchC.30', 'Simplified method'],
  ];
  const booksAmt = (row: any) => (row[1] === 'total_income' ? evv(ix, pl.id, 'total_income') : row[1] ? Number(b(row[1])?.value ?? 0) : row[0].startsWith('Telephone') ? Number(b('Telephone')?.value ?? 0) + Number(b('Internet')?.value ?? 0) : 0);
  const mileage = docsOfType(ix, 'mileage_log')[0];
  const pageTotals = (ix.evByDoc.get(mileage.id) || []).filter((e: any) => e.field === 'page_total');
  const dup = view.documents.find((x: any) => x.id === mileage.id)?.duplicatePages ?? [];
  return (
    <div className="col" style={{ gap: 12 }}>
      <Panel title="Books to tax — QuickBooks P&L to Schedule C" pad={false}>
        <table className="t"><thead><tr><th>Books account</th><th className="n">Books</th><th className="n">Tax return</th><th className="n">Difference</th><th>Line</th><th>Why</th></tr></thead><tbody>
          {bridge.map((r) => { const bk = booksAmt(r); return <tr key={r[0]}><td>{r[0]}</td><td className="n">{r[1] ? <EvCell id={r[1] === 'total_income' ? ev(ix, pl.id, 'total_income')?.id : b(r[1])?.id} /> : bk ? money(bk) : '—'}</td><td className="n"><Num k={r[3]} value={r[3] === 'Sch1.17' ? 0 : undefined} /></td><td className="n">{signed(r[2] - bk)}</td><td className="k">{r[3]}</td><td className="small muted">{r[4]}</td></tr>; })}
          <tr className="total"><td>Net income → net profit</td><td className="n"><EvCell id={ev(ix, pl.id, 'net_income')?.id} /></td><td className="n"><Num k="SchC.31" /></td><td className="n">{signed(v('SchC.31') - evv(ix, pl.id, 'net_income'))}</td><td className="k">SchC.31</td><td /></tr>
        </tbody></table>
      </Panel>
      <div className="grid2">
        <Panel title="Gross receipts reconciliation">
          {(() => { const necs = docsOfType(ix, '1099-NEC'); const nt = necs.reduce((s: number, d: any) => s + evv(ix, d.id, 'box1'), 0); const det = docsOfType(ix, 'books_transaction_detail')[0]; const k = docsOfType(ix, '1099-K')[0]; return <table className="t"><tbody>
            {necs.map((d: any) => <tr key={d.id}><td>1099-NEC {d.issuer}</td><td className="n"><EvCell id={ev(ix, d.id, 'box1')?.id} /></td></tr>)}
            <tr className="total"><td>Forms 1099-NEC</td><td className="n">{money(nt)}</td></tr>
            <tr><td>Deposits from clients with no 1099</td><td className="n"><EvCell id={ev(ix, det.id, 'unreported_small')?.id} /></td></tr>
            <tr className="total"><td>= Books revenue</td><td className="n">{money(nt + evv(ix, det.id, 'unreported_small'))} {nt + evv(ix, det.id, 'unreported_small') === evv(ix, pl.id, 'total_income') ? '✓' : '✗'}</td></tr>
            <tr><td>1099-K {k.issuer} (inside Atlas's <EvCell id={ev(ix, det.id, 'atlas_total')?.id} />: <EvCell id={ev(ix, det.id, 'atlas_paywell')?.id} /> by card)</td><td className="n"><EvCell id={ev(ix, k.id, 'box1a')?.id} /></td></tr>
            <tr className="total"><td>Schedule C line 1 (ours)</td><td className="n"><Num k="SchC.1" /></td></tr></tbody></table>; })()}
        </Panel>
        <Panel title="Vehicle — mileage log pages">
          <table className="t"><tbody>
            {pageTotals.map((e: any) => <tr key={e.id} style={dup.includes(e.page) ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}><td>Page {e.page}{dup.includes(e.page) ? ' — second scan of page 2' : ''}</td><td className="n"><EvCell id={e.id} /></td></tr>)}
            <tr className="total"><td>Business miles (ours)</td><td className="n"><Num k="SchC.44a" /></td></tr>
            <tr><td>× standard rate {ix.params.mileage_rate}</td><td className="n"><Num k="SchC.9" /></td></tr>
            <tr><td>Odometer {money(evv(ix, mileage.id, 'odometer_start'))} → {money(evv(ix, mileage.id, 'odometer_end'))}: other miles</td><td className="n"><Num k="SchC.44c" /></td></tr>
          </tbody></table>
        </Panel>
      </div>
      <div className="grid2">
        <Panel title="Home office (simplified)"><div className="small">Sacramento studio <EvCell id={ev(ix, 'D24', 'sac_sqft')?.id} /> sq ft Jan–mid-July; Austin <EvCell id={ev(ix, 'D24', 'aus_sqft')?.id} /> sq ft from <EvCell id={ev(ix, 'D24', 'aus_start')?.id} />. Average ≈ 240 × $5 = <Num k="SchC.30" />. 2024 used 300 sq ft (prior preparer note: "client to confirm").</div></Panel>
        <Panel title="SE tax, retirement, QBI" pad={false}><LinesTable keys={['SchSE.4a', 'SchSE.12', 'SchSE.13', 'Sch1.16', 'Sch1.17', 'F8995.2.1', 'F8995.15.1', 'F8995.39']} /></Panel>
      </div>
    </div>
  );
}

// ---------- Rentals & sale ----------
function Rentals() {
  const { view } = useStore();
  const ix = usePacketIndex()!;
  const rows = [['3', 'Rents'], ['9', 'Insurance'], ['11', 'Management fees'], ['12', 'Mortgage interest'], ['14', 'Repairs'], ['16', 'Taxes'], ['18', 'Depreciation'], ['19', 'Other (HOA)'], ['20', 'Total expenses'], ['21', 'Income or (loss)'], ['22', 'After passive limits']];
  return (
    <div className="col" style={{ gap: 12 }}>
      <Panel title="Schedule E — rental properties" pad={false}>
        <table className="t"><thead><tr><th>Line</th><th className="n">A: 1450 Fremont Way, Sacramento (CA-source)</th><th className="n">B: 1200 Barton Hills Dr 4C, Austin (sold)</th></tr></thead><tbody>
          <tr><td>Days rented / personal</td><td className="n">{lv(view, ix, 'SchE.2A')}</td><td className="n">{lv(view, ix, 'SchE.2B')}</td></tr>
          {rows.map(([n, l]) => <tr key={n} className={['20', '21', '22'].includes(n) ? 'total' : ''}><td>{l}</td><td className="n">{ix.lines.get(view.baseVersion)!.has(`SchE.${n}A`) ? <Num k={`SchE.${n}A`} /> : '—'}</td><td className="n">{ix.lines.get(view.baseVersion)!.has(`SchE.${n}B`) ? <Num k={`SchE.${n}B`} /> : '—'}</td></tr>)}
        </tbody></table>
      </Panel>
      <div className="grid2">
        <Panel title="Passive activity (Form 8582)" pad={false}><LinesTable keys={['F8582.1a', 'F8582.1b', 'F8582.1c', 'F8582.3a', 'F8582.4', 'SchE.26']} /><div className="pb small muted">Net passive income is positive and the condo was fully disposed of, so all current and suspended losses (6,300 + 9,850 from 2024) are allowed.</div></Panel>
        <Panel title="Sale of the Austin condo (Form 4797)" pad={false}><LinesTable keys={['F4797.21', 'F4797.22', 'F4797.23', 'F4797.24', 'F4797.25', 'F4797.26g', 'SchD.19']} /><div className="pb small muted">Basis 310,000 purchase (land 62,000) + flooring 6,600 + commissions 21,725 + title 1,975. Straight-line residential: no §1250 ordinary recapture; 50,340 unrecaptured §1250 gain taxed at up to 25%.</div></Panel>
      </div>
      <DepreciationTable filter={(a: any) => /Rental/.test(a.activity)} />
    </div>
  );
}

export function DepreciationTable({ filter }: { filter?: (a: any) => boolean }) {
  const { view } = useStore();
  const ix = usePacketIndex()!;
  const assets = ix.versions.get(view.baseVersion).assets.filter((a: any) => !filter || filter(a));
  const hvac = view.adjustments.find((a: any) => ['pending', 'approved'].includes(a.status) && a.whatIf === 'hvac_improvement');
  return (
    <Panel title="Depreciation by asset — federal vs California vs AMT" pad={false}>
      <table className="t"><thead><tr><th>Asset</th><th>Placed in service</th><th>Method / life</th><th className="n">Cost</th><th className="n">Fed prior</th><th className="n">Fed 2025</th><th className="n">CA 2025</th><th className="n">AMT 2025</th><th className="n">Fed accumulated</th><th className="n">CA accumulated</th><th>Disposal / recapture</th></tr></thead><tbody>
        {assets.map((a: any) => {
          const caOurs = view.ours.lines[`FTB3885A.${a.asset_id}`]?.value;
          return <tr key={a.asset_id}><td><b>{a.asset_id}</b><div className="tiny muted">{a.description}</div></td><td>{a.placed_in_service}</td><td className="small">{a.method} / {a.life_years}y</td><td className="n">{money(a.cost)}{a.land_value_not_depreciated ? <div className="tiny muted">land {money(a.land_value_not_depreciated)}</div> : null}</td>
            <td className="n">{money(a.federal.prior_accumulated, { cents: true })}</td><td className="n">{money(a.federal.depreciation_2025, { cents: true })}</td><td className="n">{caOurs !== undefined ? <b className="t-info">{money(caOurs)}</b> : money(a.california.depreciation_2025, { cents: true })}</td><td className="n">{money(a.amt.depreciation_2025, { cents: true })}</td>
            <td className="n">{money(a.federal.accumulated_end, { cents: true })}</td><td className="n">{money(a.california.accumulated_end, { cents: true })}</td>
            <td className="small">{a.disposition ? <>Sold {a.disposition.date}; unrecaptured §1250 {money(a.disposition.unrecaptured_1250_depreciation, { cents: true })}; §1250 ordinary {money(a.disposition.section_1250_ordinary_recapture)}</> : '—'}</td></tr>;
        })}
        {hvac && (!filter || filter({ activity: 'Rental' })) && <tr className="changed"><td><b>SAC-HVAC</b><div className="tiny muted">Heat pump system (capitalized by {hvac.id})</div></td><td>2025-08-12</td><td className="small">SL / mid-month 27.5y</td><td className="n">11,000</td><td className="n">0.00</td><td className="n">150.00</td><td className="n">150.00</td><td className="n">150.00</td><td className="n">150.00</td><td className="n">150.00</td><td>—</td></tr>}
      </tbody></table>
    </Panel>
  );
}

// ---------- S corporation & partnership ----------
function Passthroughs() {
  const { view } = useStore();
  const ix = usePacketIndex()!;
  const k1s = docsOfType(ix, 'K-1-1120S').sort((a: any, b: any) => a.tax_year - b.tax_year);
  const k23 = k1s.find((d: any) => d.tax_year === 2023);
  const k25 = k1s.find((d: any) => d.tax_year === 2025);
  const b23 = 21300 + evv(ix, k23?.id, 'box1') + evv(ix, k23?.id, 'box4') - evv(ix, k23?.id, 'box16d');
  const b24 = Math.max(0, b23 + 16900 - 30000);
  const r = docsOfType(ix, 'K-1-1065')[0];
  return (
    <div className="col" style={{ gap: 12 }}>
      <Panel title="Lindqvist Family Woodworks, Inc. — stock basis by year (Form 7203)" pad={false}>
        <table className="t"><thead><tr><th>Year</th><th className="n">Beginning</th><th className="n">Income items</th><th className="n">Distributions</th><th className="n">Ending basis</th><th className="n">Excess → capital gain</th><th>Source</th></tr></thead><tbody>
          <tr><td>2022</td><td /><td /><td /><td className="n">21,300</td><td /><td className="small">Client worksheet in prior preparer file (D07)</td></tr>
          <tr><td>2023</td><td className="n">21,300</td><td className="n"><EvCell id={ev(ix, k23?.id, 'box1')?.id} /></td><td className="n"><EvCell id={ev(ix, k23?.id, 'box16d')?.id} /></td><td className="n">{money(b23)}</td><td className="n">0</td><td className="small">{k23 ? <Ref r={k23.id} /> : 'missing'} (found in June 2026; the prior preparer never rolled basis)</td></tr>
          <tr><td>2024</td><td className="n">{money(b23)}</td><td className="n">16,900</td><td className="n">30,000</td><td className="n">{money(b24)}</td><td className="n">0</td><td className="small">2024 K-1 per prior return (prior preparer "assumed basis sufficient")</td></tr>
          <tr className="total"><td>2025</td><td className="n"><Num k="F7203.1" /></td><td className="n"><Num k="F7203.4" /></td><td className="n"><Num k="F7203.6" /></td><td className="n"><Num k="F7203.15" /></td><td className="n"><Num k="F7203.excess" /></td><td className="small"><Ref r={k25.id} /></td></tr>
        </tbody></table>
        <div className="pb small muted">Shareholder does not work in the business → passive (<Num k="SchE.28A" />). Oregon composite tax 1,580 paid on Erik's behalf is inside the 42,000 distributions. QBI: <Num k="F8995.2.2" /> with W-2 wages 41,000 and UBIA 120,000.</div>
      </Panel>
      <Panel title="Ridgeline Real Estate Fund III LP — K-1 lines and capital account" pad={false}>
        <table className="t"><tbody>
          <tr><td>Box 2 net rental real estate income</td><td className="n"><EvCell id={ev(ix, r.id, 'box2')?.id} /></td><td>→ <Num k="SchE.28B" /> (passive)</td></tr>
          <tr><td>Box 5 interest</td><td className="n"><EvCell id={ev(ix, r.id, 'box5')?.id} /></td><td>→ <Num k="SchB.1.8" /></td></tr>
          <tr><td>Box 9a net long-term capital gain</td><td className="n"><EvCell id={ev(ix, r.id, 'box9a')?.id} /></td><td>→ <Num k="SchD.12" /></td></tr>
          <tr><td>Box 21 foreign taxes (passive)</td><td className="n"><EvCell id={ev(ix, r.id, 'box21')?.id} /></td><td>→ foreign tax credit <Num k="Sch3.1" /> (with Meridian 186)</td></tr>
          <tr><td>Box 19A distributions</td><td className="n"><EvCell id={ev(ix, r.id, 'box19a')?.id} /></td><td /></tr>
          <tr><td>State apportionment</td><td className="n">CA <EvCell id={ev(ix, 'D38', 'pct_CA')?.id} /></td><td className="small">TX 31%, AZ 27% (composite filed), NV 20%</td></tr>
          <tr className="total"><td>Capital: 60,000 + 9,870 − 6,000 − 210</td><td className="n"><EvCell id={ev(ix, r.id, 'cap_end')?.id} /></td><td className="small muted">Outside basis never computed (prior file) — open item carried to 2026</td></tr>
        </tbody></table>
      </Panel>
    </div>
  );
}

// ---------- Retirement, IRA & HSA ----------
function Retirement() {
  return (
    <div className="grid2" style={{ alignItems: 'start' }}>
      <Panel title="Backdoor Roth (Form 8606)" pad={false}><LinesTable keys={['F8606.1', 'F8606.2', 'F8606.3', 'F8606.6', 'F8606.8', 'F8606.9', 'F8606.10', 'F8606.11', 'F8606.14', 'F8606.16', 'F8606.17', 'F8606.18', 'F1040.4b']} /><div className="pb small muted">Two conversions (02/20 7,010 and 04/02 7,016) of the 2024 and 2025 nondeductible contributions; year-end traditional balance 0, so only 26 of earnings is taxable. The client said there was no prior basis — the 2024 Form 8606 and Form 5498 prove otherwise.</div></Panel>
      <div className="col" style={{ gap: 12 }}>
        <Panel title="SEP-IRA limit" pad={false}><LinesTable keys={['SchC.31', 'SchSE.13', 'Sch1.16']} /><div className="pb small">Contribution 18,000 (D26, made 04/10/2026 for 2025). Limit 20% × (net profit − ½ SE tax). The excess carries forward and may be subject to the §4972 excise unless withdrawn.</div></Panel>
        <Panel title="HSA (Form 8889)" pad={false}><LinesTable keys={['F8889.3', 'F8889.9', 'F8889.13', 'F8889.14a', 'F8889.15', 'F8889.16']} /><div className="pb small muted">Family HDHP; 6,000 employer contributions through payroll (W-2 code W 2,500 + 3,500). California adds the employer HSA back to wages.</div></Panel>
      </div>
    </div>
  );
}

// ---------- Foreign ----------
function Foreign() {
  const { packet } = useStore();
  const ix = usePacketIndex()!;
  const d = docsOfType(ix, 'foreign_bank_statement')[0];
  const fx = packet.fx_rates.SEK_per_USD;
  return (
    <div className="grid2" style={{ alignItems: 'start' }}>
      <Panel title={`${d.issuer} — SEK to USD`}>
        <table className="t"><thead><tr><th /><th className="n">SEK</th><th className="n">Rate</th><th className="n">USD</th><th>Use</th></tr></thead><tbody>
          <tr><td>Interest credited 12/31</td><td className="n"><EvCell id={ev(ix, d.id, 'interest_sek')?.id} /></td><td className="n">{fx['2025_average']} (2025 avg)</td><td className="n">{money(Math.round(evv(ix, d.id, 'interest_sek') / fx['2025_average']))}</td><td className="small">Schedule B — engine used 2024 average {fx['2024_average']} → <Num k="SchB.1.6" /></td></tr>
          <tr><td>Highest balance (03/31)</td><td className="n"><EvCell id={ev(ix, d.id, 'max_balance_sek')?.id} /></td><td className="n">{fx['2025_year_end']} (Treasury YE)</td><td className="n"><Num k="F8938.1.max" /></td><td className="small">FBAR & Form 8938 maximum</td></tr>
          <tr><td>Balance 12/31</td><td className="n"><EvCell id={ev(ix, d.id, 'balance_ye_sek')?.id} /></td><td className="n">{fx['2025_year_end']}</td><td className="n"><Num k="F8938.1.ye" /></td><td className="small">Form 8938 year-end</td></tr>
        </tbody></table>
        <div className="small" style={{ marginTop: 8 }}>Account <Masked refId={ev(ix, d.id, 'account_number')?.id} masked={String(ev(ix, d.id, 'account_number')?.value)} /> · Form 8938 required: <Num k="F8938.req" /> (MFJ: &gt;100,000 year-end or &gt;150,000 at any time).</div>
      </Panel>
      <Panel title="Outside the return">
        <div className="col small">
          <div className="callout warn"><b>FinCEN 114 (FBAR)</b> — maximum ≈ $149,567 &gt; $10,000. Due Oct 15, 2026 (automatic extension). Excluded from the engagement; the 2024 file says the client filed it separately.</div>
          <div className="callout bad"><b>2023 Form 3520</b> — account opened 09/2023 with an inheritance from Birgitta Lindqvist. Prior preparer left it open; no evidence it was filed. Recommend a separate engagement with a reasonable-cause statement.</div>
          <div className="callout"><b>Schedule B Part III</b> — foreign account Yes, Sweden (<Num k="SchB.7a" /> / <Num k="SchB.7b" />); foreign trust <Num k="SchB.8" />.</div>
        </div>
      </Panel>
    </div>
  );
}

// ---------- Deductions & credits ----------
function Deductions() {
  const { view } = useStore();
  const ix = usePacketIndex()!;
  const agi = Number(lv(view, ix, 'F1040.11'));
  const P = ix.params;
  const cap = Math.max(P.salt_cap_floor, P.salt_cap - P.salt_cap_phase_rate * Math.max(0, agi - P.salt_cap_phase_start));
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <Panel title="State and local taxes — with the cap" pad={false}>
          <LinesTable keys={['SchA.5a', 'SchA.5b', 'SchA.5d', 'SchA.5e']} />
          <div className="pb small">Cap for AGI {money(agi)}: 40,000 − 30% × max(0, AGI − 500,000), not below 10,000 = <b>{money(cap)}</b>. State income taxes = CA withholding (8,950 + 4,180) + every FTB payment made in 2025 (including the January and March 2024-year payments). When the home property tax is corrected for the seller credit, the total drops under the cap and the correction starts to matter.</div>
        </Panel>
        <Panel title="Mortgage interest and points" pad={false}>
          <LinesTable keys={['SchA.8a', 'SchA.8c', 'SchA.8e']} />
          <div className="pb small muted">Lonestar 1098 13,900 (includes prepaid interest and the payoff interest) + Pecan 1098 997 + purchase points 4,800; refinance points 3,200 amortized 1/360. Acquisition debt 548,000 &lt; 750,000.</div>
        </Panel>
      </div>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <Panel title="Charitable contributions and limits" pad={false}>
          <LinesTable keys={['SchA.11', 'F8283.A1.stock', 'F8283.A1.vehicle', 'SchA.12', 'SchA.14']} />
          <div className="pb small muted">Cash gifts are within 60% of AGI ({money(agi * 0.6)}); appreciated long-term stock to a donor-advised fund within 30% ({money(agi * 0.3)}). Publicly traded stock needs no appraisal; the vehicle is limited to the 1098-C sale price.</div>
        </Panel>
        <Panel title="Credits with phase-outs" pad={false}>
          <LinesTable keys={['F8812.4', 'F8812.6', 'F8812.8', 'F8812.11', 'F8812.12', 'F8863.27', 'F8863.30', 'F8863.7', 'F2441.2', 'F2441.12', 'F2441.31']} />
        </Panel>
      </div>
      <DueDiligence />
    </div>
  );
}

const DD_QUESTIONS = [
  ['relationship', 'Relationship: is each child the taxpayers\' son/daughter (or other qualifying relative)? Evidence?'],
  ['age', 'Age test: Theo under 17 at year end (CTC); Ada 19, full-time student (ODC)?'],
  ['residency', 'Residency: lived with the taxpayers more than half the year (Ada away at school counts as temporary absence)?'],
  ['support', 'Support: neither child provided more than half of their own support?'],
  ['tin', 'TIN: each dependent has a valid SSN issued before the due date, matching SSA records?'],
  ['joint', 'Joint return: neither dependent files a joint return; Ada\'s own return says she can be claimed?'],
  ['documents', 'Documents relied on and questions asked (knowledge requirement, Form 8867 Part I)?'],
];
function DueDiligence() {
  const { view, cmd } = useStore();
  const existing = view.dueDiligence.ctc_odc;
  const [ans, setAns] = useState<Record<string, string>>(existing?.answers ?? {
    relationship: 'Son and daughter per the 2024 return and organizer.', age: 'Theo DOB 2017-02-09 (8); Ada DOB 2006-05-21 (19), full-time student per 1098-T box 8 (D59).', residency: '12 months each; Ada at UC Davis during the school year (temporary absence).',
    support: 'Ada earned 4,100 (summer W-2); parents pay tuition and housing.', tin: '', joint: 'Ada files her own return and checked "someone can claim you" (related return).', documents: '',
  });
  const ro = readOnly(view);
  return (
    <Panel title="Due diligence — Form 8867 (child tax credit and credit for other dependents)" right={existing ? <span className="pill ok">Recorded by {view.people.find((p: any) => p.id === existing.actor)?.name}</span> : <span className="pill warn">required (firm standard)</span>}>
      <div className="col">
        {DD_QUESTIONS.map(([k, q]) => <label key={k} className="f">{q}<input value={ans[k] ?? ''} onChange={(e) => setAns({ ...ans, [k]: e.target.value })} disabled={!!existing || !!ro} placeholder={k === 'tin' ? 'Note the Theo SSN mismatch and how it was resolved' : ''} /></label>)}
        {!existing && !ro && <div><button className="btn primary" onClick={() => cmd({ type: 'due_diligence.record', credit: 'ctc_odc', answers: ans, evidence: ['D59', 'D06', 'household:theo', 'household:ada'] }, { success: 'Due diligence recorded.' })}>Record due diligence</button> <span className="muted small">Every question needs an answer.</span></div>}
      </div>
    </Panel>
  );
}

// ---------- Tax computation & payments ----------
function TaxPayments() {
  return (
    <div className="grid2" style={{ alignItems: 'start' }}>
      <Panel title="Tax computation" pad={false}><LinesTable keys={['F1040.11', 'F1040.12', 'F1040.13', 'F1040.15', 'F1040.16', 'F6251.4', 'F6251.9', 'F6251.11', 'F1040.18', 'F1040.19', 'F1040.20', 'F1040.22', 'Sch2.4', 'Sch2.11', 'Sch2.12', 'F1040.24']} /></Panel>
      <div className="col" style={{ gap: 12 }}>
        <Panel title="Payments" pad={false}><LinesTable keys={['F1040.25a', 'F1040.26', 'Sch3.10', 'Sch3.11', 'F1040.33', 'F1040.37']} /><div className="pb small"><a href="#/payments">Agree payments to the IRS transcript and FTB account →</a></div></Panel>
        <Panel title="Underpayment penalty (Form 2210)" pad={false}><LinesTable keys={['F2210.8', 'F2210.19', 'F2210.AI', 'F1040.38']} /><div className="pb small muted">Annualized method gives the same 164 (engine what-if "penalty_annualized"). Changing the Q4 estimate to the transcript amount will raise it.</div></Panel>
      </div>
    </div>
  );
}

// ---------- California ----------
function California() {
  const { view } = useStore();
  const ix = usePacketIndex()!;
  const sch = [['1', 'Wages'], ['2', 'Taxable interest'], ['3', 'Ordinary dividends'], ['4', 'IRA distributions'], ['7', 'Capital gain'], ['12', 'Business income'], ['17', 'Rental, S corp, partnership'], ['22', 'Total income'], ['26', 'Adjustments']];
  const has = (k: string) => ix.lines.get(view.baseVersion)!.has(k);
  return (
    <div className="col" style={{ gap: 12 }}>
      <Panel title="Residency">
        <div className="small">California resident 2025-01-01 → 2025-07-14 ({ix.params.ca_resident_days} days, {pct(ix.params.ca_resident_days / ix.params.year_days, 1)}); Texas from 2025-07-15. California taxes all income while resident and California-source income after (the Sacramento rental, Ridgeline's 22% California share). Engine rules: resident-period share by days for most items; sales and conversions by date.</div>
      </Panel>
      <Panel title="Schedule CA (540NR) — federal to California-source" pad={false}>
        <table className="t"><thead><tr><th>Line</th><th className="n">A federal</th><th className="n">B subtractions</th><th className="n">C additions</th><th className="n">D California law</th><th className="n">E California-source</th><th>Rule for E</th></tr></thead><tbody>
          {sch.map(([n, l]) => <tr key={n} className={n === '22' ? 'total' : ''}><td>{n}. {l}</td>{['A', 'B', 'C', 'D', 'E'].map((c) => <td key={c} className="n">{has(`SchCA540NR.${n}.${c}`) ? <Num k={`SchCA540NR.${n}.${c}`} /> : ''}</td>)}<td className="small muted">{ix.rules[ix.lines.get(view.baseVersion)!.get(`SchCA540NR.${n}.E`)?.rule]?.slice(0, 80)}</td></tr>)}
        </tbody></table>
        <div className="pb small">Wages: Corvane's box 16 (all earned while resident) + Halvorsen's California wages through the move per the 07/18 paystub (<EvCell id={ev(ix, 'D73', 'ytd_ca_wages')?.id} />) — not Halvorsen's box 16, which reflects payroll keeping California through September.</div>
      </Panel>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <Panel title="Form 540NR" pad={false}><LinesTable keys={['F540NR.17', 'F540NR.18', 'F540NR.19', 'F540NR.31', 'F540NR.32', 'F540NR.34', 'F540NR.35', 'F540NR.36', 'F540NR.37', 'F540NR.39', 'F540NR.40', 'ScheduleS.credit', 'F540NR.61', 'F540NR.64', 'F540NR.71', 'F540NR.72', 'F540NR.78', 'F540NR.97']} /></Panel>
        <Panel title="California differences" pad={false}><LinesTable keys={['SchCA540NR.1.C', 'SchCA540NR.2.B', 'SchCA540NR.12.C', 'SchCA540NR.17.B', 'SchCA540NR.A.itemized', 'FTB3885A.SAC-APPL', 'FTB3885A.STU-PRINTER', 'FTB3885A.STU-CAMERA', 'FTB3885A.STU-WORKST', 'FTB5805.penalty']} /><div className="pb small muted">HSA add-back; U.S. Treasury interest exempt; no federal bonus depreciation (equipment and the 2021 appliances); California itemized has no state income tax and no SALT cap.</div></Panel>
      </div>
    </div>
  );
}

// ---------- Intake ----------
function Intake() {
  const { view, packet } = useStore();
  const ix = usePacketIndex()!;
  const h = packet.household;
  return (
    <div className="col" style={{ gap: 12 }}>
      <Panel title="Household (as entered by the client in the organizer)" pad={false}>
        <table className="t"><thead><tr><th>Person</th><th>Role</th><th>SSN</th><th>DOB</th><th>Notes</th></tr></thead><tbody>
          {h.people.map((p: any) => {
            const fact = view.ours.facts[`household:${p.id}.ssn`];
            return <tr key={p.id}><td><b>{p.name}</b></td><td>{p.role}{p.relationship ? ` (${p.relationship})` : ''}</td><td><Masked refId={`household:${p.id}.ssn`} masked={p.ssn} />{fact && <div className="tiny t-info">corrected → <span className="mono">{fact}</span></div>}</td><td>{p.dob}</td><td className="small">{p.occupation ?? ''}{p.full_time_student ? 'full-time student · ' : ''}{p.months_lived_with_you ? `${p.months_lived_with_you} months · ` : ''}{p.ip_pin ? <>IP PIN <Masked refId={`household:${p.id}.ip_pin`} masked={p.ip_pin} /></> : ''}{p.note ?? ''}</td></tr>;
          })}
        </tbody></table>
        <div className="pb small">Refund/payment account <Masked refId="household:bank.account" masked={h.bank_account_for_refund_or_payment.account} /> ({h.bank_account_for_refund_or_payment.bank}, routing <Masked refId="household:bank.routing" masked={h.bank_account_for_refund_or_payment.routing} />). Prior-year AGI for e-signature {money(h.prior_year_agi_for_esignature)} (agrees to D06). Masked values are revealed one at a time by cleared staff; every reveal is logged.</div>
      </Panel>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <Panel title="Engagement, consent and identity">
          <div className="col small">
            {['D01', 'D02', 'D03', 'D04', 'D05'].map((id) => <div key={id} className="row"><Ref r={id} /><span className="spacer" /><span className="muted">{ix.docs.get(id)?.received_at.slice(0, 10)}</span></div>)}
            <div className="muted">Engagement scope excludes FBAR, the business's 1099s, nonresident state returns and gift tax returns — so those become "outside filings identified", not silence.</div>
          </div>
        </Panel>
        <Panel title="Addresses, residency and related returns">
          <div className="small">{h.addresses.map((a: any) => <div key={a.from}>{a.from} → {a.to ?? 'now'}: {a.address} ({a.type})</div>)}</div>
          <hr className="sep" />
          <div className="small">{h.related_returns.map((r: any) => <div key={r.who} style={{ marginBottom: 4 }}><b>{r.who}</b>: {r.return} — {r.prepared_by}. In packet: {String(r.in_this_packet)}</div>)}</div>
        </Panel>
      </div>
    </div>
  );
}

function FilingArea() {
  const { view, go } = useStore();
  const out = view.findings.filter((f: any) => f.kind === 'outside_filing');
  return (
    <Panel title="Outside filings identified" right={<a href="#/filing">Filing →</a>} pad={false}>
      {out.map((f: any) => <div key={f.id} className="list-row" onClick={() => go(`#/findings/${encodeURIComponent(f.id)}`)}><span className={`dot sev-${f.severity}`} style={{ marginTop: 5 }} /><div style={{ flex: 1 }}><div className="title">{f.title}</div><div className="small muted">{f.summary.slice(0, 180)}</div></div></div>)}
      <div className="pb small muted">Also: Ada files her own 2025 return (consumer software) and checked "can be claimed as a dependent" — consistent with the credit for other dependents claimed here.</div>
    </Panel>
  );
}

export const AREA_PANELS: Record<string, () => ReactNode> = {
  intake: Intake, wages: Wages, investments: Investments, business: Business, rentals: Rentals, passthroughs: Passthroughs,
  retirement: Retirement, foreign: Foreign, deductions: Deductions, tax_payments: TaxPayments, california: California, filing: FilingArea,
};
