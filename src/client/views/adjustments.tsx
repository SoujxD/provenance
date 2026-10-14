import { useEffect, useState } from 'react';
import { useStore, usePacketIndex } from '../store';
import { api } from '../api';
import { Panel, Effect, Status, Who, When, Num, Empty, readOnly } from '../components/ui';
import { AdjustDialog } from '../components/dialogs';
import { lineValue, signed, money } from '../../shared/format';

export function Adjustments() {
  const { view, cmd, toast } = useStore();
  const [dlg, setDlg] = useState<any>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  if (!view) return null;
  const ro = readOnly(view);
  const role = view.viewer?.role;
  const active = view.adjustments.filter((a: any) => ['pending', 'approved'].includes(a.status));
  const sumFed = active.reduce((s: number, a: any) => s + (a.effect?.fed || 0), 0);
  const sumCa = active.reduce((s: number, a: any) => s + (a.effect?.ca || 0), 0);
  const ce = view.ours.combinedEffect;
  const approvable = view.adjustments.filter((a: any) => picked.has(a.id) && a.status === 'pending');
  const bulkApprove = async () => {
    const r = await cmd({ type: 'bulk', label: `Approve ${approvable.length} adjustments`, items: approvable.map((a: any) => ({ type: 'adjustment.approve', id: a.id })) });
    setPicked(new Set());
    toast({ text: `${r.done} approved${r.errors.length ? `; ${r.errors.length} refused — ${r.errors[0].error}` : ''}`, kind: r.errors.length ? 'bad' : 'ok', action: { label: 'Undo', run: () => cmd({ type: 'batch.undo', batch: r.batch }, { success: 'Undone.' }) } });
  };
  return (
    <div className="page">
      <div className="page-head"><div><h1>Adjustments</h1><p>Every change keeps the engine's original value, who proposed it, why, the tax effect, and who approved it. Over {money(view.standards.partner_threshold)} (or a judgment call) needs the partner.</p></div><span className="spacer" />{!ro && view.viewer?.kind === 'staff' && <button className="btn primary" onClick={() => setDlg({ changes: [{ target: '', value: '' }] })}>New adjustment</button>}</div>
      <div className="grid3">
        <Panel pad={false}><div className="stat"><div className="label">Sum of individual effects</div><div className="value"><Effect e={{ fed: sumFed, ca: sumCa, method: 'rate', estimate: true }} compact /></div><div className="sub">{active.length} active adjustments</div></div></Panel>
        <Panel pad={false}><div className="stat"><div className="label">Combined (interactions such as the SALT cap)</div><div className="value"><Effect e={ce} compact /></div><div className="sub">Interaction vs the sum: Fed {signed(ce.fed - sumFed)} · CA {signed(ce.ca - sumCa)}</div></div></Panel>
        <Panel pad={false}><div className="stat"><div className="label">Return after adjustments</div><div className="value">{money(view.ours.summary.federal.total_tax)} / {money(view.ours.summary.california.total_tax)}</div><div className="sub">federal / California total tax (estimate until the engine recomputes)</div></div></Panel>
      </div>
      {picked.size > 0 && !ro && ['reviewer', 'partner'].includes(role) && <div className="callout row" style={{ marginTop: 12 }}><b>{picked.size} selected</b><button className="btn sm primary" onClick={bulkApprove}>Approve selected</button><span className="muted small">Self-approval and over-threshold items are refused individually.</span></div>}
      <Panel title="All adjustments" pad={false}>
        {view.adjustments.length === 0 && <Empty>No adjustments yet. Open a finding and use “Apply suggested fix”, or trace any number and “Propose adjustment”.</Empty>}
        <table className="t">
          {view.adjustments.length > 0 && <thead><tr><th /><th>ID</th><th>Change</th><th>Reason</th><th>Effect</th><th>Status</th><th>By</th><th /></tr></thead>}
          <tbody>
            {[...view.adjustments].reverse().map((a: any) => (
              <tr key={a.id} style={['rejected', 'reverted'].includes(a.status) ? { opacity: 0.55 } : undefined}>
                <td><input type="checkbox" checked={picked.has(a.id)} onChange={(e) => { const n = new Set(picked); e.target.checked ? n.add(a.id) : n.delete(a.id); setPicked(n); }} /></td>
                <td className="k">{a.id}{a.layer === 'amendment' && <div className="pill warn">amendment</div>}</td>
                <td><b>{a.title}</b>{a.changes.map((c: any) => <div key={c.target} className="small"><span className="mono">{c.target}</span> {lineValue(c.original, c.target)} → <b>{lineValue(c.value, c.target)}</b></div>)}</td>
                <td className="small" style={{ maxWidth: 360 }}>{a.reason.length > 200 ? a.reason.slice(0, 198) + '…' : a.reason}{a.authority && <div className="muted">Authority: {a.authority}</div>}</td>
                <td><Effect e={a.effect} /><div className="tiny muted">needs {a.needs}</div></td>
                <td><Status s={a.status} />{a.approvedBy && <div className="tiny muted">by {view.people.find((p: any) => p.id === a.approvedBy)?.name}</div>}</td>
                <td className="small"><Who id={a.createdBy} /><div><When at={a.createdAt} /></div></td>
                <td>
                  {!ro && a.status === 'pending' && ['reviewer', 'partner'].includes(role) && <button className="btn sm primary" onClick={() => cmd({ type: 'adjustment.approve', id: a.id }, { success: `${a.id} approved.` }).catch(() => undefined)}>Approve</button>}
                  {!ro && a.status === 'pending' && ['reviewer', 'partner'].includes(role) && <button className="btn sm" onClick={() => { const note = prompt('Why reject?'); if (note) cmd({ type: 'adjustment.reject', id: a.id, note }).catch(() => undefined); }}>Reject</button>}
                  {!ro && ['pending', 'approved'].includes(a.status) && view.viewer?.kind === 'staff' && <button className="btn sm ghost" onClick={() => { const note = prompt('Why revert? (the original engine value comes back; history is kept)'); if (note) cmd({ type: 'adjustment.revert', id: a.id, note }).catch(() => undefined); }}>Revert</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      {view.batches.length > 0 && (
        <Panel title="Bulk actions (undoable)">
          {view.batches.map((b: any) => <div key={b.id} className="row small" style={{ padding: '3px 0' }}><Who id={b.actor} /><span style={{ flex: 1 }}>{b.label} · {b.count} events</span><When at={b.at} />{b.undone ? <><span className="pill">undone</span>{!ro && <button className="btn sm" onClick={() => cmd({ type: 'batch.redo', batch: b.id })}>Redo</button>}</> : !ro && <button className="btn sm" onClick={() => cmd({ type: 'batch.undo', batch: b.id }, { success: 'Undone.' })}>Undo</button>}</div>)}
        </Panel>
      )}
      <WhatIf />
      {dlg && <AdjustDialog initial={dlg} onClose={() => setDlg(null)} />}
    </div>
  );
}

function WhatIf() {
  const { view, packet, ws, actor } = useStore();
  const ix = usePacketIndex();
  const [rows, setRows] = useState<{ target: string; value: string }[]>([{ target: 'SchC.1', value: '' }]);
  const [res, setRes] = useState<any>(null);
  const [dlg, setDlg] = useState<any>(null);
  useEffect(() => {
    const ch = rows.filter((r) => r.target && r.value !== '');
    if (!ch.length) { setRes(null); return; }
    const t = setTimeout(() => api.whatif(ws, actor, ch).then(setRes).catch(() => setRes(null)), 300);
    return () => clearTimeout(t);
  }, [rows, ws, actor]);
  if (!view || !ix) return null;
  return (
    <div className="grid2" style={{ marginTop: 12, alignItems: 'start' }}>
      <Panel title="What-if sandbox" right={<span className="muted small">Nothing is recorded until you promote it.</span>}>
        <table className="t"><tbody>
          {rows.map((r, i) => (
            <tr key={i}><td><input className="mono" value={r.target} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))} placeholder="line key" style={{ width: 150 }} /></td>
              <td className="small">{ix.lines.get(view.baseVersion)?.get(r.target)?.label ?? ''}{ix.lines.get(view.baseVersion)?.get(r.target) && <> · now <Num k={r.target} /></>}</td>
              <td><input value={r.value} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder="new value" style={{ width: 110, textAlign: 'right' }} /></td></tr>
          ))}
        </tbody></table>
        <div className="row"><button className="btn sm" onClick={() => setRows([...rows, { target: '', value: '' }])}>+ Line</button><span className="spacer" />{res && <><Effect e={{ ...res.effect, method: 'rate' }} />{readOnly(view) == null && <button className="btn sm primary" onClick={() => setDlg({ title: 'From what-if sandbox', changes: rows.filter((r) => r.target && r.value !== '').map((r) => ({ target: r.target, value: Number(r.value) })) })}>Promote to adjustment…</button>}</>}</div>
        {res?.lines?.length > 0 && <div className="small muted" style={{ marginTop: 6, maxHeight: 160, overflow: 'auto' }}>{res.lines.map((l: any) => <div key={l.key}><span className="mono">{l.key}</span> {lineValue(l.before, l.key)} → {lineValue(l.after, l.key)} <span className="tiny">{l.status}</span></div>)}</div>}
      </Panel>
      <Panel title="Engine what-if alternatives (exact results)" pad={false}>
        <table className="t"><thead><tr><th>Alternative</th><th className="n">Federal tax</th><th className="n">California tax</th><th /></tr></thead><tbody>
          {packet.what_if.alternatives.map((a: any) => (
            <tr key={a.id}><td><b>{a.id.replace(/_/g, ' ')}</b><div className="small muted">{a.description}</div></td><td className="n">{signed(a.federal.total_tax_change)}</td><td className="n">{signed(a.california.total_tax_change)}</td>
              <td>{readOnly(view) == null && a.changed_lines.length > 0 && <button className="btn sm" onClick={() => setDlg({ title: a.description, whatIf: a.id, changes: a.changed_lines.filter((c: any) => /^(F4562|SchE\.(14|18)|SchCA540NR\.12\.C|FTB3885A|SchC\.13|F1040\.12)/.test(c.key)).map((c: any) => ({ target: c.key, value: c.new })), judgment: true, authority: a.id.startsWith('equipment') ? 'IRC §168(k)(7) / §179; Cal. R&TC §17255' : a.id === 'hvac_improvement' ? 'Treas. Reg. §1.263(a)-3' : '', reason: a.description })}>Adopt…</button>}</td></tr>
          ))}
        </tbody></table>
        <div className="pb small muted">Extension (April 14, from v2): federal estimated balance {money(packet.what_if.extension.federal.estimated_balance)} → paid {money(packet.what_if.extension.federal.paid_with_form_4868)} with Form 4868; California {money(packet.what_if.extension.california.estimated_balance)} → paid {money(packet.what_if.extension.california.paid_with_ftb_3519)}.</div>
      </Panel>
      {dlg && <AdjustDialog initial={dlg} onClose={() => setDlg(null)} />}
    </div>
  );
}
