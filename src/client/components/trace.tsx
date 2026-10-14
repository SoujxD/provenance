import { useEffect, useMemo, useState } from 'react';
import { useStore, usePacketIndex, type TraceTarget } from '../store';
import { Num, Ref, Who, When, Effect, Status, Sev, Masked } from './ui';
import { DocumentView } from './documents';
import { AdjustDialog, AskDialog, ReviewNoteDialog, VerifyDialog } from './dialogs';
import { lineValue, signed, dateTime } from '../../shared/format';

const PRIOR_KEY: Record<string, string> = { 'F1040.1z': 'F1040.1a', 'F1040.25d': 'F1040.25a', 'F8995.39': 'F8995.15', 'F8938.1.max': 'F8938', 'F540NR.13': 'CA540.13', 'F540NR.17': 'CA540.17', 'F540NR.19': 'CA540.19', 'F540NR.31': 'CA540.31', 'F540NR.64': 'CA540.64', 'F540NR.71': 'CA540.71', 'F540NR.72': 'CA540.72' };

export function TraceDrawer() {
  const { trace, closeTrace, popTrace } = useStore();
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') closeTrace(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [closeTrace]);
  if (!trace.length) return null;
  const top = trace[trace.length - 1];
  return (
    <>
      <div className="drawer-scrim" onClick={closeTrace} />
      <aside className="drawer" aria-label="Trace">
        <div className="drawer-head">
          <b>Trace</b>
          <div className="crumbs">
            {trace.map((t, i) => <span key={i} className="row" style={{ gap: 4 }}>{i > 0 && <span className="muted">›</span>}<a onClick={() => popTrace(i)}>{label(t)}</a></span>)}
          </div>
          <span className="spacer" />
          <span className="muted tiny">Esc to close</span>
          <button className="btn ghost" onClick={closeTrace} aria-label="Close">✕</button>
        </div>
        {top.kind === 'line' && <LineTrace k={top.key} version={top.version} />}
        {top.kind === 'doc' && <DocTrace id={top.id} page={top.page} ev={top.ev} />}
        {top.kind === 'ref' && <RefTrace r={top.ref} />}
      </aside>
    </>
  );
}

function label(t: TraceTarget) {
  return t.kind === 'line' ? t.key : t.kind === 'doc' ? `${t.id}${t.ev ? ` · ${t.ev}` : ''}` : t.ref;
}

function LineTrace({ k, version }: { k: string; version?: string }) {
  const { view, packet, openTrace, actor } = useStore();
  const ix = usePacketIndex();
  const [dlg, setDlg] = useState<string | null>(null);
  const base = ix?.lines.get(view?.baseVersion)?.get(k) ?? view?.ours.added.find((l: any) => l.key === k);
  const ownEv = (base?.sources || []).filter((s: string) => s.startsWith('ev-'));
  // A computed line still ends at documents: follow its inputs down to the extracted values.
  const viaInputs = useMemo(() => {
    if (ownEv.length || !ix || !view) return [] as string[];
    const out: string[] = [];
    const seen = new Set<string>();
    const walk = (key: string, depth: number) => {
      if (depth > 4 || seen.has(key) || out.length > 40) return;
      seen.add(key);
      const l = ix.lines.get(view.baseVersion)?.get(key);
      if (!l) return;
      for (const s of l.sources || []) if (s.startsWith('ev-')) out.push(s);
      for (const i of l.inputs || []) walk(i, depth + 1);
    };
    walk(k, 0);
    return out;
  }, [k, ownEv.length, ix, view]);
  const evSources = ownEv.length ? ownEv : viaInputs;
  const [focus, setFocus] = useState<string | null>(evSources[0] ?? null);
  useEffect(() => setFocus(evSources[0] ?? null), [k]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ix || !view || !base) return <div className="pb">Line {k} is not on this version of the return.</div>;
  const ours = view.ours.lines[k];
  const vals = ['v1', 'v2', 'v3'].map((v) => ({ v, line: ix.lines.get(v)?.get(k), avail: view.versions.some((x: any) => x.version === v) }));
  const pk = PRIOR_KEY[k] ?? k;
  const prior = packet.prior_years.return_2024.lines[pk];
  const findings = view.findings.filter((f: any) => f.lines.includes(k) || (f.proposed || []).some((c: any) => c.target === k));
  const adjs = view.adjustments.filter((a: any) => a.changes.some((c: any) => c.target === k));
  const verifs = view.verifications.filter((v: any) => v.target === k);
  const notes = view.notes.filter((n: any) => n.target === `line:${k}`);
  const usedBy = ix.children.get(k) || [];
  const rule = ix.rules[base.rule] ?? (base.rule === 'R-WORKPAPER-ADDED' ? 'Line added in the workpaper (an adjustment).' : '');
  const focusEv = focus ? ix.ev.get(focus) : null;
  const docIds = [...new Set(evSources.map((s: string) => ix.ev.get(s)?.document_id).filter(Boolean))] as string[];
  const staff = view.viewer?.kind === 'staff';
  const reviewerish = ['reviewer', 'partner', 'quality_reviewer'].includes(view.viewer?.role);
  return (
    <div className="drawer-body">
      <div>
        <div className="row" style={{ alignItems: 'baseline' }}>
          <span className="mono muted">{k}</span><span className="pill">{base.jurisdiction}</span>{ours && <span className={`pill ${ours.status === 'override' ? 'info' : ours.status === 'stale' ? 'warn' : ''}`}>{ours.status === 'override' ? 'changed in workpaper' : ours.status}</span>}
        </div>
        <h1 style={{ marginTop: 4 }}>{base.label}</h1>
        <div className="row wrap" style={{ marginTop: 10, gap: 14 }}>
          {prior !== undefined && <div><div className="tiny muted">2024 as filed</div><div className="num">{lineValue(prior)}</div></div>}
          {vals.map(({ v, line, avail }) => avail && <div key={v}><div className="tiny muted">Engine {v}</div><div className="num">{line ? lineValue(line.value, k) : '—'}</div></div>)}
          <div><div className="tiny muted">Ours</div><div className="num" style={{ fontWeight: 700, fontSize: 16 }}>{lineValue(ours ? ours.value : base.value, k)}</div></div>
          {typeof prior === 'number' && typeof (ours?.value ?? base.value) === 'number' && <div><div className="tiny muted">vs 2024</div><div className="num">{signed((ours?.value ?? base.value) - prior)}</div></div>}
        </div>

        <h3>Rule</h3>
        <div className="callout"><span className="mono small">{base.rule}</span> — {rule || 'Engine rule.'}{base.note && <div className="small" style={{ marginTop: 4 }}><b>Engine note:</b> {base.note}</div>}</div>

        {base.inputs?.length > 0 && <>
          <h3>How it is built ({base.inputs.length} inputs)</h3>
          <table className="t"><tbody>
            {base.inputs.slice(0, 60).map((i: string) => {
              const l = ix.lines.get(view.baseVersion)?.get(i);
              return <tr key={i} className={view.ours.lines[i] ? 'changed' : ''}><td className="k"><a onClick={() => openTrace({ kind: 'line', key: i })}>{i}</a></td><td>{l?.label}</td><td className="n"><Num k={i} /></td></tr>;
            })}
            {base.inputs.length > 60 && <tr><td colSpan={3} className="muted">+{base.inputs.length - 60} more (see the lot table in Investments)</td></tr>}
            <tr className="total"><td colSpan={2}>{base.label}</td><td className="n">{lineValue(ours ? ours.value : base.value, k)}</td></tr>
          </tbody></table>
        </>}

        {base.sources?.length > 0 && <>
          <h3>Sources</h3>
          <table className="t"><tbody>
            {base.sources.map((s: string) => {
              const e = ix.ev.get(s);
              if (e) return (
                <tr key={s} className={focus === s ? 'sel' : ''} onClick={() => setFocus(s)} style={{ cursor: 'pointer' }}>
                  <td className="k">{s}</td><td>{e.label}<div className="tiny muted">{e.document_id} p{e.page} · read "{e.text_as_read || '(blank)'}"</div></td>
                  <td className="n">{typeof e.value === 'number' ? lineValue(e.value) : String(e.value ?? '—')}</td>
                  <td className={`conf ${e.confidence < 0.9 ? 'lo' : ''}`}>{Math.round(e.confidence * 100)}%</td>
                </tr>
              );
              return <tr key={s}><td colSpan={4}><Ref r={s} /></td></tr>;
            })}
          </tbody></table>
        </>}

        {docIds.length > 0 && <>
          <h3>Everywhere {docIds.length > 1 ? 'these documents' : 'this document'} landed</h3>
          {docIds.map((d) => <Landing key={d} docId={d} />)}
        </>}

        {usedBy.length > 0 && <><h3>Used by</h3><div className="row wrap">{usedBy.map((u) => <span key={u} className="ref" onClick={() => openTrace({ kind: 'line', key: u })}>{u}</span>)}</div></>}

        {findings.length > 0 && <><h3>Findings on this line</h3>{findings.map((f: any) => (
          <div key={f.id} className="list-row" onClick={() => { location.hash = `#/findings/${encodeURIComponent(f.id)}`; }}>
            <Sev s={f.severity} /><div style={{ flex: 1 }}><div className="title">{f.title}</div><div className="row small"><Status s={f.status} /><Effect e={f.effect} compact /></div></div>
          </div>))}</>}

        {adjs.length > 0 && <><h3>Adjustments</h3>{adjs.map((a: any) => (
          <div key={a.id} className="callout small" style={{ marginBottom: 6 }}>
            <div className="row"><b>{a.id}</b><span>{a.title}</span><span className="spacer" /><Status s={a.status} /></div>
            {a.changes.filter((c: any) => c.target === k).map((c: any) => <div key={c.target}>{lineValue(c.original, k)} → <b>{lineValue(c.value, k)}</b> · {a.reason}</div>)}
            <div className="row muted">by <Who id={a.createdBy} /> {a.approvedBy && <>· approved by <Who id={a.approvedBy} /></>}<span className="spacer" /><Effect e={a.effect} compact /></div>
          </div>))}</>}

        <h3>Verification & notes</h3>
        {verifs.length === 0 && notes.length === 0 && <div className="muted small">Not verified yet.</div>}
        {verifs.map((v: any) => <div key={v.id} className="row small"><span className="pill ok">✓ {v.type.replace(/_/g, ' ')}</span><Who id={v.actor} /><When at={v.at} />{v.note && <span className="muted">— {v.note}</span>}</div>)}
        {notes.map((n: any) => <div key={n.id} className="small" style={{ marginTop: 4 }}><Who id={n.actor} /> <When at={n.at} />: {n.text}</div>)}
        {staff && !view.meta.isReplay && (
          <div className="row wrap" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => setDlg('verify')}>✓ Verify</button>
            <button className="btn" onClick={() => setDlg('adjust')}>Propose adjustment</button>
            <NoteBox target={`line:${k}`} />
            {reviewerish && <button className="btn" onClick={() => setDlg('review')}>Review note</button>}
            <button className="btn" onClick={() => setDlg('ask')}>Ask client</button>
          </div>
        )}
        {dlg === 'verify' && <VerifyDialog target={k} onClose={() => setDlg(null)} />}
        {dlg === 'adjust' && <AdjustDialog initial={{ changes: [{ target: k, value: ours ? ours.value : base.value }] }} onClose={() => setDlg(null)} />}
        {dlg === 'review' && <ReviewNoteDialog target={`line:${k}`} onClose={() => setDlg(null)} />}
        {dlg === 'ask' && <AskDialog initial={{ text: `About ${base.label} (${lineValue(ours ? ours.value : base.value, k)}): `, refs: [`line:${k}`] }} onClose={() => setDlg(null)} />}
        <div className="tiny muted" style={{ marginTop: 14 }}>Viewing as {view.viewer?.name} ({actor})</div>
      </div>
      <div>
        {!ownEv.length && viaInputs.length > 0 && <div className="callout small" style={{ marginBottom: 8 }}>Computed line — showing the documents its inputs come from ({viaInputs.length} extracted values). <div className="row wrap" style={{ marginTop: 4 }}>{viaInputs.slice(0, 12).map((s) => <span key={s} className={`ref ${focus === s ? 'on' : ''}`} onClick={() => setFocus(s)}>{ix.ev.get(s)?.document_id} · {ix.ev.get(s)?.label.slice(0, 28)}</span>)}</div></div>}
        {focusEv ? <DocumentView key={focusEv.id} docId={focusEv.document_id} focusEv={focusEv.id} page={focusEv.page} extraEv={evSources} />
          : <SourceSummary sources={base.sources} />}
      </div>
    </div>
  );
}

function NoteBox({ target }: { target: string }) {
  const { cmd } = useStore();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  if (!open) return <button className="btn" onClick={() => setOpen(true)}>Add note</button>;
  return (
    <div className="row" style={{ width: '100%' }}>
      <input autoFocus style={{ flex: 1 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Note (use @Name to mention)" onKeyDown={async (e) => { if (e.key === 'Enter' && text.trim()) { await cmd({ type: 'note.add', target, text }); setText(''); setOpen(false); } }} />
      <button className="btn primary" disabled={!text.trim()} onClick={async () => { await cmd({ type: 'note.add', target, text }); setText(''); setOpen(false); }}>Save</button>
    </div>
  );
}

function SourceSummary({ sources }: { sources: string[] }) {
  const { view } = useStore();
  if (!sources?.length) return <div className="muted">This line is computed from other lines — open an input on the left to follow it to a document.</div>;
  return <div className="col">{sources.map((s) => <RefBody key={s} r={s} />)}{view?.meta?.isReplay && <div className="muted small">Replay mode</div>}</div>;
}

function Landing({ docId }: { docId: string }) {
  const { view, openTrace } = useStore();
  const d = view?.documents.find((x: any) => x.id === docId);
  if (!d) return null;
  return (
    <div className="callout small" style={{ marginBottom: 6 }}>
      <div className="row"><a onClick={() => openTrace({ kind: 'doc', id: docId })}><b>{docId}</b></a><span>{d.title}</span><span className="spacer" /><Status s={d.status} /></div>
      {d.reason && <div className="muted">{d.reason}</div>}
      <div className="row wrap" style={{ marginTop: 4 }}>{d.landings.map((l: any) => <span key={l.key} className="ref" title={l.label} onClick={() => openTrace({ kind: 'line', key: l.key })}>{l.key}</span>)}{!d.landings.length && <span className="muted">No return line uses a value from it.</span>}</div>
    </div>
  );
}

function DocTrace({ id, page, ev }: { id: string; page?: number; ev?: string }) {
  const { view, openTrace } = useStore();
  const ix = usePacketIndex();
  const [focus, setFocus] = useState<string | undefined>(ev);
  const d = view?.documents.find((x: any) => x.id === id);
  const doc = ix?.docs.get(id);
  const evs = ix?.evByDoc.get(id) || [];
  if (!doc) return null;
  const findings = view?.findings.filter((f: any) => d?.findings.includes(f.id)) ?? [];
  return (
    <div className="drawer-body">
      <div>
        <div className="row"><span className="mono muted">{id}</span>{d && <Status s={d.status} />}{doc.marked_corrected && <span className="pill warn">CORRECTED</span>}</div>
        <h1 style={{ marginTop: 4 }}>{doc.title}</h1>
        <div className="kv small" style={{ marginTop: 8 }}>
          <div>Issuer</div><div>{doc.issuer}</div><div>Belongs to</div><div>{doc.belongs_to}</div><div>Tax year</div><div>{doc.tax_year}</div>
          <div>Received</div><div>{dateTime(doc.received_at)} from {doc.uploaded_by}</div><div>Extraction</div><div>{doc.extraction.status}, {doc.extraction.values} values{doc.extraction.reason ? ` — ${doc.extraction.reason}` : ''}</div>
          {d?.reason && <><div>Status</div><div>{d.reason}</div></>}
          {d?.duplicatePages?.length > 0 && <><div>Duplicate pages</div><div className="t-high">Page {d.duplicatePages.join(', ')} repeats an earlier page</div></>}
        </div>
        <h3>Where it landed</h3>
        {d?.landings.length ? <table className="t"><tbody>{d.landings.map((l: any) => <tr key={l.key}><td className="k"><a onClick={() => openTrace({ kind: 'line', key: l.key })}>{l.key}</a></td><td>{l.label}</td><td className="n"><Num k={l.key} /></td></tr>)}</tbody></table> : <div className="muted small">{d?.reason || 'No return line uses a value from this document.'}</div>}
        {findings.length > 0 && <><h3>Findings citing it</h3>{findings.map((f: any) => <div key={f.id} className="list-row" onClick={() => { location.hash = `#/findings/${encodeURIComponent(f.id)}`; }}><Sev s={f.severity} /><span className="title">{f.title}</span></div>)}</>}
        <h3>Extracted values ({evs.length})</h3>
        <table className="t"><tbody>{evs.slice(0, 400).map((e: any) => (
          <tr key={e.id} className={focus === e.id ? 'sel' : ''} style={{ cursor: 'pointer' }} onClick={() => setFocus(e.id)}>
            <td className="k">{e.id}</td><td>{e.label}<div className="tiny muted">p{e.page} · "{e.text_as_read}"</div></td><td className="n">{typeof e.value === 'number' ? lineValue(e.value) : String(e.value ?? '—')}</td><td className={`conf ${e.confidence < 0.9 ? 'lo' : ''}`}>{Math.round(e.confidence * 100)}%</td>
          </tr>))}</tbody></table>
      </div>
      <div><DocumentView key={`${id}-${focus}`} docId={id} page={focus ? ix?.ev.get(focus)?.page : page} focusEv={focus} /></div>
    </div>
  );
}

function RefTrace({ r }: { r: string }) {
  return <div className="drawer-body"><div><RefBody r={r} big /></div><div /></div>;
}

export function RefBody({ r, big }: { r: string; big?: boolean }) {
  const { packet, view } = useStore();
  const ix = usePacketIndex();
  const content = useMemo(() => {
    if (!packet) return null;
    if (/^qa-\d+$/.test(r)) { const q = packet.client.questionnaire.find((x: any) => x.id === r); return q && { title: `Questionnaire ${r}`, body: <><div className="small muted">{q.question}</div><div style={{ marginTop: 4 }}>“{q.answer}”</div><div className="tiny muted">{q.answered_by} · {q.answered_at.slice(0, 10)}</div></> }; }
    if (/^msg-\d+$/.test(r)) { const m = view?.messages.find((x: any) => x.id === r); return m ? { title: `Message ${r}`, body: <><div>“{m.text}”</div><div className="tiny muted">{m.from} · {m.at?.slice(0, 10)}</div></> } : { title: r, body: <div className="muted">Not received yet at this point in the season.</div> }; }
    if (/^call-\d+$/.test(r)) { const c = packet.client.call_notes.find((x: any) => x.id === r); return c && { title: `Call notes ${c.date.slice(0, 10)}`, body: <><div className="tiny muted">{c.participants.join(', ')}</div><ul>{c.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul></> }; }
    if (r.startsWith('py:') || r.startsWith('agency:')) {
      const root = r.startsWith('py:') ? packet.prior_years : packet.tax_agency_records;
      const ptr = r.replace(/^(py|agency):/, '');
      let cur: any = root;
      for (const part of ptr.split('/').filter(Boolean)) cur = cur?.[part];
      return { title: r.startsWith('py:') ? `Prior-year record ${ptr}` : `Tax agency record ${ptr}`, body: <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{typeof cur === 'object' ? JSON.stringify(cur, null, 2) : String(cur)}</pre> };
    }
    if (r.startsWith('asset:')) { const a = packet.return_versions[2].assets.find((x: any) => x.asset_id === r.slice(6)); return a && { title: `Asset ${a.asset_id}`, body: <div className="kv small"><div>Description</div><div>{a.description}</div><div>Cost</div><div>{a.cost.toLocaleString()}</div><div>Placed in service</div><div>{a.placed_in_service}</div><div>Method</div><div>{a.method}, {a.life_years} yr</div><div>Federal 2025</div><div>{a.federal.depreciation_2025.toLocaleString()}</div><div>California 2025</div><div>{a.california.depreciation_2025.toLocaleString()}</div><div>AMT</div><div>{a.amt.depreciation_2025.toLocaleString()}</div>{a.disposition && <><div>Disposed</div><div>{a.disposition.date}; unrecaptured §1250 {a.disposition.unrecaptured_1250_depreciation.toLocaleString()}</div></>}</div> }; }
    if (r.startsWith('household:')) { const p = ix?.people.get(r.slice(10).split('.')[0]); return p && { title: `${p.name} (${p.role})`, body: <div className="kv small"><div>SSN</div><div><Masked refId={`household:${p.id}.ssn`} masked={p.ssn} /></div><div>Date of birth</div><div>{p.dob}</div>{p.ip_pin && <><div>IP PIN</div><div><Masked refId={`household:${p.id}.ip_pin`} masked={p.ip_pin} /></div></>}{p.note && <><div>Note</div><div>{p.note}</div></>}</div> }; }
    if (r.startsWith('ref:param.') || r.startsWith('ref:fx.')) { const v = r.startsWith('ref:fx.') ? packet.fx_rates.SEK_per_USD[r.split('.')[2]] : packet.engine_reference.parameters[r.slice(10)]; return { title: `Engine parameter ${r.replace('ref:', '')}`, body: <pre className="mono" style={{ margin: 0 }}>{JSON.stringify(v, null, 2)}</pre> }; }
    if (r.startsWith('timeline:')) { const t = packet.timeline.find((x: any) => x.id === r.slice(9)); return t && { title: `Timeline: ${t.event.replace(/_/g, ' ')}`, body: <div>{t.at.slice(0, 10)} {t.detail}</div> }; }
    if (/^Q:|^QN-/.test(r)) { const q = view?.questions.find((x: any) => `Q:${x.id}` === r || x.id === r); return q && { title: `Question ${q.id}`, body: <><div>{q.text}</div>{q.answers.map((a: any) => <div key={a.id} className="callout small" style={{ marginTop: 6 }}>Answer by <Who id={a.by} />: {a.text}</div>)}</> }; }
    return { title: r, body: <div className="muted">Reference</div> };
  }, [r, packet, view, ix]);
  if (!content) return <div className="muted">{r}</div>;
  return <div className={big ? '' : 'callout small'}><div style={{ fontWeight: 650, marginBottom: 4 }}>{content.title}</div>{content.body}</div>;
}
