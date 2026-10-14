import { useEffect, useState } from 'react';
import { useStore, usePacketIndex } from '../store';
import { api } from '../api';
import { Modal, Field, Effect, Num } from './ui';
import { lineValue } from '../../shared/format';

type Change = { target: string; value: any; label?: string; addTo?: string; caSource?: boolean; category?: string; note?: string };

const CATEGORIES = ['', 'wages', 'interest', 'schc_profit', 'stcg', 'ltcg', 'ordinary_income', 'adjustment', 'salt', 'itemized', 'ca_source_income'];

export function AdjustDialog({ initial, onClose }: { initial: { title?: string; changes: Change[]; reason?: string; findingIds?: string[]; judgment?: boolean; authority?: string; whatIf?: string }; onClose: () => void }) {
  const { cmd, ws, actor, view, toast } = useStore();
  const ix = usePacketIndex();
  const [changes, setChanges] = useState<Change[]>(initial.changes.map((c) => ({ ...c })));
  const [title, setTitle] = useState(initial.title ?? '');
  const [reason, setReason] = useState(initial.reason ?? '');
  const [judgment, setJudgment] = useState(!!initial.judgment);
  const [authority, setAuthority] = useState(initial.authority ?? '');
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const cur = (t: string) => {
    if (t.startsWith('household:')) { const [pid, f] = t.slice(10).split('.'); return view?.ours.facts[t] ?? ix?.people.get(pid)?.[f]; }
    if (t.startsWith('label:')) return ix?.lines.get(view.baseVersion)?.get(t.slice(6))?.label;
    return view?.ours.lines[t]?.value ?? ix?.lines.get(view?.baseVersion)?.get(t)?.value;
  };
  useEffect(() => {
    const numeric = changes.filter((c) => !c.target.includes(':') && c.value !== '' && !Number.isNaN(Number(c.value)));
    if (!numeric.length) { setPreview(null); return; }
    const t = setTimeout(() => api.whatif(ws, actor, numeric).then(setPreview).catch(() => setPreview(null)), 250);
    return () => clearTimeout(t);
  }, [changes, ws, actor]);
  const set = (i: number, patch: Partial<Change>) => setChanges((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const wi = initial.whatIf ? view?.findings.find((f: any) => f.whatIf === initial.whatIf)?.effect : null;
  const threshold = view?.standards?.partner_threshold ?? 1000;
  const eff = wi ?? preview?.effect;
  const needsPartner = judgment || (eff && Math.max(Math.abs(eff.fed), Math.abs(eff.ca)) > threshold);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await cmd({ type: 'adjustment.create', title: title || reason.slice(0, 60), changes, reason, findingIds: initial.findingIds, judgment, authority, whatIf: initial.whatIf });
      onClose();
      toast({ text: `${r.id} proposed — needs ${r.needs} approval.`, kind: 'ok' });
    } catch { /* toast shown */ } finally { setBusy(false); }
  };
  return (
    <Modal title="Propose an adjustment" onClose={onClose} wide footer={<>
      <span className="muted small" style={{ marginRight: 'auto' }}>The original value is kept; this is recorded with who, when, why and the tax effect.</span>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !reason.trim() || (judgment && !authority.trim())} onClick={submit}>Propose</button></>}>
      <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short name for the change" /></Field>
      <table className="t">
        <thead><tr><th>Line or fact</th><th className="n">Current</th><th className="n">New value</th><th>Tax category</th><th>CA-source</th><th /></tr></thead>
        <tbody>
          {changes.map((c, i) => (
            <tr key={i}>
              <td><input value={c.target} onChange={(e) => set(i, { target: e.target.value })} className="mono" style={{ width: 170 }} /><div className="tiny muted">{c.label ?? ix?.lines.get(view?.baseVersion)?.get(c.target)?.label ?? (c.addTo ? `new line, adds to ${c.addTo}` : '')}</div></td>
              <td className="n">{typeof cur(c.target) === 'number' ? <Num k={c.target} /> : <span className="mono small">{String(cur(c.target) ?? '—')}</span>}</td>
              <td className="n"><input value={c.value} onChange={(e) => set(i, { value: e.target.value })} style={{ width: 130, textAlign: 'right' }} /></td>
              <td><select value={c.category ?? ''} onChange={(e) => set(i, { category: e.target.value || undefined })}>{CATEGORIES.map((x) => <option key={x} value={x}>{x || 'auto (by line)'}</option>)}</select></td>
              <td><input type="checkbox" checked={!!c.caSource} onChange={(e) => set(i, { caSource: e.target.checked })} title="Item is fully California-source (sale during CA residency, CA property)" /></td>
              <td><button className="btn sm ghost" onClick={() => setChanges((cs) => cs.filter((_, j) => j !== i))} aria-label="Remove">✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div><button className="btn sm" onClick={() => setChanges((cs) => [...cs, { target: '', value: '' }])}>+ Add a line</button></div>
      <div className="callout">
        <div className="row"><b>Tax effect</b><span className="spacer" />{eff ? <Effect e={wi ?? { ...eff, method: 'rate', estimate: true }} /> : <span className="muted small">Enter numeric values to preview</span>}</div>
        {preview?.lines?.length > 0 && <div className="small muted" style={{ marginTop: 4 }}>Recomputed: {preview.lines.slice(0, 8).map((l: any) => `${l.key} ${lineValue(l.before, l.key)} → ${lineValue(l.after, l.key)}${l.status === 'stale' ? ' (engine)' : ''}`).join(' · ')}{preview.lines.length > 8 ? ` · +${preview.lines.length - 8} more` : ''}</div>}
        {needsPartner && <div className="small t-high" style={{ marginTop: 4 }}>Over {threshold.toLocaleString()} or a judgment call: partner approval required (firm standard).</div>}
      </div>
      <Field label="Reason (required)"><textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What is wrong, and what evidence supports the new value" /></Field>
      <label className="row small"><input type="checkbox" checked={judgment} onChange={(e) => setJudgment(e.target.checked)} /> This is a judgment call (records the authority relied on)</label>
      {judgment && <Field label="Authority relied on (required)"><input value={authority} onChange={(e) => setAuthority(e.target.value)} placeholder="e.g. Treas. Reg. §1.263(a)-3(k)" /></Field>}
    </Modal>
  );
}

export function ResolveDialog({ finding, onClose, noChange }: { finding: any; onClose: () => void; noChange?: boolean }) {
  const { cmd } = useStore();
  const [note, setNote] = useState(finding.source === 'variance' ? (finding.detail?.[0] ?? '') : '');
  const [authority, setAuthority] = useState(finding.authorityHint ?? '');
  const go = async () => {
    try { await cmd({ type: 'finding.resolve', findingId: finding.id, status: noChange ? 'no_change' : 'resolved', note, authority: finding.judgment ? authority : undefined }, { success: 'Recorded.' }); onClose(); } catch { /* toast */ }
  };
  return (
    <Modal title={noChange ? 'Close with no change' : finding.source === 'variance' ? 'Explain variance' : 'Resolve finding'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!note.trim() || (finding.judgment && !authority.trim())} onClick={go}>Save</button></>}>
      <div className="small"><b>{finding.title}</b></div>
      <Field label={finding.source === 'variance' ? 'Explanation' : 'How it was resolved / why no change'}><textarea value={note} onChange={(e) => setNote(e.target.value)} autoFocus /></Field>
      {finding.judgment && <Field label="Authority relied on (required for judgment calls)"><input value={authority} onChange={(e) => setAuthority(e.target.value)} /></Field>}
    </Modal>
  );
}

export function AskDialog({ initial, onClose }: { initial: { to?: string; text?: string; refs?: string[]; findingIds?: string[] }; onClose: () => void }) {
  const { cmd, view } = useStore();
  const [to, setTo] = useState(initial.to ?? 'client');
  const [text, setText] = useState(initial.text ?? '');
  const [required, setRequired] = useState(true);
  const go = async () => {
    try { await cmd({ type: 'question.ask', to, text, refs: initial.refs ?? [], findingIds: initial.findingIds ?? [], required }, { success: to === 'client' ? 'Sent to the client portal.' : 'Question sent.' }); onClose(); } catch { /* toast */ }
  };
  return (
    <Modal title="Ask a question" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!text.trim()} onClick={go}>Send</button></>}>
      <Field label="To"><select value={to} onChange={(e) => setTo(e.target.value)}>
        <option value="client">Client (Ngozi & Erik, via portal)</option>
        {view?.people.filter((p: any) => p.kind === 'staff' && p.active).map((p: any) => <option key={p.id} value={p.id}>{p.name} — {p.role.replace('_', ' ')}</option>)}
      </select></Field>
      <Field label="Question" hint="The answer is stored as evidence and linked to this finding."><textarea value={text} onChange={(e) => setText(e.target.value)} autoFocus /></Field>
      <label className="row small"><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required before filing (blocks the filing gate until answered)</label>
    </Modal>
  );
}

export function ReviewNoteDialog({ target, area, onClose }: { target: string; area?: string; onClose: () => void }) {
  const { cmd, view } = useStore();
  const [text, setText] = useState('');
  const [blocking, setBlocking] = useState(true);
  const [to, setTo] = useState('');
  const go = async () => {
    try { await cmd({ type: 'review_note.create', target, area, text, blocking, to: to || null }, { success: 'Review note added.' }); onClose(); } catch { /* toast */ }
  };
  return (
    <Modal title="Review note" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!text.trim()} onClick={go}>Add note</button></>}>
      <div className="small muted">On <span className="mono">{target}</span></div>
      <Field label="Note"><textarea value={text} onChange={(e) => setText(e.target.value)} autoFocus /></Field>
      <Field label="For"><select value={to} onChange={(e) => setTo(e.target.value)}><option value="">Area preparer</option>{view?.people.filter((p: any) => p.kind === 'staff' && p.active).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <label className="row small"><input type="checkbox" checked={blocking} onChange={(e) => setBlocking(e.target.checked)} /> Blocks filing until cleared (firm standard: open review notes block filing)</label>
    </Modal>
  );
}

export function VerifyDialog({ target, onClose }: { target: string; onClose: () => void }) {
  const { cmd, view } = useStore();
  const types: string[] = view?.standards?.verification_types ?? [];
  const [type, setType] = useState(types[0] ?? '');
  const [note, setNote] = useState('');
  const go = async () => {
    try { await cmd({ type: 'verification.record', target, verificationType: type, note }, { success: 'Verification recorded.' }); onClose(); } catch { /* toast */ }
  };
  return (
    <Modal title="Record verification" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={go}>Record</button></>}>
      <div className="small muted">How was <span className="mono">{target}</span> verified?</div>
      <div className="col">{types.map((t) => <label key={t} className="row"><input type="radio" checked={type === t} onChange={() => setType(t)} /> {t.replace(/_/g, ' ')}</label>)}</div>
      <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. agreed to W-2 box 1, D08 and D09" /></Field>
    </Modal>
  );
}

export function JudgmentDialog({ initial, onClose }: { initial: { kind?: string; title?: string; decision?: string; authority?: string; refs?: string[]; findingIds?: string[] }; onClose: () => void }) {
  const { cmd } = useStore();
  const [kind, setKind] = useState(initial.kind ?? 'position');
  const [title, setTitle] = useState(initial.title ?? '');
  const [decision, setDecision] = useState(initial.decision ?? '');
  const [authority, setAuthority] = useState(initial.authority ?? '');
  const go = async () => {
    try { await cmd({ type: 'judgment.record', kind, title, decision, authority, refs: initial.refs, findingIds: initial.findingIds }, { success: 'Judgment recorded.' }); onClose(); } catch { /* toast */ }
  };
  return (
    <Modal title="Record a judgment" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!title.trim() || !decision.trim() || !authority.trim()} onClick={go}>Record</button></>}>
      <Field label="Kind"><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="position">Position / judgment call</option><option value="election">Election</option><option value="penalty">Penalty decision</option><option value="due_diligence">Due diligence</option></select></Field>
      <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Decision and reasoning"><textarea value={decision} onChange={(e) => setDecision(e.target.value)} /></Field>
      <Field label="Authority relied on (required)"><input value={authority} onChange={(e) => setAuthority(e.target.value)} /></Field>
    </Modal>
  );
}
