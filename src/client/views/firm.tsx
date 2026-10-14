import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { api, fileToBase64 } from '../api';
import { Panel, Who, When, Avatar, readOnly } from '../components/ui';
import { date, dateTime, money } from '../../shared/format';

export function People() {
  const { view, packet, cmd } = useStore();
  const [msg, setMsg] = useState('');
  if (!view) return null;
  const ro = readOnly(view);
  const canAssign = ['firm_administrator', 'partner'].includes(view.viewer?.role);
  const now = Date.parse(view.meta.now);
  const deadlines = [...packet.firm.deadlines.map((d: any) => ({ what: d.what, date: d.date })), ...view.areas.filter((a: any) => a.id !== 'filing').map((a: any) => ({ what: `Area review: ${a.name}`, date: a.due }))].sort((a: any, b: any) => a.date.localeCompare(b.date));
  const totB = view.areas.reduce((s: number, a: any) => s + (a.budget || 0), 0);
  const totA = view.areas.reduce((s: number, a: any) => s + a.actual, 0);
  return (
    <div className="page">
      <div className="page-head"><div><h1>People, time & deadlines</h1><p>Who is on the engagement, who owns each area, what is due, and time against budget. Assignments are restricted to the firm administrator and the partner.</p></div></div>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <Panel title="Firm staff and client users" pad={false}>
          <table className="t"><thead><tr><th>Person</th><th>Role</th><th>Clearance</th><th>Active from</th></tr></thead><tbody>
            {view.people.map((p: any) => <tr key={p.id}><td className="row"><Avatar id={p.id} /><b>{p.name}</b> {p.credential && <span className="muted">{p.credential}</span>}</td><td>{p.role.replace('_', ' ')}</td><td>{p.kind === 'client' ? '—' : p.cleared ? <span className="pill ok">cleared</span> : <span className="pill warn" title={p.note}>masked</span>}</td><td>{p.activeFrom ?? '—'} {!p.active && <span className="pill bad">inactive</span>}</td></tr>)}
          </tbody></table>
          <div className="pb small muted">PTINs on file for st-01..st-04; Helen Strand signs returns as paid preparer. Marcus Bell: background check pending — no access to full SSNs or bank numbers. Sam Adeyemi starts 2027-01-04.</div>
        </Panel>
        <Panel title="Deadlines">
          {deadlines.map((d: any, i: number) => { const days = Math.ceil((Date.parse(d.date) - now) / 86400000); return <div key={i} className="row small" style={{ padding: '3px 0' }}><span style={{ width: 92 }}>{d.date}</span><span style={{ flex: 1 }}>{d.what}</span><span className={days < 0 ? 't-high' : days < 14 ? 't-medium' : 'muted'}>{days < 0 ? `${-days} days ago` : `in ${days} days`}</span></div>; })}
        </Panel>
      </div>
      <Panel title="Assignments and time by area" right={<span className="small muted">Total {totA.toFixed(1)} of {totB} budgeted hours</span>} pad={false}>
        <table className="t"><thead><tr><th>Area</th><th>Preparer</th><th>Reviewer</th><th>Due</th><th className="n">Budget</th><th className="n">Actual</th><th style={{ width: 160 }} /></tr></thead><tbody>
          {view.areas.map((a: any) => (
            <tr key={a.id}><td><a href={`#/areas/${a.id}`}>{a.name}</a></td>
              <td>{canAssign && !ro ? <select value={a.preparer} onChange={(e) => cmd({ type: 'assignment.set', area: a.id, role: 'preparer', user: e.target.value }, { success: 'Assigned; they are notified.' })}>{view.people.filter((p: any) => p.kind === 'staff' && ['preparer', 'reviewer', 'partner'].includes(p.role)).map((p: any) => <option key={p.id} value={p.id} disabled={!p.active}>{p.name}{!p.active ? ' (inactive)' : ''}</option>)}</select> : <Who id={a.preparer} />}</td>
              <td>{canAssign && !ro ? <select value={a.reviewer} onChange={(e) => cmd({ type: 'assignment.set', area: a.id, role: 'reviewer', user: e.target.value }, { success: 'Assigned.' })}>{view.people.filter((p: any) => p.kind === 'staff' && ['reviewer', 'partner'].includes(p.role)).map((p: any) => <option key={p.id} value={p.id} disabled={!p.active}>{p.name}</option>)}</select> : <Who id={a.reviewer} />}</td>
              <td>{canAssign && !ro ? <input type="date" value={a.due} onChange={(e) => cmd({ type: 'assignment.set', area: a.id, due: e.target.value })} /> : a.due}</td>
              <td className="n">{a.budget || '—'}</td><td className="n">{a.actual.toFixed(1)}</td>
              <td>{a.budget > 0 && <div className={`bar ${a.actual > a.budget ? 'over' : ''}`}><i style={{ width: `${Math.min(100, (a.actual / a.budget) * 100)}%` }} /></div>}</td></tr>
          ))}
        </tbody></table>
      </Panel>
      <div className="grid2" style={{ marginTop: 12, alignItems: 'start' }}>
        <Panel title="Messages with the client">
          <div style={{ maxHeight: 340, overflow: 'auto' }}>{view.messages.map((m: any, i: number) => <div key={i} className="small" style={{ padding: '4px 0', borderBottom: '1px solid var(--line-2)' }}><b>{m.source === 'packet' ? m.from : view.people.find((p: any) => p.id === m.from)?.name ?? m.from}</b> <span className="muted">→ {m.to} · {date(m.at)}{m.id ? ` · ${m.id}` : ''}</span><div>{m.text}</div></div>)}</div>
          {!ro && view.viewer?.kind === 'staff' && <div className="row" style={{ marginTop: 8 }}><input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Message to the client portal" style={{ flex: 1 }} /><button className="btn" disabled={!msg.trim()} onClick={() => cmd({ type: 'message.send', text: msg }).then(() => setMsg(''))}>Send</button></div>}
        </Panel>
        <Panel title={`Notifications for ${view.viewer?.name}`}>
          {view.notifications.items.length === 0 && <div className="muted small">Nothing yet.</div>}
          {view.notifications.items.map((n: any) => <a key={n.seq} href={n.link} className="row small" style={{ padding: '3px 0', color: 'inherit' }}><Avatar id={n.actor} size={18} /><span style={{ flex: 1 }}>{n.text}</span><When at={n.at} /></a>)}
        </Panel>
      </div>
    </div>
  );
}

export function Admin() {
  const { view, cmd, ws, actor } = useStore();
  const [chain, setChain] = useState<any>(null);
  const [events, setEvents] = useState<any[] | null>(null);
  useEffect(() => { api.verify(ws).then(setChain); }, [ws, view?.meta.head.seq]);
  if (!view) return null;
  const isAdmin = view.viewer?.role === 'firm_administrator';
  const st = view.standards;
  const set = (path: string, value: any, note = '') => cmd({ type: 'standards.update', path, value, note }, { success: 'Standard updated (versioned).' }).catch(() => undefined);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Standards & audit</h1><p>Firm standards drive the checks, the gate and approvals. Only the firm administrator edits them; every change is versioned. {isAdmin ? '' : 'Switch to Jo Kimura (firm administrator) to edit.'}</p></div></div>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <Panel title="Thresholds">
          <div className="col">
            <Thr label="Variance review: flag if change over (%)" value={st.variance_review.flag_if_change_over_percent} disabled={!isAdmin} onSave={(v) => set('variance_review.flag_if_change_over_percent', Number(v))} />
            <Thr label="…and over amount ($)" value={st.variance_review.and_over_amount} disabled={!isAdmin} onSave={(v) => set('variance_review.and_over_amount', Number(v))} />
            <Thr label="Partner approval above tax effect ($)" value={st.partner_threshold} disabled={!isAdmin} onSave={(v) => set('partner_threshold', Number(v))} />
            <Thr label="Low-confidence threshold (0–1)" value={st.low_confidence_threshold} disabled={!isAdmin} onSave={(v) => set('low_confidence_threshold', Number(v))} />
            <Thr label="Record retention (years after filing)" value={st.retention_years} disabled={!isAdmin} onSave={(v) => set('retention_years', Number(v))} />
          </div>
        </Panel>
        <Panel title="Rules (enforced)">
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{st.rules.map((r: string, i: number) => <li key={i} style={{ marginBottom: 3 }}>{r}</li>)}</ul>
          <h3>Verification types</h3><div className="row wrap">{st.verification_types.map((v: string) => <span key={v} className="pill">{v.replace(/_/g, ' ')}</span>)}</div>
          <h3>Required steps</h3><ol className="small" style={{ margin: 0, paddingLeft: 18 }}>{st.required_steps.map((r: string) => <li key={r}>{r}</li>)}</ol>
          {isAdmin && <button className="btn sm" style={{ marginTop: 8 }} onClick={() => { const v = prompt('Add a verification type (snake_case)'); if (v) set('verification_types', [...st.verification_types, v.trim()], 'Added verification type'); }}>+ Verification type</button>}
        </Panel>
      </div>
      <div className="grid2" style={{ marginTop: 12, alignItems: 'start' }}>
        <Panel title="Sensitive-data view log">
          {view.unmaskLog.length === 0 && <div className="muted small">No unmasked views yet.</div>}
          {view.unmaskLog.map((u: any, i: number) => <div key={i} className="row small" style={{ padding: '2px 0' }}><Who id={u.actor} /><span style={{ flex: 1 }}>revealed {u.kind} <span className="mono">{u.ref}</span></span><span className="muted">{dateTime(u.recorded_at)}</span></div>)}
          <div className="tiny muted" style={{ marginTop: 6 }}>Partners, the administrator and quality review see everyone's reveals; others see their own.</div>
        </Panel>
        <Panel title="Audit log integrity">
          {chain && <div className={`callout ${chain.ok ? 'ok' : 'bad'} small`}>{chain.ok ? <>Hash chain intact: {chain.count} events, head <span className="mono">{chain.head.slice(0, 16)}…</span></> : <>Chain broken at event {chain.brokenAt}</>}<div>Packet sha256 <span className="mono">{chain.packetSha256.slice(0, 16)}…</span> {chain.packetSha256 === chain.recordedPacketSha256 ? '= recorded at workspace creation ✓' : '≠ recorded!'}</div></div>}
          <div className="row" style={{ marginTop: 8 }}><button className="btn sm" onClick={() => api.events(ws, actor).then((r) => setEvents(r.events)).catch(() => undefined)}>Show raw event log</button><a className="btn sm" href={`/api/ws/${ws}/events?actor=${actor}`} target="_blank" rel="noreferrer">Export JSON</a></div>
          {events && <div style={{ maxHeight: 300, overflow: 'auto', marginTop: 8 }}>{events.slice().reverse().map((e: any) => <div key={e.seq} className="mono tiny" style={{ padding: '2px 0', borderBottom: '1px solid var(--line-2)' }}>#{e.seq} {e.at.slice(0, 16)} {e.actor} {e.type} {e.subject ?? ''} · {e.hash.slice(0, 10)}</div>)}</div>}
        </Panel>
      </div>
      <Panel title="Standards history">
        {view.standardsHistory.length === 0 && <div className="muted small">Starter standards from the packet, unchanged.</div>}
        {view.standardsHistory.map((h: any, i: number) => <div key={i} className="row small"><Who id={h.actor} /><span className="mono">{h.path}</span><span>{JSON.stringify(h.before)} → <b>{JSON.stringify(h.after)}</b></span><span className="spacer" /><When at={h.at} /></div>)}
      </Panel>
    </div>
  );
}

function Thr({ label, value, onSave, disabled }: { label: string; value: any; onSave: (v: string) => void; disabled: boolean }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return <div className="row"><span className="small" style={{ flex: 1 }}>{label}</span><input value={v} onChange={(e) => setV(e.target.value)} style={{ width: 90, textAlign: 'right' }} disabled={disabled} /><button className="btn sm" disabled={disabled || v === String(value)} onClick={() => onSave(v)}>Save</button></div>;
}

// ---------- Client portal ----------
export function Portal() {
  const { view, cmd, ws, actor, toast, refresh } = useStore();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [pin, setPin] = useState('');
  const [consent, setConsent] = useState(false);
  const [msg, setMsg] = useState('');
  if (!view) return null;
  if (view.viewer?.kind !== 'client') return <div className="page"><div className="callout">The client portal is what Ngozi and Erik see. Switch to one of them in the person menu (top right).</div></div>;
  const s = view.ours.summary;
  const open = view.questions.filter((q: any) => q.status === 'open');
  const answered = view.questions.filter((q: any) => q.status !== 'open');
  const ap = view.filing.approvalRequested;
  const approved = view.filing.clientApproval;
  const upload = async (qid: string, f: File) => {
    const r = await api.attach(ws, actor, { name: f.name, mime: f.type || 'application/octet-stream', dataBase64: await fileToBase64(f), targets: [`Q:${qid}`], note: 'Uploaded by the client' });
    setAnswers((a) => ({ ...a, [`${qid}:att`]: r.id }));
    toast({ text: `Uploaded ${f.name}.`, kind: 'ok' });
    refresh();
  };
  return (
    <div className="portal">
      <h1>Hello {view.viewer.name.split(' ')[0]}</h1>
      <p className="muted">Your 2025 tax return with Miraflores. Questions from your team, your approval, and your signature are here.</p>
      {open.length > 0 && <Panel title={`Questions for you (${open.length})`}>
        {open.map((q: any) => (
          <div key={q.id} className="col" style={{ paddingBottom: 12, marginBottom: 12, borderBottom: '1px solid var(--line-2)' }}>
            <div><b>{q.text}</b> {q.required && <span className="pill warn">needed to file</span>}</div>
            <textarea value={answers[q.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} placeholder="Your answer" />
            <div className="row">
              <label className="btn sm">Attach a file…<input type="file" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && upload(q.id, e.target.files[0])} /></label>
              {answers[`${q.id}:att`] && <span className="small muted">attached ✓</span>}
              <span className="spacer" />
              <button className="btn primary" disabled={!(answers[q.id] ?? '').trim()} onClick={() => cmd({ type: 'question.answer', id: q.id, text: answers[q.id], attachments: answers[`${q.id}:att`] ? [answers[`${q.id}:att`]] : [] }, { success: 'Thanks — your answer was sent to your team.' })}>Send answer</button>
            </div>
          </div>
        ))}
      </Panel>}
      <Panel title="Your return">
        {!ap ? <div className="muted">Your team is still preparing and reviewing your return. You'll be asked to approve it here.</div> : (
          <div className="col">
            <div className="grid2">
              <div className="callout"><div className="small muted">Federal</div><div className="big">{s.federal.balance_due >= 0 ? `You owe ${money(s.federal.balance_due)}` : `Refund ${money(-s.federal.balance_due)}`}</div><div className="small muted">Total tax {money(s.federal.total_tax)} · paid {money(s.federal.payments)}</div></div>
              <div className="callout"><div className="small muted">California (part-year)</div><div className="big">{s.california.balance_due >= 0 ? `You owe ${money(s.california.balance_due)}` : `Refund ${money(-s.california.balance_due)}`}</div><div className="small muted">Total tax {money(s.california.total_tax)} · paid {money(s.california.payments)}</div></div>
            </div>
            {approved ? <div className="callout ok">Approved and signed (Form 8879 / FTB 8879) on {date(approved.at)}. {view.filing.frozen ? 'Filed and accepted.' : 'Your team will e-file it.'}</div> : (
              <div className="col">
                <label className="row small"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I have reviewed this return. Under penalties of perjury, it is true, correct and complete to the best of my knowledge, and I authorize Miraflores to e-file it (Forms 8879 and FTB 8879).</label>
                <div className="row"><input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 5))} placeholder="5-digit signature PIN" style={{ width: 170 }} inputMode="numeric" /><button className="btn primary" disabled={!consent || pin.length !== 5} onClick={() => cmd({ type: 'filing.client_approve', pin, consent }, { success: 'Signed. Thank you!' })}>Approve and sign</button></div>
              </div>
            )}
            {view.filing.frozen && <a href={`/api/ws/${ws}/client-copy`} target="_blank" rel="noreferrer">Download your copy of the filed return</a>}
          </div>
        )}
      </Panel>
      <Panel title="Messages">
        {view.messages.slice(-10).map((m: any, i: number) => <div key={i} className="small" style={{ padding: '4px 0' }}><b>{m.source === 'packet' ? m.from : view.people.find((p: any) => p.id === m.from)?.name ?? m.from}</b> <span className="muted">{date(m.at)}</span><div>{m.text}</div></div>)}
        <div className="row" style={{ marginTop: 8 }}><input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Write to your team" style={{ flex: 1 }} /><button className="btn" disabled={!msg.trim()} onClick={() => cmd({ type: 'message.send', text: msg }).then(() => setMsg(''))}>Send</button></div>
      </Panel>
      {answered.length > 0 && <Panel title="Answered">{answered.map((q: any) => <div key={q.id} className="small" style={{ marginBottom: 6 }}><b>{q.text}</b><div className="muted">You: {q.answers.at(-1)?.text}</div></div>)}</Panel>}
      <Panel title="Your documents">{view.documents.map((d: any) => <div key={d.id} className="row small"><span className="mono">{d.id}</span><span style={{ flex: 1 }}>{d.title}</span><span className="muted">{date(d.received_at)}</span></div>)}</Panel>
    </div>
  );
}
