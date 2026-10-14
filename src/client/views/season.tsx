import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import { Panel, Who, Empty, Effect, Status, Ref, readOnly } from '../components/ui';
import { JudgmentDialog, AdjustDialog } from '../components/dialogs';
import { money, date, dateTime, signed } from '../../shared/format';

// ---------- Timeline & replay ----------
export function Timeline() {
  const { view, setAsOf, asOf, cmd } = useStore();
  const [kind, setKind] = useState('all');
  const items = useMemo(() => (view?.timeline || []).filter((t: any) => kind === 'all' || t.kind === kind), [view, kind]);
  if (!view) return null;
  const start = Date.parse('2026-01-12T00:00:00Z');
  const end = Date.parse(view.meta.now);
  const cur = asOf ? Date.parse(asOf) : end;
  const marks = [['2026-03-04T09:12:00Z', 'v1'], ['2026-03-19T07:40:00Z', 'v2'], ['2026-04-14T15:00:00Z', 'extension'], ['2026-06-23T06:05:00Z', 'v3']].filter(([t]) => Date.parse(t) <= end);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Timeline & replay</h1><p>Scrub the season: the whole workpaper (documents, engine version, findings, sign-offs) re-renders as it stood at that moment. Upcoming packet events play with “Advance”.</p></div></div>
      <Panel title="Replay">
        <input type="range" min={start} max={end} value={cur} step={3600000} style={{ width: '100%' }} onChange={(e) => setAsOf(Number(e.target.value) >= end - 3600000 ? null : new Date(Number(e.target.value)).toISOString())} aria-label="Replay time" />
        <div className="row small" style={{ position: 'relative', height: 18 }}>
          {marks.map(([t, l]) => <button key={l} className="btn sm ghost" style={{ position: 'absolute', left: `${((Date.parse(t) - start) / (end - start)) * 100}%`, transform: 'translateX(-50%)' }} onClick={() => setAsOf(new Date(Date.parse(t) + 60000).toISOString())}>{l}</button>)}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <b>{asOf ? `Viewing ${dateTime(asOf)}` : `Live — ${dateTime(view.meta.now)}`}</b>
          <span className="spacer" />
          {asOf && <button className="btn" onClick={() => setAsOf(null)}>Back to live</button>}
          {['2026-03-01T00:00:00Z', '2026-03-05T00:00:00Z', '2026-03-20T00:00:00Z', '2026-06-06T00:00:00Z'].filter((t) => Date.parse(t) < end).map((t) => <button key={t} className="btn sm" onClick={() => setAsOf(t)}>{date(t)}</button>)}
        </div>
      </Panel>
      <div className="grid2" style={{ marginTop: 12, alignItems: 'start' }}>
        <Panel title="Season events" right={<div className="seg">{[['all', 'All'], ['packet', 'Packet'], ['document', 'Documents'], ['workpaper', 'Workpaper']].map(([k, l]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}</div>} pad={false}>
          <div style={{ maxHeight: 640, overflow: 'auto' }}>
            {items.slice().reverse().map((t: any, i: number) => (
              <div key={i} className="list-row" style={{ cursor: 'default' }}>
                <span className="small muted" style={{ width: 92, flex: 'none' }}>{date(t.at)}</span>
                <span className={`pill ${t.kind === 'workpaper' ? 'info' : t.kind === 'document' ? '' : 'warn'}`} style={{ flex: 'none' }}>{t.kind}</span>
                <span className="small" style={{ flex: 1 }}>{t.title}</span>
                {t.actor && /^(st|cu)-/.test(t.actor) && <Who id={t.actor} />}
                <button className="btn sm ghost" title="Replay to this moment" onClick={() => setAsOf(new Date(Date.parse(t.at) + 1000).toISOString())}>⏪</button>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Upcoming (scripted from the packet)">
          {view.script.items.filter((i: any) => !view.script.applied.includes(i.id)).map((i: any, n: number) => (
            <div key={i.id} className="row small" style={{ padding: '4px 0', opacity: n === 0 ? 1 : 0.7 }}>
              <span className="muted" style={{ width: 92 }}>{date(i.at)}</span><span style={{ flex: 1 }}>{i.title}</span>{i.kind === 'gate' && <span className="pill warn">needs in-app action</span>}
            </div>
          ))}
          {view.script.blocked && <div className="callout warn small" style={{ marginTop: 8 }}>{view.script.blocked}</div>}
          {view.script.next && !view.meta.isReplay && <button className="btn primary" style={{ marginTop: 10 }} disabled={!!view.script.blocked} onClick={() => cmd({ type: 'season.advance' }, { success: 'Season advanced.' }).catch(() => undefined)}>▸ Advance to {date(view.script.next.at)}</button>}
          {!view.script.next && <div className="muted small">The season is over.</div>}
        </Panel>
      </div>
    </div>
  );
}

// ---------- Filing ----------
export function Filing() {
  const { view, cmd, ws } = useStore();
  const [pin, setPin] = useState('');
  const [dlg, setDlg] = useState<any>(null);
  if (!view) return null;
  const ro = readOnly(view);
  const role = view.viewer?.role;
  const isSigner = view.viewer?.id === 'st-03';
  const g = view.gate;
  const subs = view.filing.submissions;
  const fedAccepted = subs.some((s: any) => s.jurisdiction === 'federal' && s.status === 'accepted');
  const partnerSO = view.signoffs.find((s: any) => s.scope === 'return' && s.level === 'partner');
  const kinds = ['finding', 'adjustment', 'step'];
  const openAmd = view.amendments.find((a: any) => a.status === 'open');
  return (
    <div className="page">
      <div className="page-head"><div><h1>Filing</h1><p>The gate is the firm's standards made executable: open blocking findings, pending approvals, missing steps and invalid sign-offs all stop the e-file.</p></div><span className="spacer" />{view.filing.frozen ? <span className="pill ok">Filed & frozen</span> : g.ready ? <span className="pill ok">Ready to file</span> : <span className="pill bad">{g.blockers.length} blocking</span>}</div>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="col" style={{ gap: 12 }}>
          <Panel title="Required steps (firm standards)">
            {view.steps.map((s: any) => <div key={s.step} className="row small" style={{ padding: '3px 0', alignItems: 'flex-start' }}><span>{s.done ? '✅' : '⬜'}</span><div style={{ flex: 1 }}><b>{s.step}</b><div className="muted">{s.note}{s.by && <> · <Who id={s.by} /></>}</div></div>{!s.auto && !s.done && !ro && view.viewer?.kind === 'staff' && <button className="btn sm" onClick={() => cmd({ type: 'step.complete', step: s.step, note: 'Completed in the workpaper' })}>Mark done</button>}</div>)}
          </Panel>
          {!view.filing.frozen && <Panel title={`What blocks filing (${g.blockers.length})`}>
            {g.blockers.length === 0 && <div className="callout ok">Nothing blocks filing.</div>}
            {kinds.map((k) => { const bs = g.blockers.filter((b: any) => b.kind === k); if (!bs.length) return null; return <div key={k}><h3>{k === 'finding' ? 'Open findings' : k === 'adjustment' ? 'Pending approvals' : 'Steps'} ({bs.length})</h3>{bs.slice(0, 40).map((b: any) => <div key={b.ref} className="small" style={{ padding: '2px 0' }}>{k === 'finding' ? <a href={`#/findings/${encodeURIComponent(b.ref)}`}>{b.text}</a> : k === 'adjustment' ? <a href="#/adjustments">{b.text}</a> : b.text}</div>)}{bs.length > 40 && <div className="muted small">+{bs.length - 40} more</div>}</div>; })}
          </Panel>}
        </div>
        <div className="col" style={{ gap: 12 }}>
          <Panel title="Extension (already filed)">
            <div className="small">April 14, 2026: Form 4868 with 36,000 and FTB 3519 with 0 — estimated from engine v2 (balance due 35,728 rounded up to the next 500). Extended due date October 15, 2026. An extension of time to file is not an extension of time to pay: any final balance accrues interest and the failure-to-pay penalty from April 15.</div>
          </Panel>
          <Panel title="Partner sign-off & client approval">
            <div className="col small">
              <div className="row"><b>Partner sign-off (whole return)</b><span className="spacer" />{partnerSO ? (partnerSO.valid ? <span className="pill ok">✓ {partnerSO.actorName}</span> : <span className="pill warn" title={partnerSO.changes.join('\n')}>↺ reopened</span>) : <span className="pill">not signed</span>}</div>
              {role === 'partner' && !ro && !view.filing.frozen && (!partnerSO || !partnerSO.valid) && <button className="btn" onClick={() => cmd({ type: 'signoff', scope: 'return', level: 'partner' }, { success: 'Partner sign-off recorded.' }).catch(() => undefined)}>Sign off the return as partner</button>}
              <hr className="sep" />
              <div className="row"><b>Sent to client</b><span className="spacer" />{view.filing.approvalRequested ? <span className="pill info">{date(view.filing.approvalRequested.at)}</span> : <span className="pill">not sent</span>}</div>
              {role === 'partner' && !ro && !view.filing.frozen && <button className="btn" onClick={() => cmd({ type: 'filing.request_approval' }, { success: 'Sent to the client portal for approval.' }).catch(() => undefined)}>Send return to client for approval</button>}
              <div className="row"><b>Client approval & Form 8879</b><span className="spacer" />{view.filing.clientApproval ? <span className="pill ok">✓ {view.people.find((p: any) => p.id === view.filing.clientApproval.actor)?.name} · PIN {view.filing.clientApproval.pinMasked}</span> : <span className="pill">waiting</span>}</div>
              {view.filing.approvalRequested && !view.filing.clientApproval && <div className="muted">Switch to Ngozi or Erik (person menu) to approve in the client portal.</div>}
            </div>
          </Panel>
          <Panel title="E-file">
            <div className="col small">
              {subs.length === 0 && <div className="muted">Not transmitted.</div>}
              {subs.map((s: any) => <div key={s.id} className="callout" style={{ borderLeftColor: s.status === 'accepted' ? 'var(--ok)' : s.status === 'rejected' ? 'var(--sev-blocking)' : undefined }}><div className="row"><b>{s.jurisdiction}</b><span className="mono tiny">{s.id}</span><span className="spacer" /><span className={`pill ${s.status === 'accepted' ? 'ok' : s.status === 'rejected' ? 'bad' : 'warn'}`}>{s.status.replace('_', ' ')}</span></div><div className="muted">{dateTime(s.at)}</div>{s.errors.map((e: any) => <div key={e.code} className="t-high">{e.code}: {e.message}</div>)}</div>)}
              {!view.filing.frozen && !ro && <div className="row"><button className="btn primary" disabled={!isSigner} title={isSigner ? '' : 'Only Helen Strand (the paid preparer who signs returns) transmits'} onClick={() => cmd({ type: 'filing.transmit' }).then((r) => r && undefined).catch(() => undefined)}>Transmit federal + California</button>{!isSigner && <span className="muted">Only the signing partner can transmit.</span>}</div>}
              {view.filing.frozen && <div className="callout ok"><b>Frozen at filing</b> {dateTime(view.filing.frozen.at)}<div className="mono tiny" style={{ wordBreak: 'break-all' }}>sha256 {view.filing.frozen.hash}</div><div className="row" style={{ marginTop: 6 }}><a className="btn sm" href={`/api/ws/${ws}/client-copy`} target="_blank" rel="noreferrer">Client copy</a><a className="btn sm" href={`/api/ws/${ws}/snapshot`} target="_blank" rel="noreferrer">Frozen snapshot (JSON)</a></div></div>}
            </div>
          </Panel>
          {view.filing.frozen && <Panel title="Amendments (layered on the frozen return)">
            {view.amendments.length === 0 && <div className="muted small">None. The filed return cannot be edited; an amendment adds a layer on top and shows original → change → corrected.</div>}
            {view.amendments.map((a: any) => <div key={a.id} className="small"><b>{a.id}</b> — {a.reason} <Status s={a.status === 'open' ? 'in_progress' : 'resolved'} /></div>)}
            {openAmd && <AmendmentDiff />}
            {role === 'partner' && !ro && !openAmd && <button className="btn" onClick={() => { const reason = prompt('Reason for the amendment?'); if (reason) cmd({ type: 'amendment.open', reason }); }}>Open amendment</button>}
            {openAmd && !ro && view.viewer?.kind === 'staff' && <button className="btn" style={{ marginTop: 6 }} onClick={() => setDlg({ kind: 'adjust' })}>Propose amended change…</button>}
          </Panel>}
          {view.payments.length > 0 && <Panel title="After filing">
            {view.payments.map((p: any, i: number) => <div key={i} className="small" style={{ marginBottom: 4 }}><b>{p.date}</b> {p.jurisdiction} {p.kind.replace('_', ' ')} {money(Math.abs(p.amount))}<div className="muted">{p.note}</div></div>)}
            {!ro && view.viewer?.kind === 'staff' && <button className="btn sm" onClick={() => setDlg({ kind: 'judgment', initial: { kind: 'penalty', title: 'Failure-to-pay penalty: request first-time abatement', decision: 'Request FTA: no penalties in the prior three years (2023 CP2000 closed with no change); the balance was paid on 2026-07-20.', authority: 'IRM 20.1.1.3.3.2.1 (First Time Abate)' } })}>Record penalty decision…</button>}
          </Panel>}
        </div>
      </div>
      {dlg?.kind === 'judgment' && <JudgmentDialog initial={dlg.initial} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'adjust' && <AdjustDialog initial={{ changes: [{ target: '', value: '' }], title: `Amendment ${openAmd?.id}` }} onClose={() => setDlg(null)} />}
    </div>
  );
}

function AmendmentDiff() {
  const { view } = useStore();
  const adjs = view.adjustments.filter((a: any) => a.layer === 'amendment' && ['pending', 'approved'].includes(a.status));
  const fed = adjs.reduce((s: number, a: any) => s + (a.effect?.fed || 0), 0);
  const ca = adjs.reduce((s: number, a: any) => s + (a.effect?.ca || 0), 0);
  return (
    <table className="t small" style={{ marginTop: 8 }}><thead><tr><th>Form 1040-X style</th><th className="n">A. As filed</th><th className="n">B. Net change</th><th className="n">C. Corrected</th></tr></thead><tbody>
      <tr><td>Federal total tax</td><td className="n">{money(view.ours.summary.federal.total_tax - fed)}</td><td className="n">{signed(fed)}</td><td className="n">{money(view.ours.summary.federal.total_tax)}</td></tr>
      <tr><td>California total tax</td><td className="n">{money(view.ours.summary.california.total_tax - ca)}</td><td className="n">{signed(ca)}</td><td className="n">{money(view.ours.summary.california.total_tax)}</td></tr>
      {adjs.map((a: any) => <tr key={a.id}><td colSpan={2}>{a.id} {a.title}</td><td colSpan={2}><Effect e={a.effect} compact /></td></tr>)}
    </tbody></table>
  );
}

// ---------- Notice ----------
export function Notice() {
  const { view, packet, ws, actor, refresh } = useStore();
  if (!view) return null;
  const n = packet.tax_agency_records.notices.find((x: any) => x.id === 'N-2025-L566');
  const received = view.notices.some((x: any) => x.id === n.id);
  const binders = view.binders.filter((b: any) => b.noticeId === n.id);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Notice response</h1><p>One click assembles a self-contained exam binder from the frozen return: acknowledgments, valuation, the gross receipts reconciliation, every source page, the review trail and the hashes that prove nothing changed after filing.</p></div></div>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <Panel title={`${n.type} — tax year ${n.tax_year}`} right={received ? <span className="pill bad">received {date(view.notices[0].at)} · respond by {n.response_due}</span> : <span className="pill">arrives 2028-01-26 in the season</span>}>
          <ol className="small" style={{ paddingLeft: 18 }}>{n.items_under_examination.map((i: string) => <li key={i} style={{ marginBottom: 4 }}>{i}</li>)}</ol>
          {!received && <div className="callout small">The letter has not arrived in this workpaper's season yet. You can still build the binder now from the current workpaper (marked DRAFT if the return is not filed), or advance the season to January 2028.</div>}
          <div className="row" style={{ marginTop: 10 }}>
            <a className="btn primary" href={`/api/ws/${ws}/binder/${n.id}?record=1&actor=${actor}`} target="_blank" rel="noreferrer" onClick={() => setTimeout(refresh, 800)}>Generate exam binder</a>
            <a className="btn" href={`/api/ws/${ws}/binder/${n.id}?download=1&actor=${actor}`}>Download (.html)</a>
          </div>
          {binders.map((b: any, i: number) => <div key={i} className="small muted" style={{ marginTop: 6 }}>Generated by {view.people.find((p: any) => p.id === b.actor)?.name} {dateTime(b.at)} · sha256 {String(b.hash).slice(0, 16)}…</div>)}
        </Panel>
        <Panel title="What the binder proves">
          <div className="col small">
            <div className="callout"><b>Noncash gifts.</b> Stock to the donor-advised fund at the high/low mean (D65), vehicle limited to the 1098-C sale price 2,900 (D66) — not the client's 6,000 estimate. Each adjustment shows who, when, why and who approved.</div>
            <div className="callout"><b>Gross receipts.</b> 1099-NEC 142,000 + 9,300 from clients with no 1099 = books 151,300 = Schedule C line 1. The 1099-K 12,400 is Atlas's card payments, already inside Atlas's 41,200 1099-NEC — not more income.</div>
            <div className="callout"><b>Integrity.</b> Frozen snapshot hash, the packet sha256, and the event log head; any later edit would break the chain.</div>
          </div>
        </Panel>
      </div>
      <Panel title="Related findings">
        {view.findings.filter((f: any) => /VEHICLE|PAYMENT_CARD|NOTICE|LOW_CONFIDENCE/.test(f.id)).map((f: any) => <div key={f.id} className="list-row" onClick={() => { location.hash = `#/findings/${encodeURIComponent(f.id)}`; }}><span className={`dot sev-${f.severity}`} style={{ marginTop: 5 }} /><span className="title" style={{ flex: 1 }}>{f.title}</span><Status s={f.status} /><Effect e={f.effect} compact /></div>)}
      </Panel>
    </div>
  );
}

// ---------- Roll-forward ----------
export function Rollforward() {
  const { view, ws, actor, refresh, toast } = useStore();
  const [pkg, setPkg] = useState<any>(null);
  useEffect(() => { api.rollforward(ws).then(setPkg).catch(() => setPkg(null)); }, [ws, view?.meta.head.seq]);
  if (!view) return null;
  const p = pkg?.pkg;
  const ro = readOnly(view);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Roll-forward to 2026</h1><p>Everything the next preparer needs, with its history: carryovers, basis, open items and a 2026 estimates plan. {view.filing.frozen ? 'Built from the frozen 2025 return.' : 'Preview: the 2025 return is not filed yet.'}</p></div><span className="spacer" />
        {!ro && view.viewer?.kind === 'staff' && <button className="btn primary" onClick={() => api.startRollforward(ws, actor).then(() => { toast({ text: '2026 file started from this package (hash recorded).', kind: 'ok' }); refresh(); }).catch((e) => toast({ text: e.message, kind: 'bad' }))}>{view.rollforward ? 'Re-run roll-forward' : 'Start the 2026 file'}</button>}
      </div>
      {view.rollforward && <div className="callout ok small" style={{ marginBottom: 12 }}>2026 file started {dateTime(view.rollforward.at)} by {view.people.find((x: any) => x.id === view.rollforward.actor)?.name} · package sha256 {view.rollforward.hash.slice(0, 16)}…</div>}
      {!p ? <Empty>Building…</Empty> : <>
        <Panel title="Carryovers and basis to 2026" pad={false}>
          <table className="t"><thead><tr><th>Item</th><th className="n">Federal</th><th className="n">California</th><th>History</th><th>Note</th></tr></thead><tbody>
            {p.carryovers.map((c: any) => <tr key={c.item}><td><b>{c.item}</b></td><td className="n">{typeof c.federal === 'object' && c.federal ? <span className="small">regular {money(c.federal.regularBasis)} / AMT {money(c.federal.amtBasis)}</span> : c.federal == null ? '—' : money(c.federal, { cents: c.federal % 1 !== 0 })}</td><td className="n">{c.california == null ? '—' : money(c.california, { cents: c.california % 1 !== 0 })}</td><td className="small">{c.history.join(' → ')}</td><td className="small muted">{c.note}</td></tr>)}
          </tbody></table>
        </Panel>
        <div className="grid2" style={{ marginTop: 12, alignItems: 'start' }}>
          <Panel title="2026 estimated tax plan" pad={false}>
            <table className="t"><thead><tr><th>Due</th><th className="n">Federal</th><th className="n">California</th></tr></thead><tbody>
              {p.plan.federal.installments.map((f: any, i: number) => { const c = p.plan.california.installments.find((x: any) => x.due === f.due); return <tr key={f.due}><td>{f.due}</td><td className="n">{money(f.amount)}</td><td className="n">{c ? `${money(c.amount)} (${Math.round(c.pct * 100)}%)` : '—'}</td></tr>; })}
              <tr className="total"><td>Annual</td><td className="n">{money(p.plan.federal.annual)}</td><td className="n">{money(p.plan.california.priorYearSafeHarbor)}</td></tr>
            </tbody></table>
            <div className="pb small"><b>Federal:</b> {p.plan.federal.basis}. <b>California:</b> {p.plan.california.basis}</div>
            <ul className="small" style={{ margin: '0 12px 12px', paddingLeft: 18 }}>{p.plan.changes.map((c: string) => <li key={c}>{c}</li>)}</ul>
          </Panel>
          <Panel title="Open items carried forward">
            {p.openItems.map((o: any) => <div key={o.id} className="row small" style={{ padding: '3px 0' }}><a href={`#/findings/${encodeURIComponent(o.id)}`} style={{ flex: 1 }}>{o.title}</a><Status s={o.status} /></div>)}
          </Panel>
        </div>
      </>}
    </div>
  );
}
