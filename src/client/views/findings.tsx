import { useMemo, useState } from 'react';
import { useStore, usePacketIndex } from '../store';
import { Effect, Sev, Status, Ref, Who, When, Num, Empty, areaName, readOnly } from '../components/ui';
import { AdjustDialog, ResolveDialog, AskDialog, ReviewNoteDialog, JudgmentDialog } from '../components/dialogs';
import { lineValue, signed } from '../../shared/format';

const SOURCES: [string, string][] = [['all', 'All'], ['check', 'Our checks'], ['engine', 'Engine'], ['review_note', 'Review notes'], ['question', 'Questions'], ['variance', 'Variances'], ['outside', 'Outside filings'], ['efile', 'E-file & notices']];

export function Findings() {
  const { view, route, go, cmd, toast } = useStore();
  const q0 = new URLSearchParams(location.hash.split('?')[1] || '');
  const [src, setSrc] = useState(q0.get('source') || 'all');
  const [sev, setSev] = useState(q0.get('sev') || 'any');
  const [status, setStatus] = useState('open');
  const [area, setArea] = useState(q0.get('area') || 'any');
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [dlg, setDlg] = useState<any>(null);
  const selected = route[1] ? decodeURIComponent(route[1]) : null;
  const list = useMemo(() => {
    if (!view) return [];
    return view.findings.filter((f: any) => {
      if (src === 'outside' ? f.kind !== 'outside_filing' : src !== 'all' && f.source !== src) return false;
      if (sev !== 'any' && f.severity !== sev) return false;
      if (status === 'open' && ['resolved', 'no_change'].includes(f.status)) return false;
      if (status === 'closed' && !['resolved', 'no_change'].includes(f.status)) return false;
      if (status === 'blocking' && !(f.blocksFiling && !['resolved', 'no_change'].includes(f.status))) return false;
      if (status === 'mine' && f.owner !== view.viewer?.id) return false;
      if (area !== 'any' && f.area !== area) return false;
      if (text && !`${f.title} ${f.summary} ${f.id}`.toLowerCase().includes(text.toLowerCase())) return false;
      return true;
    });
  }, [view, src, sev, status, area, text]);
  if (!view) return null;
  const f = selected ? view.findings.find((x: any) => x.id === selected) : list[0];
  const ro = readOnly(view);
  const pickedList = view.findings.filter((x: any) => picked.has(x.id));
  const runBulk = async (label: string, items: any[]) => {
    if (!items.length) return;
    try {
      const r = await cmd({ type: 'bulk', label, items });
      setPicked(new Set());
      toast({ text: `${label}: ${r.done} done${r.errors.length ? `, ${r.errors.length} refused (${r.errors[0].error})` : ''}.`, kind: r.errors.length ? 'bad' : 'ok', action: { label: 'Undo', run: () => cmd({ type: 'batch.undo', batch: r.batch }, { success: `Undid “${label}”.` }) } });
    } catch { /* toast */ }
  };
  const changed = new Set(view.changes.targets);
  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <div className="page-head">
        <div><h1>Findings</h1><p>Engine diagnostics, our independent checks, review notes, client questions, variances and outside filings — one inbox. Open items marked “blocks filing” gate the e-file.</p></div>
      </div>
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <div className="seg">{SOURCES.map(([k, l]) => <button key={k} className={src === k ? 'on' : ''} onClick={() => setSrc(k)}>{l} <span className="muted">{view.findings.filter((x: any) => (k === 'all' ? true : k === 'outside' ? x.kind === 'outside_filing' : x.source === k) && !['resolved', 'no_change'].includes(x.status)).length}</span></button>)}</div>
        <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">Open</option><option value="blocking">Blocking filing</option><option value="mine">Assigned to me</option><option value="closed">Closed</option><option value="all">All statuses</option></select>
        <select value={sev} onChange={(e) => setSev(e.target.value)}><option value="any">Any severity</option>{['blocking', 'high', 'medium', 'low', 'info'].map((s) => <option key={s}>{s}</option>)}</select>
        <select value={area} onChange={(e) => setArea(e.target.value)}><option value="any">All areas</option>{view.areas.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <input placeholder="Filter…" value={text} onChange={(e) => setText(e.target.value)} style={{ width: 180 }} />
      </div>
      {picked.size > 0 && !ro && (
        <div className="callout row wrap" style={{ marginBottom: 10 }}>
          <b>{picked.size} selected</b>
          <button className="btn sm" onClick={() => runBulk(`Propose ${pickedList.filter((x: any) => x.proposed?.length).length} suggested fixes`, pickedList.filter((x: any) => x.proposed?.length && !x.cleared).map((x: any) => ({ type: 'adjustment.create', title: x.title, changes: x.proposed, reason: x.summary, findingIds: [x.id], judgment: !!x.judgment, authority: x.authorityHint, whatIf: x.whatIf })))}>Propose suggested fixes</button>
          <button className="btn sm" onClick={() => runBulk('Accept drafted variance explanations', pickedList.filter((x: any) => x.source === 'variance').map((x: any) => ({ type: 'finding.resolve', findingId: x.id, status: 'resolved', note: `Explained: ${x.detail?.[0] ?? x.summary}` })))}>Explain variances (drafted)</button>
          <select onChange={(e) => { if (e.target.value) runBulk(`Assign ${picked.size} to ${view.people.find((p: any) => p.id === e.target.value)?.name}`, [...picked].map((id) => ({ type: 'finding.assign', findingId: id, owner: e.target.value }))); e.target.value = ''; }}>
            <option value="">Assign to…</option>{view.people.filter((p: any) => p.kind === 'staff' && p.active).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="btn sm" onClick={() => runBulk(`Mark ${picked.size} in progress`, [...picked].map((id) => ({ type: 'finding.status', findingId: id, status: 'in_progress' })))}>Mark in progress</button>
          <button className="btn sm ghost" onClick={() => setPicked(new Set())}>Clear</button>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 44%) 1fr', gap: 12, alignItems: 'start' }}>
        <div className="panel" style={{ maxHeight: 'calc(100vh - 230px)', overflow: 'auto' }}>
          <div className="row small muted" style={{ padding: '6px 10px', borderBottom: '1px solid var(--line-2)' }}>
            <input type="checkbox" checked={list.length > 0 && list.every((x: any) => picked.has(x.id))} onChange={(e) => setPicked(e.target.checked ? new Set(list.map((x: any) => x.id)) : new Set())} aria-label="Select all" />
            <span>{list.length} shown</span>
          </div>
          {list.length === 0 && <Empty>Nothing here with these filters.</Empty>}
          {list.map((x: any) => (
            <div key={x.id} className={`list-row ${f?.id === x.id ? 'on' : ''}`} onClick={() => go(`#/findings/${encodeURIComponent(x.id)}`)}>
              <input type="checkbox" checked={picked.has(x.id)} onClick={(e) => e.stopPropagation()} onChange={(e) => { const n = new Set(picked); e.target.checked ? n.add(x.id) : n.delete(x.id); setPicked(n); }} />
              <span className={`dot sev-${x.severity}`} style={{ marginTop: 5 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="title">{changed.has(x.id) && <span className="badge-new" title="Changed since you last looked" />} {x.title}</div>
                <div className="row small muted wrap" style={{ gap: 6, marginTop: 2 }}>
                  <span>{SOURCES.find((s) => s[0] === (x.kind === 'outside_filing' ? 'outside' : x.source))?.[1]}</span>·<span>{areaName(view, x.area)}</span>
                  {x.blocksFiling && !['resolved', 'no_change'].includes(x.status) && <span className="t-high">blocks filing</span>}
                  {x.cleared && <span className="pill ok">fixed in return</span>}
                  <Status s={x.status} />{x.owner && <Who id={x.owner} />}
                </div>
              </div>
              <div className="small" style={{ textAlign: 'right' }}><Effect e={x.effect} compact /></div>
            </div>
          ))}
        </div>
        <div>{f ? <FindingDetail f={f} ro={ro} setDlg={setDlg} /> : <Empty>Select a finding.</Empty>}</div>
      </div>
      {dlg?.kind === 'adjust' && <AdjustDialog initial={dlg.initial} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'resolve' && <ResolveDialog finding={dlg.f} noChange={dlg.noChange} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'ask' && <AskDialog initial={dlg.initial} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'review' && <ReviewNoteDialog target={dlg.target} area={dlg.area} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'judgment' && <JudgmentDialog initial={dlg.initial} onClose={() => setDlg(null)} />}
    </div>
  );
}

function FindingDetail({ f, ro, setDlg }: { f: any; ro: string | null; setDlg: (d: any) => void }) {
  const { view, cmd, openTrace } = useStore();
  const ix = usePacketIndex();
  const closed = ['resolved', 'no_change'].includes(f.status);
  const reviewer = ['reviewer', 'partner', 'quality_reviewer'].includes(view.viewer?.role);
  const q = f.source === 'question' ? view.questions.find((x: any) => `Q:${x.id}` === f.id) : null;
  const adjs = view.adjustments.filter((a: any) => a.findingIds.includes(f.id));
  const judgments = view.judgments.filter((j: any) => j.findingIds.includes(f.id));
  const cur = (t: string) => (t.startsWith('household:') ? view.ours.facts[t] ?? ix?.people.get(t.slice(10).split('.')[0])?.[t.split('.')[1]] : t.startsWith('label:') ? ix?.lines.get(view.baseVersion)?.get(t.slice(6))?.label : view.ours.lines[t]?.value ?? ix?.lines.get(view.baseVersion)?.get(t)?.value);
  return (
    <div className="panel" data-tour="finding-detail">
      <div className="pb">
        <div className="row wrap"><Sev s={f.severity} /><Status s={f.status} />{f.blocksFiling && !closed && <span className="pill bad">blocks filing</span>}{f.judgment && <span className="pill info">judgment call</span>}<span className="pill">{f.kind.replace('_', ' ')}</span><span className="spacer" /><span className="mono muted tiny">{f.id}</span></div>
        <h1 style={{ marginTop: 8 }}>{f.title}</h1>
        <p style={{ margin: '6px 0' }}>{f.summary}</p>
        {f.detail?.length > 0 && <ul className="small" style={{ margin: '6px 0', paddingLeft: 18 }}>{f.detail.map((d: string, i: number) => <li key={i}>{d}</li>)}</ul>}

        <div className="grid2" style={{ marginTop: 10 }}>
          <div className="callout">
            <div className="small muted">Tax effect (amount owed)</div>
            <div style={{ fontSize: 15, marginTop: 2 }}><Effect e={f.effect} /></div>
            {f.effect?.note && <div className="tiny muted" style={{ marginTop: 4 }}>{f.effect.note}</div>}
            {f.judgment && f.effect && <div className="tiny muted">Effect of the alternative position, if adopted.</div>}
          </div>
          <div className="callout">
            <div className="small muted">Owner · area · detected</div>
            <div className="row small" style={{ marginTop: 4 }}>
              {!ro ? <select value={f.owner ?? ''} onChange={(e) => cmd({ type: 'finding.assign', findingId: f.id, owner: e.target.value || null })}><option value="">Unassigned</option>{view.people.filter((p: any) => p.kind === 'staff' && p.active).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select> : <Who id={f.owner} />}
              <a href={`#/areas/${f.area}`}>{areaName(view, f.area)}</a>
            </div>
            <div className="tiny muted" style={{ marginTop: 4 }}>Detectable from {new Date(f.detectedAt).toUTCString().slice(5, 16)}{f.rule ? ` · rule ${f.rule}` : ''}</div>
          </div>
        </div>

        {f.proposed?.length > 0 && <>
          <h3>Suggested change</h3>
          <table className="t"><thead><tr><th>Line / fact</th><th>Label</th><th className="n">Now</th><th className="n">Proposed</th><th className="n">Δ</th></tr></thead><tbody>
            {f.proposed.map((c: any) => {
              const now = cur(c.target);
              return <tr key={c.target}><td className="k">{c.target.includes(':') ? c.target : <a onClick={() => openTrace({ kind: 'line', key: c.target })}>{c.target}</a>}</td><td className="small">{c.label ?? ix?.lines.get(view.baseVersion)?.get(c.target)?.label ?? c.note ?? ''}</td>
                <td className="n">{typeof now === 'number' ? lineValue(now, c.target) : <span className="mono small">{String(now ?? 'new')}</span>}</td><td className="n"><b>{typeof c.value === 'number' ? lineValue(c.value, c.target) : <span className="mono small">{c.value}</span>}</b></td><td className="n">{typeof now === 'number' && typeof c.value === 'number' ? signed(c.value - now, true) : ''}</td></tr>;
            })}
          </tbody></table>
          {f.cleared && <div className="callout ok small">Our version of the return already reflects this change.</div>}
        </>}

        {f.authorityHint && <><h3>Authority</h3><div className="small">{f.authorityHint}</div></>}
        {f.dependsOn?.length > 0 && <><h3>{f.source === 'engine' ? 'Explained by our checks' : 'Depends on'}</h3><div className="row wrap">{f.dependsOn.map((d: string) => <a key={d} className="ref" href={`#/findings/${encodeURIComponent(d)}`}>{view.findings.find((x: any) => x.id === d)?.title ?? d}</a>)}</div></>}

        <h3>Evidence ({f.evidence.length})</h3>
        <div className="row wrap">{f.evidence.map((r: string) => <Ref key={r} r={r} />)}{f.lines.map((l: string) => (l.includes(':') ? <Ref key={l} r={l} /> : <span key={l} className="ref" onClick={() => openTrace({ kind: 'line', key: l })}>{l} = <Num k={l} /></span>))}</div>

        {q && <>
          <h3>Question & answers</h3>
          <div className="callout small"><Who id={q.from} /> → {q.to === 'client' ? 'client' : <Who id={q.to} />}: {q.text}</div>
          {q.answers.map((a: any) => <div key={a.id} className="callout ok small" style={{ marginTop: 6 }}><b>Answer (evidence {a.id})</b> by <Who id={a.by} /> <When at={a.at} />: {a.text}{a.attachments.map((x: string) => <a key={x} className="ref" href={`/api/ws/${view.meta.ws}/attachments/${x}`} target="_blank" rel="noreferrer">{x}</a>)}</div>)}
          {q.answers.length === 0 && <div className="muted small">Waiting for an answer.</div>}
        </>}

        {adjs.length > 0 && <><h3>Adjustments</h3>{adjs.map((a: any) => <div key={a.id} className="row small" style={{ padding: '3px 0' }}><a href="#/adjustments"><b>{a.id}</b></a><span style={{ flex: 1 }}>{a.title}</span><Effect e={a.effect} compact /><Status s={a.status} /></div>)}</>}
        {judgments.length > 0 && <><h3>Judgments</h3>{judgments.map((j: any) => <div key={j.id} className="callout small"><b>{j.title}</b> — {j.decision}<div className="muted">Authority: {j.authority} · <Who id={j.actor} /></div></div>)}</>}
        {f.resolution && <><h3>Resolution</h3><div className="callout ok small">{f.resolution.note}{f.resolution.authority && <div className="muted">Authority: {f.resolution.authority}</div>}<div className="muted"><Who id={f.resolution.actor} /> · <When at={f.resolution.at} /></div></div></>}

        {f.history?.length > 0 && <><h3>History</h3>{f.history.map((h: any, i: number) => <div key={i} className="row small" style={{ padding: '2px 0' }}><Who id={h.actor} /><span style={{ flex: 1 }}>{h.what}</span><When at={h.at} /></div>)}</>}

        {!ro && view.viewer?.kind === 'staff' && (
          <div className="row wrap" style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--line-2)' }}>
            {f.proposed?.length > 0 && !f.cleared && !closed && <button className="btn primary" onClick={() => setDlg({ kind: 'adjust', initial: { title: f.title, changes: f.proposed, reason: f.summary, findingIds: [f.id], judgment: !!f.judgment, authority: f.authorityHint, whatIf: f.whatIf } })}>{f.judgment ? 'Adopt alternative…' : 'Apply suggested fix…'}</button>}
            {!closed && <button className="btn" onClick={() => setDlg({ kind: 'resolve', f })}>{f.source === 'variance' ? 'Explain…' : 'Resolve…'}</button>}
            {!closed && f.source !== 'variance' && <button className="btn" onClick={() => setDlg({ kind: 'resolve', f, noChange: true })}>No change…</button>}
            {closed && <button className="btn" onClick={() => cmd({ type: 'finding.status', findingId: f.id, status: 'open', note: 'Reopened' })}>Reopen</button>}
            {!closed && <button className="btn" onClick={() => setDlg({ kind: 'ask', initial: { text: f.suggestedQuestion ?? '', refs: f.evidence.slice(0, 6), findingIds: [f.id] } })}>{f.suggestedQuestion ? 'Ask client (drafted)…' : 'Ask…'}</button>}
            {f.judgment && <button className="btn" onClick={() => setDlg({ kind: 'judgment', initial: { title: f.title, authority: f.authorityHint, refs: f.evidence, findingIds: [f.id], kind: f.kind === 'opportunity' ? 'election' : 'position' } })}>Record judgment…</button>}
            {reviewer && <button className="btn" onClick={() => setDlg({ kind: 'review', target: f.lines[0] ? `line:${f.lines[0]}` : f.id, area: f.area })}>Review note…</button>}
          </div>
        )}
        {ro && <div className="muted small" style={{ marginTop: 12 }}>{ro}.</div>}
      </div>
    </div>
  );
}
