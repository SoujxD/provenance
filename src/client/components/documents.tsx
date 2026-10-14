// Document rendering behind one interface. Tracing never talks to a renderer directly: it asks a
// DocumentSource to locate an extracted value and to render a page with highlights. Today the source
// is simulated from printed_content; a scan or PDF uploaded for the same document id plugs in as a
// FileDocumentSource and the same trace links keep working (positions become real boxes).
import { useMemo, useState, type ReactNode } from 'react';
import { usePacketIndex, useStore } from '../store';

export type Position = { x0: number; y0: number; x1: number; y1: number };
export type Highlight = { evId: string; page: number; box: Position; span: [number, number] | null; primary: boolean; label: string };

export interface DocumentSource {
  readonly kind: 'simulated' | 'file';
  readonly label: string;
  pageCount(): number;
  /** Where an extracted value sits: page, its box on the page, and (when the source has text) the character span. */
  locate(ev: any): Highlight | null;
  renderPage(page: number, highlights: Highlight[]): ReactNode;
}

const fmtMoney = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Text forms a value might be printed in. */
function variants(ev: any): string[] {
  const out = new Set<string>();
  if (ev.text_as_read) out.add(String(ev.text_as_read));
  const v = ev.value;
  if (typeof v === 'number') {
    out.add(fmtMoney(v));
    out.add(v.toLocaleString('en-US'));
    out.add(String(v));
    if (ev.value_type === 'percent') out.add(`${Math.round(v * 100)}%`);
  }
  if (ev.value_type === 'date' && typeof v === 'string') {
    const [y, m, d] = v.split('-');
    out.add(`${m}/${d}/${y}`);
    out.add(v);
  }
  if (typeof v === 'string') out.add(v);
  return [...out].filter((s) => s && s.length > 0).sort((a, b) => b.length - a.length);
}

function anchorFor(ev: any, text: string): number {
  const f = String(ev.field);
  const tok = f.match(/^([A-Z]+\d+|RSU-\d+|ESPP-\d+|C\d+)_/);
  if (tok) {
    const re = new RegExp(`(^|[^A-Za-z0-9-])${tok[1]}(?![0-9])`);
    const m = re.exec(text);
    if (m) return m.index;
  }
  const trip = f.match(/^trip(\d+)_/);
  if (trip) {
    const dates = [...text.matchAll(/\d{4}-\d{2}-\d{2}/g)];
    const d = dates[Number(trip[1]) - 1];
    if (d) return d.index!;
  }
  const box = f.match(/^box(\d+[a-z]?)(?:_([A-Z]+))?/i);
  if (box) {
    const i = text.search(new RegExp(`[Bb]ox ${box[1]}\\b`));
    if (i >= 0) {
      if (box[2]) { const j = text.indexOf(` ${box[2]} `, i); if (j >= 0) return j; }
      return i;
    }
  }
  const words = String(ev.label).split(/[\s-]+/).filter((w) => w.length > 3).slice(0, 2);
  for (const w of words) { const i = text.toLowerCase().indexOf(w.toLowerCase()); if (i >= 0) return i; }
  return 0;
}

export function locateInText(ev: any, text: string): [number, number] | null {
  const anchor = anchorFor(ev, text);
  let best: [number, number] | null = null;
  let bestDist = Infinity;
  for (const vtxt of variants(ev)) {
    let i = text.indexOf(vtxt);
    while (i >= 0) {
      const before = text[i - 1];
      const after = text[i + vtxt.length];
      const clean = !(before && /[0-9]/.test(before)) && !(after && /[0-9]/.test(after));
      if (clean) {
        const dist = i >= anchor ? i - anchor : (anchor - i) * 3;
        if (dist < bestDist) { best = [i, i + vtxt.length]; bestDist = dist; }
      }
      i = text.indexOf(vtxt, i + 1);
    }
    if (best && bestDist < 400) break;
  }
  return best;
}

export class SimulatedDocumentSource implements DocumentSource {
  readonly kind = 'simulated' as const;
  readonly label = 'Simulated from printed content';
  constructor(private doc: any) {}
  pageCount() { return this.doc.page_count; }
  private text(page: number) { return this.doc.pages.find((p: any) => p.page === page)?.printed_content ?? ''; }
  locate(ev: any): Highlight | null {
    if (ev.document_id !== this.doc.id) return null;
    return { evId: ev.id, page: ev.page, box: ev.position, span: locateInText(ev, this.text(ev.page)), primary: true, label: ev.label };
  }
  renderPage(page: number, highlights: Highlight[]) {
    const text = this.text(page);
    const spans = highlights.filter((h) => h.page === page && h.span).sort((a, b) => a.span![0] - b.span![0]);
    const parts: ReactNode[] = [];
    let cur = 0;
    for (const h of spans) {
      const [s, e] = h.span!;
      if (s < cur) continue;
      parts.push(text.slice(cur, s));
      parts.push(<mark key={`${h.evId}-${s}`} className={h.primary ? '' : 'soft'} title={h.label} data-primary={h.primary ? '1' : undefined}>{text.slice(s, e)}</mark>);
      cur = e;
    }
    parts.push(text.slice(cur));
    return (
      <div className="docpage">
        <span className="sim">simulated page · {this.doc.file_name}</span>
        <div className="dochead"><span>{this.doc.issuer}</span><span className="spacer" style={{ flex: 1 }} /><span>Page {page} of {this.doc.page_count}</span></div>
        {parts}
      </div>
    );
  }
}

export class FileDocumentSource implements DocumentSource {
  readonly kind = 'file' as const;
  readonly label: string;
  constructor(private doc: any, private url: string, private mime: string, name: string) { this.label = `Original file: ${name}`; }
  pageCount() { return this.mime === 'application/pdf' ? this.doc.page_count : 1; }
  locate(ev: any): Highlight | null {
    if (ev.document_id !== this.doc.id) return null;
    return { evId: ev.id, page: ev.page, box: ev.position, span: null, primary: true, label: ev.label };
  }
  renderPage(page: number, highlights: Highlight[]) {
    const boxes = highlights.filter((h) => h.page === page);
    return (
      <div style={{ position: 'relative', border: '1px solid var(--line)', background: '#fff' }}>
        {this.mime === 'application/pdf'
          ? <iframe title="original" src={`${this.url}#page=${page}`} style={{ width: '100%', height: 640, border: 0 }} />
          : <img alt={this.doc.title} src={this.url} style={{ width: '100%', display: 'block' }} />}
        {boxes.map((b) => (
          <i key={b.evId} title={b.label} style={{ position: 'absolute', left: `${b.box.x0 * 100}%`, top: `${b.box.y0 * 100}%`, width: `${(b.box.x1 - b.box.x0) * 100}%`, height: `${(b.box.y1 - b.box.y0) * 100}%`, border: '2px solid #d49b00', background: b.primary ? 'rgba(255,196,0,.35)' : 'rgba(80,140,255,.15)' }} />
        ))}
      </div>
    );
  }
}

/** Choose the best available source for a document: an uploaded original if there is one, else simulated. */
export function useDocumentSources(docId: string): DocumentSource[] {
  const ix = usePacketIndex();
  const { view, ws } = useStore();
  return useMemo(() => {
    const doc = ix?.docs.get(docId);
    if (!doc) return [];
    const files = (view?.attachments || []).filter((a: any) => a.targets.includes(`doc:${docId}`) && /^(image\/|application\/pdf)/.test(a.mime));
    return [...files.map((f: any) => new FileDocumentSource(doc, `/api/ws/${ws}/attachments/${f.id}`, f.mime, f.name)), new SimulatedDocumentSource(doc)];
  }, [ix, docId, view?.attachments, ws]);
}

export function PageMap({ boxes }: { boxes: Position[] }) {
  return (
    <div className="pagemap" title="Where the pipeline says the field sits on the page (synthetic coordinates in this packet)">
      {[0.12, 0.2, 0.28, 0.36, 0.44, 0.52, 0.6, 0.68, 0.76, 0.84].map((y) => <b key={y} style={{ top: `${y * 100}%` }} />)}
      {boxes.map((b, i) => <i key={i} style={{ left: `${b.x0 * 100}%`, top: `${b.y0 * 100}%`, width: `${Math.max(3, (b.x1 - b.x0) * 100)}%`, height: `${Math.max(2, (b.y1 - b.y0) * 100)}%` }} />)}
    </div>
  );
}

/** Document viewer used by the trace drawer and the document index. */
export function DocumentView({ docId, page: initialPage, focusEv, extraEv = [] }: { docId: string; page?: number; focusEv?: string; extraEv?: string[] }) {
  const ix = usePacketIndex();
  const sources = useDocumentSources(docId);
  const [srcIdx, setSrcIdx] = useState(0);
  const doc = ix?.docs.get(docId);
  const focus = focusEv ? ix?.ev.get(focusEv) : null;
  const [page, setPage] = useState<number>(initialPage ?? focus?.page ?? 1);
  if (!ix || !doc || !sources.length) return null;
  const src = sources[Math.min(srcIdx, sources.length - 1)];
  const pageEv = (ix.evByDoc.get(docId) || []).filter((e: any) => e.page === page);
  const highlights: Highlight[] = [];
  for (const e of pageEv) {
    const h = src.locate(e);
    if (!h) continue;
    h.primary = e.id === focusEv || extraEv.includes(e.id);
    if (h.primary || pageEv.length <= 40) highlights.push(h);
  }
  const primaryBoxes = highlights.filter((h) => h.primary).map((h) => h.box);
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row wrap">
        <b>{doc.id}</b><span>{doc.title}</span>
        <span className="spacer" />
        {sources.length > 1 && <div className="seg">{sources.map((s, i) => <button key={i} className={i === srcIdx ? 'on' : ''} onClick={() => setSrcIdx(i)}>{s.kind === 'file' ? 'Original' : 'Simulated'}</button>)}</div>}
        {doc.page_count > 1 && (
          <span className="row" style={{ gap: 4 }}>
            <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
            <span className="small">p {page}/{doc.page_count}</span>
            <button className="btn sm" disabled={page >= doc.page_count} onClick={() => setPage(page + 1)}>›</button>
          </span>
        )}
      </div>
      <div className="row muted small wrap" style={{ gap: 10 }}>
        <span>{doc.issuer}</span><span>Received {doc.received_at.slice(0, 10)} from {doc.uploaded_by}</span><span>{doc.file_name}</span>
        {doc.marked_corrected && <span className="pill warn">CORRECTED</span>}
        <span className="pill">{src.label}</span>
      </div>
      {focus && (
        <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
          <PageMap boxes={primaryBoxes} />
          <div className="kv small" style={{ flex: 1 }}>
            <div>Field</div><div><b>{focus.label}</b> <span className="mono muted">({focus.field})</span></div>
            <div>Pipeline read</div><div className="mono">"{focus.text_as_read || '(blank)'}" → {String(focus.value)}</div>
            <div>Confidence</div><div className={`conf ${focus.confidence < 0.9 ? 'lo' : ''}`}>{Math.round(focus.confidence * 100)}%</div>
            <div>Location</div><div>page {focus.page}, box ({focus.position.x0.toFixed(2)}, {focus.position.y0.toFixed(2)})–({focus.position.x1.toFixed(2)}, {focus.position.y1.toFixed(2)}){src.kind === 'simulated' && !highlights.find((h) => h.evId === focus.id)?.span ? <span className="t-high"> · not found in the printed text</span> : ''}</div>
          </div>
        </div>
      )}
      {src.renderPage(page, highlights)}
    </div>
  );
}
