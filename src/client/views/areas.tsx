import { useMemo, useState } from 'react';
import { useStore, usePacketIndex } from '../store';
import { Num, Panel, Effect, Sev, Status, Who, When, Empty, readOnly } from '../components/ui';
import { AREA_PANELS } from './panels';
import { areaForLine } from '../../shared/types';
import { lineValue, signed } from '../../shared/format';

export function AreaList() {
  const { view, go, cmd, toast } = useStore();
  if (!view) return null;
  const role = view.viewer?.role;
  const level = role === 'preparer' ? 'preparer' : ['reviewer', 'partner'].includes(role) ? 'reviewer' : null;
  const todo = level ? view.areas.filter((a: any) => a.id !== 'filing' && (a.lines || a.total) && !a.signoffs.some((s: any) => s.level === level && s.valid)) : [];
  const bulkSign = async () => {
    const r = await cmd({ type: 'bulk', label: `Sign off ${todo.length} areas as ${level}`, items: todo.map((a: any) => ({ type: 'signoff', scope: `area:${a.id}`, level })) });
    toast({ text: `${r.done} signed${r.errors.length ? `; ${r.errors.length} refused — ${r.errors[0].error}` : ''}`, kind: r.errors.length ? 'bad' : 'ok', action: { label: 'Undo', run: () => cmd({ type: 'batch.undo', batch: r.batch }, { success: 'Undone.' }) } });
  };
  return (
    <div className="page">
      <div className="page-head"><div><h1>Areas</h1><p>Each area is a workpaper: its lines, findings, evidence, sign-offs and time. Sign-offs reopen automatically when what was signed changes.</p></div><span className="spacer" />{level && todo.length > 0 && !readOnly(view) && <button className="btn primary" onClick={bulkSign}>Sign off {todo.length} areas as {level}</button>}</div>
      <div className="grid3">
        {view.areas.map((a: any) => {
          const prep = a.signoffs.find((x: any) => x.level === 'preparer');
          const rev = a.signoffs.find((x: any) => x.level === 'reviewer');
          return (
            <div key={a.id} className="panel clickable" onClick={() => go(`#/areas/${a.id}`)}>
              <div className="pb">
                <div className="row"><b>{a.name}</b><span className="spacer" />{a.blocking > 0 ? <span className="pill bad">{a.blocking} blocking</span> : a.open > 0 ? <span className="pill warn">{a.open} open</span> : <span className="pill ok">clear</span>}</div>
                <div className="row small muted" style={{ marginTop: 6 }}><span>{a.lines} lines</span>·<span>{a.total} findings</span>·<span>prep <Who id={a.preparer} /></span></div>
                <div className="row small" style={{ marginTop: 6, gap: 6 }}>
                  <SignChip so={prep} label="Preparer" /><SignChip so={rev} label="Reviewer" />
                </div>
                {a.budget > 0 && <div style={{ marginTop: 8 }}><div className="row tiny muted"><span>Time {a.actual.toFixed(1)} / {a.budget} h</span></div><div className={`bar ${a.actual > a.budget ? 'over' : ''}`}><i style={{ width: `${Math.min(100, (a.actual / a.budget) * 100)}%` }} /></div></div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SignChip({ so, label }: { so: any; label: string }) {
  if (!so) return <span className="pill">{label}: —</span>;
  return <span className={`pill ${so.valid ? 'ok' : 'warn'}`} title={so.valid ? `Signed ${so.at}` : `Reopened: ${so.changes.join('; ')}`}>{label}: {so.actorName.split(' ')[0]} {so.valid ? '✓' : '↺ reopened'}</span>;
}

export function AreaPage({ id }: { id: string }) {
  const { view, cmd, go } = useStore();
  const ix = usePacketIndex();
  const [tab, setTab] = useState('workpaper');
  const area = view?.areas.find((a: any) => a.id === id);
  if (!view || !area || !ix) return null;
  const Specific = AREA_PANELS[id];
  const findings = view.findings.filter((f: any) => f.area === id);
  const ro = readOnly(view);
  return (
    <div className="page">
      <div className="page-head">
        <div><div className="small"><a href="#/areas">Areas</a> ›</div><h1>{area.name}</h1></div>
        <span className="spacer" />
        <div className="row small"><span className="muted">Preparer</span><Who id={area.preparer} /><span className="muted">Reviewer</span><Who id={area.reviewer} /></div>
      </div>
      <SignoffBar area={area} ro={ro} />
      <div className="tabs">
        {[['workpaper', 'Workpaper'], ['lines', `Lines (${area.lines})`], ['findings', `Findings (${findings.length})`], ['time', 'Time & status']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'workpaper' && (Specific ? <Specific /> : <Empty>Use the Lines and Findings tabs.</Empty>)}
      {tab === 'lines' && <AreaLines area={id} />}
      {tab === 'findings' && (
        <Panel pad={false}>
          {findings.length === 0 && <Empty>No findings in this area.</Empty>}
          {findings.map((f: any) => <div key={f.id} className="list-row" onClick={() => go(`#/findings/${encodeURIComponent(f.id)}`)}><Sev s={f.severity} /><div style={{ flex: 1 }}><div className="title">{f.title}</div><div className="row small"><Status s={f.status} />{f.blocksFiling && !['resolved', 'no_change'].includes(f.status) && <span className="t-high">blocks filing</span>}</div></div><Effect e={f.effect} compact /></div>)}
        </Panel>
      )}
      {tab === 'time' && <AreaTime area={area} ro={ro} />}
      {tab === 'workpaper' && findings.filter((f: any) => !['resolved', 'no_change'].includes(f.status)).length > 0 && (
        <Panel title="Open findings in this area" right={<a href={`#/findings?area=${id}`}>Inbox →</a>}>
          {findings.filter((f: any) => !['resolved', 'no_change'].includes(f.status)).slice(0, 8).map((f: any) => <div key={f.id} className="list-row" onClick={() => go(`#/findings/${encodeURIComponent(f.id)}`)}><span className={`dot sev-${f.severity}`} style={{ marginTop: 5 }} /><span className="title" style={{ flex: 1 }}>{f.title}</span><Effect e={f.effect} compact /></div>)}
        </Panel>
      )}
    </div>
  );
}

function SignoffBar({ area, ro }: { area: any; ro: string | null }) {
  const { view, cmd } = useStore();
  const role = view.viewer?.role;
  const prep = area.signoffs.find((x: any) => x.level === 'preparer');
  const rev = area.signoffs.find((x: any) => x.level === 'reviewer');
  const sign = (level: string) => cmd({ type: 'signoff', scope: `area:${area.id}`, level }, { success: `${level === 'preparer' ? 'Preparer' : 'Reviewer'} sign-off recorded (hash of what you signed stored).` }).catch(() => undefined);
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="pb row wrap" style={{ gap: 14 }}>
        {[['Preparer', prep, 'preparer'], ['Reviewer', rev, 'reviewer']].map(([label, so, level]: any) => (
          <div key={level} className="row" style={{ gap: 8 }}>
            <b className="small">{label}</b>
            {so ? (so.valid ? <span className="pill ok">✓ {so.actorName} · {new Date(so.at).toUTCString().slice(5, 16)}</span> : <span className="pill warn" title={so.changes.join('\n')}>↺ reopened — signed by {so.actorName}</span>) : <span className="pill">not signed</span>}
            {!ro && ((level === 'preparer' && role === 'preparer') || (level === 'reviewer' && ['reviewer', 'partner'].includes(role))) && (!so || !so.valid) && <button className="btn sm primary" onClick={() => sign(level)}>Sign off as {level}</button>}
          </div>
        ))}
        <span className="spacer" />
        <span className="muted tiny">A person may not review work they prepared (enforced).</span>
      </div>
      {[prep, rev].filter((so) => so && !so.valid).map((so: any) => (
        <div key={so.id} className="callout warn small" style={{ margin: '0 12px 10px' }}>
          <b>{so.level === 'preparer' ? 'Preparer' : 'Reviewer'} sign-off reopened</b> — what changed since {so.actorName} signed:
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{so.changes.map((c: string, i: number) => <li key={i} className="mono tiny">{c}</li>)}</ul>
        </div>
      ))}
    </div>
  );
}

export function AreaLines({ area, filter }: { area: string; filter?: (k: string) => boolean }) {
  const { view, packet, cmd, toast } = useStore();
  const ix = usePacketIndex();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const keys = useMemo(() => ix ? [...ix.lines.get(view.baseVersion)!.values()].filter((l: any) => areaForLine(l.key) === area && !/^F8949\.[A-Z]\.(X|M|N|C)\d/.test(l.key)).map((l: any) => l.key).filter((k: string) => !filter || filter(k)) : [], [ix, view.baseVersion, area, filter]);
  const py = packet.prior_years.return_2024.lines;
  const verified = (k: string) => view.verifications.filter((v: any) => v.target === k);
  const changed = new Set(view.changes.targets);
  const ro = readOnly(view);
  const bulkVerify = async () => {
    const r = await cmd({ type: 'bulk', label: `Verify ${picked.size} lines (agreed to source document)`, items: [...picked].map((k) => ({ type: 'verification.record', target: k, verificationType: 'agreed_to_source_document', note: 'Bulk: agreed to the cited source documents' })) });
    setPicked(new Set());
    toast({ text: `${r.done} lines verified.`, kind: 'ok', action: { label: 'Undo', run: () => cmd({ type: 'batch.undo', batch: r.batch }, { success: 'Undone.' }) } });
  };
  return (
    <Panel pad={false} title={`${keys.length} lines`} right={!ro && picked.size > 0 && <button className="btn sm primary" onClick={bulkVerify}>✓ Verify {picked.size} selected</button>}>
      <div style={{ maxHeight: 620, overflow: 'auto' }}>
        <table className="t">
          <thead><tr><th style={{ width: 24 }}><input type="checkbox" onChange={(e) => setPicked(e.target.checked ? new Set(keys) : new Set())} aria-label="Select all lines" /></th><th>Line</th><th>Label</th><th className="n">2024</th><th className="n">Engine {view.baseVersion}</th><th className="n">Ours</th><th>Status</th><th>Verified</th></tr></thead>
          <tbody>
            {keys.map((k: string) => {
              const l = ix!.lines.get(view.baseVersion)!.get(k);
              const o = view.ours.lines[k];
              const v = verified(k);
              return (
                <tr key={k} className={o ? 'changed' : ''}>
                  <td><input type="checkbox" checked={picked.has(k)} onChange={(e) => { const n = new Set(picked); e.target.checked ? n.add(k) : n.delete(k); setPicked(n); }} /></td>
                  <td className="k">{changed.has(k) && <span className="badge-new" />} {k}</td><td>{l.label}</td>
                  <td className="n">{py[k] !== undefined ? lineValue(py[k]) : ''}</td>
                  <td className="n">{lineValue(l.value, k)}</td>
                  <td className="n"><Num k={k} /></td>
                  <td>{o && <span className={`pill ${o.status === 'override' ? 'info' : o.status === 'stale' ? 'warn' : ''}`}>{o.status}</span>}</td>
                  <td>{v.length ? <span className="pill ok" title={v.map((x: any) => `${x.type} by ${x.actor}`).join('\n')}>✓ {v[0].type.split('_')[0]}{v.length > 1 ? ` +${v.length - 1}` : ''}</span> : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function AreaTime({ area, ro }: { area: any; ro: string | null }) {
  const { view, cmd } = useStore();
  const [hours, setHours] = useState('0.5');
  const [note, setNote] = useState('');
  const entries = view.time.filter((t: any) => t.area === area.id);
  const st = view.areaStatus[area.id];
  return (
    <div className="grid2">
      <Panel title="Time against budget">
        <div className="row"><b>{area.actual.toFixed(1)} h</b><span className="muted">of {area.budget} h budget ({area.budgetKey?.replace(/_/g, ' ') ?? 'no budget line'})</span></div>
        <div className={`bar ${area.actual > area.budget ? 'over' : ''}`} style={{ margin: '6px 0 10px' }}><i style={{ width: `${Math.min(100, area.budget ? (area.actual / area.budget) * 100 : 0)}%` }} /></div>
        {!ro && <div className="row"><input value={hours} onChange={(e) => setHours(e.target.value)} style={{ width: 60 }} aria-label="Hours" /><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done" style={{ flex: 1 }} /><button className="btn" onClick={() => cmd({ type: 'time.log', area: area.id, hours: Number(hours), note }, { success: 'Time logged.' }).then(() => setNote(''))}>Log time</button></div>}
        {entries.map((t: any, i: number) => <div key={i} className="row small" style={{ padding: '3px 0' }}><Who id={t.actor} /><b>{t.hours} h</b><span style={{ flex: 1 }}>{t.note}</span><When at={t.at} /></div>)}
      </Panel>
      <Panel title="Area considered">
        <p className="small muted" style={{ marginTop: 0 }}>Completeness: every area is either worked or marked not applicable with a reason.</p>
        {st ? <div className="callout ok small"><b>{st.status.replace('_', ' ')}</b> — {st.note} · <Who id={st.actor} /></div> : <div className="muted small">Not marked yet.</div>}
        {!ro && <div className="row" style={{ marginTop: 8 }}><button className="btn sm" onClick={() => cmd({ type: 'area.status', area: area.id, status: 'considered', note: 'Worked and reviewed in the workpaper' })}>Mark considered</button></div>}
      </Panel>
    </div>
  );
}
