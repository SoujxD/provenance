import { useEffect, useState, type ReactNode } from 'react';
import { useStore, useLine, usePacketIndex } from '../store';
import { lineValue, signed, money, date } from '../../shared/format';

const COLORS = ['#1f5f8b', '#7a3e9d', '#2f7d4f', '#b35c1e', '#9c2f5a', '#3b6c8f', '#6b5b1e', '#4b4f9b'];
export function Avatar({ id, size = 22 }: { id: string; size?: number }) {
  const { view } = useStore();
  const p = view?.people?.find((x: any) => x.id === id);
  const name = p?.name ?? id;
  const initials = name.split(' ').map((x: string) => x[0]).slice(0, 2).join('');
  const color = COLORS[[...id].reduce((s, c) => s + c.charCodeAt(0), 0) % COLORS.length];
  return <span className="avatar" title={`${name}${p ? ` · ${p.role.replace('_', ' ')}` : ''}`} style={{ background: color, width: size, height: size, fontSize: size * 0.42 }}>{initials}</span>;
}

export function Who({ id }: { id: string | null | undefined }) {
  const { view } = useStore();
  if (!id) return <span className="muted">—</span>;
  if (id === 'system' || id === 'engine' || id === 'script') return <span className="muted">{id}</span>;
  const p = view?.people?.find((x: any) => x.id === id);
  return <span className="row" style={{ gap: 5, display: 'inline-flex' }}><Avatar id={id} size={18} />{p?.name ?? id}</span>;
}

/** Any number from the return: click to trace it. */
export function Num({ k, value, version, cents, className = '' }: { k: string; value?: unknown; version?: string; cents?: boolean; className?: string }) {
  const { openTrace } = useStore();
  const l = useLine(k);
  const v = value !== undefined ? value : l?.value;
  const st = version ? 'engine' : l?.status ?? 'engine';
  const cls = st === 'override' || st === 'added' ? 'ovr' : st === 'stale' ? 'stale' : '';
  const title = st === 'override' ? 'Changed in the workpaper' : st === 'recomputed' ? 'Recomputed from changed inputs' : st === 'approx' ? 'Recomputed, but depends on a line the engine must recompute' : st === 'stale' ? 'Engine value: an input changed and this rule needs the engine' : 'Engine value';
  return (
    <span role="button" tabIndex={0} className={`numlink ${cls} ${className}`} title={`${k} — ${title}. Click to trace.`}
      onClick={(e) => { e.stopPropagation(); openTrace({ kind: 'line', key: k, version }); }}
      onKeyDown={(e) => { if (e.key === 'Enter') openTrace({ kind: 'line', key: k, version }); }}>
      {cents ? money(v as number, { cents: true }) : lineValue(v, k)}{st === 'approx' ? '≈' : ''}
    </span>
  );
}

export function SevDot({ s }: { s: string }) {
  return <span className={`dot sev-${s}`} title={s} />;
}

export function Sev({ s }: { s: string }) {
  const label: Record<string, string> = { blocking: 'Blocking', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' };
  return <span className={`pill ${s === 'blocking' || s === 'high' ? 'bad' : s === 'medium' ? 'warn' : s === 'info' ? 'info' : ''}`}><SevDot s={s} />{label[s] ?? s}</span>;
}

export function Status({ s }: { s: string | undefined }) {
  const map: Record<string, [string, string]> = {
    open: ['Open', 'warn'], in_progress: ['In progress', 'info'], waiting_client: ['Waiting on client', 'info'], resolved: ['Resolved', 'ok'], no_change: ['Closed — no change', 'ok'],
    pending: ['Pending approval', 'warn'], approved: ['Approved', 'ok'], rejected: ['Rejected', 'bad'], reverted: ['Reverted', ''],
    used: ['Used', 'ok'], superseded: ['Superseded', ''], duplicate: ['Duplicate', ''], not_extracted: ['Not extracted', 'warn'], partial: ['Partly extracted', 'warn'], reference: ['Support only', 'info'], not_used: ['Not used', 'warn'], evidence: ['Evidence', 'info'],
  };
  const [t, c] = map[s ?? ''] ?? [s ?? '—', ''];
  return <span className={`pill ${c}`}>{t}</span>;
}

export function Effect({ e, compact }: { e: any; compact?: boolean }) {
  if (!e) return <span className="muted">—</span>;
  if (e.method === 'not_estimable') return <span className="pill est">not estimable</span>;
  if (e.method === 'none' && !e.fed && !e.ca) return <span className="muted small">no tax effect</span>;
  const cell = (v: number, j: string) => <span className={v > 0 ? 't-high' : v < 0 ? '' : 'muted'} style={{ fontVariantNumeric: 'tabular-nums' }}>{j} {signed(v)}</span>;
  return (
    <span className="row" style={{ gap: 6, display: 'inline-flex' }} title={e.note || ''}>
      {cell(e.fed, 'Fed')}{cell(e.ca, 'CA')}
      {!compact && (e.method === 'what_if' ? <span className="pill info" title="Engine what-if result">exact</span> : e.estimate ? <span className="pill est" title="Change × published rate; engine recompute will refine">estimate</span> : e.method === 'payment' ? <span className="pill">1:1</span> : null)}
    </span>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={wide ? { width: 'min(980px, 100%)' } : undefined} role="dialog" aria-modal="true">
        <div className="mh"><h2 style={{ margin: 0 }}>{title}</h2><span className="spacer" /><button className="btn ghost" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="mb">{children}</div>
        {footer && <div className="mf">{footer}</div>}
      </div>
    </div>
  );
}

export function Panel({ title, right, children, pad = true, id }: { title?: ReactNode; right?: ReactNode; children: ReactNode; pad?: boolean; id?: string }) {
  return (
    <section className="panel" id={id}>
      {title && <div className="ph"><h2>{title}</h2><span className="spacer" />{right}</div>}
      <div className={pad ? 'pb' : ''}>{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** Evidence reference chip: resolves any packet or workpaper reference and opens it. */
export function Ref({ r, label }: { r: string; label?: string }) {
  const { openTrace, go } = useStore();
  const ix = usePacketIndex();
  let text = label ?? r;
  let title = r;
  if (ix && !label) {
    if (/^ev-\d+$/.test(r)) { const e = ix.ev.get(r); if (e) { text = `${e.document_id} · ${e.label.length > 34 ? e.label.slice(0, 32) + '…' : e.label}`; title = `${r}: ${e.label} = ${e.value} (confidence ${e.confidence})`; } }
    else if (/^D\d{2}$/.test(r)) { const d = ix.docs.get(r); if (d) { text = `${r} · ${d.title.length > 36 ? d.title.slice(0, 34) + '…' : d.title}`; title = d.title; } }
    else if (/^doc:D\d{2}#page\d+$/.test(r)) text = r.replace('doc:', '').replace('#page', ' p');
    else if (r.startsWith('line:')) text = r.slice(5);
  }
  const open = () => {
    if (/^ev-\d+$/.test(r) && ix) { const e = ix.ev.get(r); openTrace({ kind: 'doc', id: e.document_id, page: e.page, ev: r }); }
    else if (/^D\d{2}$/.test(r)) openTrace({ kind: 'doc', id: r });
    else if (/^(doc:)?D\d{2}#page\d+$/.test(r)) { const [, id, p] = r.match(/(D\d{2})#page(\d+)/)!; openTrace({ kind: 'doc', id, page: Number(p) }); }
    else if (r.startsWith('line:')) openTrace({ kind: 'line', key: r.slice(5) });
    else if (/^[A-Z][\w-]*\.[\w.-]+$/.test(r) && ix?.lines.get('v3')?.has(r)) openTrace({ kind: 'line', key: r });
    else if (/^(ADJ|RN|QN)-/.test(r)) go(r.startsWith('ADJ') ? '#/adjustments' : `#/findings/${encodeURIComponent(r.startsWith('QN') ? `Q:${r}` : r)}`);
    else openTrace({ kind: 'ref', ref: r });
  };
  return <span className="ref" title={title} role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); open(); }} onKeyDown={(e) => e.key === 'Enter' && open()}>{text}</span>;
}

/** A sensitive value, masked by the server; cleared staff may reveal it (logged). */
export function Masked({ refId, masked }: { refId: string; masked: string }) {
  const { revealed, reveal, view } = useStore();
  const v = revealed[refId];
  const cleared = view?.viewer?.cleared && view?.viewer?.kind === 'staff';
  return (
    <span className="row" style={{ display: 'inline-flex', gap: 6 }}>
      <span className="mono">{v ?? masked}</span>
      {!v && <button className="btn sm ghost" title={cleared ? 'Reveal (logged)' : 'No sensitive-data clearance: the server will refuse and log the attempt'} onClick={() => reveal(refId)}>{cleared ? 'Reveal' : '🔒'}</button>}
    </span>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return <label className="f">{label}{children}{hint && <span className="muted tiny" style={{ fontWeight: 400 }}>{hint}</span>}</label>;
}

export function When({ at }: { at: string }) {
  return <span className="muted small" title={at}>{date(at)}</span>;
}

export function useDebounced<T>(v: T, ms = 200) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export function areaName(view: any, id: string) {
  return view?.areas?.find((a: any) => a.id === id)?.name ?? id;
}

export function readOnly(view: any): string | null {
  if (!view) return 'Loading';
  if (view.meta.isReplay) return 'Replay mode is read-only';
  if (!view.viewer?.active) return `${view.viewer?.name} is not active yet`;
  return null;
}
