import { useStore, usePacketIndex } from '../store';
import { Num, Panel, Effect, Sev, Who, When, Status } from '../components/ui';
import { lineValue, signed, money, date } from '../../shared/format';

export const FED_ROWS: [string, string, string?][] = [
  ['F1040.1a', 'Wages (W-2 box 1)'], ['F1040.2b', 'Taxable interest'], ['F1040.3b', 'Ordinary dividends'], ['F1040.4b', 'IRA distributions (taxable)'], ['F1040.7', 'Capital gain or (loss)'],
  ['F1040.8', 'Schedule 1 income (business, rentals, K-1s)'], ['F1040.9', 'Total income'], ['F1040.10', 'Adjustments to income'], ['F1040.11', 'Adjusted gross income'],
  ['F1040.12', 'Deductions (itemized)'], ['F1040.13', 'QBI deduction'], ['F1040.15', 'Taxable income'], ['F1040.16', 'Tax'], ['F1040.17', 'AMT'], ['F1040.19', 'Child / other dependent credit'],
  ['F1040.23', 'Other taxes (SE, NIIT, Medicare)'], ['F1040.24', 'Total tax'], ['F1040.25d', 'Withholding', 'F1040.25a'], ['F1040.26', 'Estimated payments'], ['F1040.31', 'Extension payment & other credits'], ['F1040.33', 'Total payments'], ['F1040.37', 'Amount owed'], ['F1040.38', 'Estimated tax penalty'],
];
export const CA_ROWS: [string, string, string?][] = [
  ['F540NR.13', 'Federal AGI', 'CA540.13'], ['F540NR.17', 'Total AGI using California law', 'CA540.17'], ['F540NR.32', 'California AGI (California-source)'], ['F540NR.18', 'Deductions', 'CA540.18'],
  ['F540NR.19', 'Total taxable income', 'CA540.19'], ['F540NR.31', 'Tax on total taxable income', 'CA540.31'], ['F540NR.34', 'California share (line 32 / 17)'], ['F540NR.35', 'California taxable income'],
  ['F540NR.40', 'Regular tax after exemption credits'], ['F540NR.64', 'Total tax', 'CA540.64'], ['F540NR.71', 'Withholding', 'CA540.71'], ['F540NR.72', 'Estimated payments', 'CA540.72'], ['F540NR.78', 'Total payments'], ['F540NR.97', 'Overpaid'],
];

export function SummaryTable({ rows, showVersions = true }: { rows: [string, string, string?][]; showVersions?: boolean }) {
  const { view, packet } = useStore();
  const ix = usePacketIndex();
  const std = view.standards.variance_review;
  const py = packet.prior_years.return_2024.lines;
  const versions = view.versions.map((v: any) => v.version);
  return (
    <table className="t">
      <thead><tr><th>Line</th><th className="n">2024 filed</th>{showVersions && versions.map((v: string) => <th key={v} className="n">Engine {v}</th>)}<th className="n">Ours</th><th className="n">Δ vs 2024</th><th /></tr></thead>
      <tbody>
        {rows.map(([k, label, pk]) => {
          const prior = py[pk ?? k];
          const ours = view.ours.lines[k]?.value ?? ix?.lines.get(view.baseVersion)?.get(k)?.value;
          const d = typeof prior === 'number' && typeof ours === 'number' ? ours - prior : null;
          const flag = d != null && Math.abs(d) > std.and_over_amount && (prior === 0 || Math.abs(d / prior) * 100 > std.flag_if_change_over_percent);
          const vf = view.findings.find((f: any) => f.id === `VARIANCE:${k}`);
          return (
            <tr key={k} className={view.ours.lines[k] ? 'changed' : ''} data-tour={k === 'F1040.1a' ? 'wages' : undefined}>
              <td>{label}<span className="mono muted tiny"> {k}</span></td>
              <td className="n">{prior !== undefined ? lineValue(prior) : <span className="muted">—</span>}</td>
              {showVersions && versions.map((v: string) => <td key={v} className="n">{ix?.lines.get(v)?.get(k) ? <Num k={k} version={v} value={ix.lines.get(v)!.get(k).value} /> : '—'}</td>)}
              <td className="n"><b><Num k={k} /></b></td>
              <td className="n">{d != null ? signed(d) : ''}</td>
              <td>{flag && <a href={`#/findings/${encodeURIComponent(`VARIANCE:${k}`)}`} className={`pill ${vf && ['resolved', 'no_change'].includes(vf.status) ? 'ok' : 'warn'}`} title="Variance over the firm standard: needs an explanation">{vf && ['resolved', 'no_change'].includes(vf.status) ? 'explained' : 'explain'}</a>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function Overview() {
  const { view, go, cmd } = useStore();
  if (!view) return null;
  const s = view.ours.summary;
  const v3 = view.versions.at(-1)?.summary;
  const open = view.findings.filter((f: any) => !['resolved', 'no_change'].includes(f.status));
  const checks = open.filter((f: any) => f.source === 'check' && f.effect && f.kind !== 'opportunity');
  const sumFed = checks.reduce((x: number, f: any) => x + (f.effect?.fed || 0), 0);
  const sumCa = checks.reduce((x: number, f: any) => x + (f.effect?.ca || 0), 0);
  const bySev = ['blocking', 'high', 'medium', 'low', 'info'].map((sv) => [sv, open.filter((f: any) => f.severity === sv).length]);
  const daysToDue = Math.ceil((Date.parse('2026-10-15') - Date.parse(view.meta.now)) / 86400000);
  const signed2 = view.signoffs.filter((x: any) => x.level === 'reviewer' && x.valid).length;
  const reviewAreas = view.areas.filter((a: any) => a.id !== 'filing' && (a.lines || a.total)).length;
  const ch = view.changes;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Return overview</h1><p>2025 Form 1040 + California 540NR. “Ours” = engine {view.baseVersion} plus reviewed adjustments; click any number to trace it.</p></div>
        <span className="spacer" />
        {s.estimate && <span className="pill est" title="Totals include adjustments estimated with the engine's published per-dollar rates; the engine will recompute">includes estimates</span>}
      </div>

      <div className="grid4">
        <Panel pad={false}><div className="stat"><div className="label">Federal {s.federal.balance_due >= 0 ? 'balance due' : 'overpaid'}</div><div className="value">{money(Math.abs(s.federal.balance_due))}</div><div className="sub">Engine {view.baseVersion}: {money(v3?.federal.balance_due)} owed · total tax {money(s.federal.total_tax)}</div></div></Panel>
        <Panel pad={false}><div className="stat"><div className="label">California {s.california.balance_due >= 0 ? 'balance due' : 'overpaid'}</div><div className="value">{money(Math.abs(s.california.balance_due))}</div><div className="sub">Engine {view.baseVersion}: {money(-v3?.california.balance_due)} overpaid · total tax {money(s.california.total_tax)}</div></div></Panel>
        <Panel pad={false}><div className="stat clickable" onClick={() => go('#/findings')}><div className="label">Open findings with a tax effect</div><div className="value">{checks.length}</div><div className="sub">Estimated effect if all fixed: Fed {signed(sumFed)} · CA {signed(sumCa)}</div></div></Panel>
        <Panel pad={false}><div className="stat clickable" onClick={() => go('#/filing')}><div className="label">Filing gate</div><div className="value" style={{ color: view.gate.ready ? 'var(--ok)' : 'var(--sev-high)' }}>{view.filing.frozen ? 'Filed' : view.gate.ready ? 'Ready' : `${view.gate.blockers.length} open`}</div><div className="sub">Extended due date Oct 15, 2026 · {daysToDue > 0 ? `${daysToDue} days left` : 'passed'} · {signed2}/{reviewAreas} areas reviewed</div></div></Panel>
      </div>

      <div className="grid2" style={{ marginTop: 12, alignItems: 'start' }}>
        <Panel title="Federal — 2025 vs 2024" right={<span className="muted small">variance standard: &gt;{view.standards.variance_review.flag_if_change_over_percent}% and &gt;{money(view.standards.variance_review.and_over_amount)}</span>} pad={false}>
          <SummaryTable rows={FED_ROWS} showVersions={false} />
        </Panel>
        <div className="col" style={{ gap: 12 }}>
          <Panel title="California — 2025 (540NR) vs 2024 (540)" pad={false}><SummaryTable rows={CA_ROWS} showVersions={false} /></Panel>
          <Panel title="Open by severity" right={<a href="#/findings">Inbox →</a>}>
            <div className="row wrap">{bySev.map(([sv, n]) => <a key={sv as string} href={`#/findings?sev=${sv}`} className="row" style={{ gap: 4 }}><Sev s={sv as string} /><b>{n}</b></a>)}</div>
            <hr className="sep" />
            {open.filter((f: any) => f.source === 'check').slice(0, 6).map((f: any) => (
              <div key={f.id} className="list-row" onClick={() => go(`#/findings/${encodeURIComponent(f.id)}`)}>
                <span className={`dot sev-${f.severity}`} style={{ marginTop: 5 }} /><div style={{ flex: 1 }}><div className="title">{f.title}</div></div><Effect e={f.effect} compact />
              </div>
            ))}
          </Panel>
          <Panel title="Changed since you last looked" right={ch.events.length > 0 && <button className="btn sm" onClick={() => cmd({ type: 'seen.mark' })}>Mark seen</button>}>
            {ch.events.length === 0 ? <div className="muted small">Nothing new from others since your last look.</div> : ch.events.slice(-8).reverse().map((e: any) => <div key={e.seq} className="row small" style={{ padding: '3px 0' }}><Who id={e.actor} /><span style={{ flex: 1 }}>{e.summary}</span><When at={e.at} /></div>)}
          </Panel>
        </div>
      </div>

      <div className="grid3" style={{ marginTop: 12 }}>
        <Panel title="Engine versions">
          {view.versions.map((v: any) => (
            <div key={v.version} className="small" style={{ marginBottom: 6 }}><b>{v.version}</b> <span className="muted">{date(v.computed_at)}</span> — {v.trigger}<div className="muted">Fed tax {money(v.summary.federal.total_tax)} · CA tax {money(v.summary.california.total_tax)} · {v.changes} line changes</div></div>
          ))}
          <a href="#/versions">Compare versions →</a>
        </Panel>
        <Panel title="Season">
          <div className="kv small">
            <div>Season date</div><div>{date(view.meta.now)}</div>
            <div>Next event</div><div>{view.script.next ? `${date(view.script.next.at)} — ${view.script.next.title}` : 'Season complete'}</div>
            {view.script.blocked && <><div>Gated</div><div className="t-high">{view.script.blocked}</div></>}
            <div>Extension</div><div>Filed 2026-04-14 with 36,000 (federal), 0 (California), estimated from v2</div>
            <div>Filing</div><div>{view.filing.frozen ? `Frozen ${date(view.filing.frozen.at)}` : view.filing.clientApproval ? 'Client approved' : 'In review'}</div>
          </div>
          <div className="row" style={{ marginTop: 8 }}><a href="#/timeline">Timeline & replay →</a></div>
        </Panel>
        <Panel title="Recent adjustments" right={<a href="#/adjustments">All →</a>}>
          {view.adjustments.length === 0 && <div className="muted small">None yet. Findings carry suggested fixes you can propose in one click.</div>}
          {view.adjustments.slice(-5).reverse().map((a: any) => <div key={a.id} className="row small" style={{ padding: '3px 0' }}><b>{a.id}</b><span style={{ flex: 1 }}>{a.title}</span><Status s={a.status} /></div>)}
        </Panel>
      </div>
    </div>
  );
}
