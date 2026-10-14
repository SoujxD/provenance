import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { Panel, Status, Empty, readOnly } from '../components/ui';
import { fileToBase64, api } from '../api';
import { date } from '../../shared/format';

const STATUS_ORDER = ['used', 'partial', 'reference', 'superseded', 'duplicate', 'not_extracted', 'not_used', 'evidence'];

export function Documents() {
  const { view, openTrace } = useStore();
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const docs = useMemo(() => (view?.documents || []).filter((d: any) => (status === 'all' || d.status === status) && (!q || `${d.id} ${d.title} ${d.issuer} ${d.type}`.toLowerCase().includes(q.toLowerCase()))), [view, status, q]);
  if (!view) return null;
  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, view.documents.filter((d: any) => d.status === s).length]));
  return (
    <div className="page">
      <div className="page-head"><div><h1>Document index</h1><p>Every document in the file with its status, the reason when it was not used, and everywhere its values landed. Click a document to read it with the extracted fields highlighted.</p></div></div>
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <div className="seg"><button className={status === 'all' ? 'on' : ''} onClick={() => setStatus('all')}>All {view.documents.length}</button>{STATUS_ORDER.filter((s) => counts[s]).map((s) => <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{s.replace('_', ' ')} {counts[s]}</button>)}</div>
        <input placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Panel pad={false}>
        <table className="t">
          <thead><tr><th>ID</th><th>Document</th><th>Type</th><th>Year</th><th>Received</th><th>Status</th><th>Lands on</th><th className="n">Values</th><th>Findings</th></tr></thead>
          <tbody>
            {docs.map((d: any) => (
              <tr key={d.id} className="clickable" onClick={() => (d.type === 'workpaper_attachment' ? window.open(`/api/ws/${view.meta.ws}/attachments/${d.id}`, '_blank') : openTrace({ kind: 'doc', id: d.id }, true))}>
                <td className="k">{d.id}</td>
                <td>{d.title}<div className="tiny muted">{d.issuer} · {d.belongs_to}{d.corrected ? ' · CORRECTED' : ''}</div></td>
                <td className="small">{d.type}</td><td>{d.tax_year}</td><td className="small">{date(d.received_at)}<div className="tiny muted">{d.uploaded_by}</div></td>
                <td><Status s={d.status} />{d.reason && <div className="tiny muted" style={{ maxWidth: 260 }}>{d.reason}</div>}{d.duplicatePages.length > 0 && <div className="tiny t-high">duplicate page {d.duplicatePages.join(', ')}</div>}</td>
                <td className="small">{d.landings.slice(0, 4).map((l: any) => <span key={l.key} className="ref" style={{ marginRight: 3 }} onClick={(e) => { e.stopPropagation(); openTrace({ kind: 'line', key: l.key }, true); }}>{l.key}</span>)}{d.landings.length > 4 && <span className="muted"> +{d.landings.length - 4}</span>}</td>
                <td className="n">{d.values}{d.lowConfidence > 0 && <div className="tiny t-high">{d.lowConfidence} &lt;90%</div>}</td>
                <td>{d.findings.length > 0 && <span className="pill warn">{d.findings.length}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {docs.length === 0 && <Empty>No documents match.</Empty>}
      </Panel>
      <AttachPanel />
    </div>
  );
}

export function AttachPanel({ defaultTarget = '' }: { defaultTarget?: string }) {
  const { view, ws, actor, refresh, toast } = useStore();
  const [target, setTarget] = useState(defaultTarget);
  const [note, setNote] = useState('');
  const ro = readOnly(view);
  if (ro) return null;
  return (
    <Panel title="Attach evidence" right={<span className="muted small">Any file, scan or note. Attach a scan to a document id (doc:D47) and the viewer offers it as the original, with the same trace highlights.</span>}>
      <div className="row wrap">
        <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Attach to (finding id, line key, or doc:D23)" style={{ width: 300 }} />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" style={{ flex: 1, minWidth: 160 }} />
        <label className="btn">Choose file…<input type="file" style={{ display: 'none' }} onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            await api.attach(ws, actor, { name: f.name, mime: f.type || 'application/octet-stream', dataBase64: await fileToBase64(f), targets: target ? [target] : [], note });
            toast({ text: `Attached ${f.name} (hash stored).`, kind: 'ok' });
            refresh();
          } catch (err: any) { toast({ text: err.message, kind: 'bad' }); }
        }} /></label>
      </div>
      {view.attachments.length > 0 && <div className="small" style={{ marginTop: 8 }}>{view.attachments.map((a: any) => <div key={a.id}><a href={`/api/ws/${view.meta.ws}/attachments/${a.id}`} target="_blank" rel="noreferrer">{a.name}</a> <span className="muted">→ {a.targets.join(', ') || 'file'} · sha256 {a.sha256.slice(0, 12)}…</span></div>)}</div>}
    </Panel>
  );
}
