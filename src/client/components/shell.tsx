import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore, usePacketIndex } from '../store';
import { Avatar, Who } from './ui';
import { lineValue, date } from '../../shared/format';

const NAV: { group: string; items: { id: string; label: string; count?: (v: any) => number | string; bad?: (v: any) => boolean }[] }[] = [
  { group: 'Work', items: [
    { id: 'overview', label: 'Overview' },
    { id: 'findings', label: 'Findings', count: (v) => v.findings.filter((f: any) => !['resolved', 'no_change'].includes(f.status)).length, bad: (v) => v.findings.some((f: any) => f.severity === 'blocking' && !['resolved', 'no_change'].includes(f.status)) },
    { id: 'areas', label: 'Areas' },
    { id: 'documents', label: 'Documents', count: (v) => v.documents.length },
    { id: 'adjustments', label: 'Adjustments & what-if', count: (v) => v.adjustments.filter((a: any) => a.status === 'pending').length || '' },
  ] },
  { group: 'Records', items: [
    { id: 'versions', label: 'Return & versions' },
    { id: 'depreciation', label: 'Depreciation' },
    { id: 'carryovers', label: 'Carryovers & basis' },
    { id: 'payments', label: 'Payments vs records' },
    { id: 'prior', label: 'Prior preparer vs us' },
    { id: 'completeness', label: 'Completeness' },
  ] },
  { group: 'Season', items: [
    { id: 'timeline', label: 'Timeline & replay' },
    { id: 'filing', label: 'Filing', count: (v) => (v.filing.frozen ? '✓' : v.gate.blockers.length) },
    { id: 'notice', label: 'Notice response', count: (v) => (v.notices.length ? '!' : '') },
    { id: 'rollforward', label: 'Roll-forward 2026' },
  ] },
  { group: 'Firm', items: [
    { id: 'people', label: 'People, time & deadlines' },
    { id: 'admin', label: 'Standards & audit' },
  ] },
];

export function Shell({ children }: { children: ReactNode }) {
  const { view, route, asOf, setAsOf } = useStore();
  const [navOpen, setNavOpen] = useState(false);
  return (
    <div className={`shell ${navOpen ? 'navopen' : ''}`}>
      <TopBar onMenu={() => setNavOpen((x) => !x)} />
      <nav className="sidebar nav" onClick={() => setNavOpen(false)}>
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="nav-group">{g.group}</div>
            {g.items.map((it) => {
              const c = view && it.count ? it.count(view) : '';
              return <a key={it.id} href={`#/${it.id}`} className={route[0] === it.id ? 'on' : ''} data-tour={`nav-${it.id}`}>{it.label}<span className={`count ${view && it.bad?.(view) ? 'bad' : ''}`}>{c === 0 ? '' : c}</span></a>;
            })}
          </div>
        ))}
        <div className="nav-group">Workspace</div>
        <div className="small muted" style={{ padding: '0 8px' }}>
          <div>Events: {view?.meta.events}</div>
          <div title={view?.meta.packetSha256}>Packet sha256 {view?.meta.packetSha256?.slice(0, 10)}…</div>
          <a href="/" onClick={(e) => { e.preventDefault(); try { localStorage.removeItem('wp.ws'); localStorage.removeItem('wp.tour'); } catch { /* ignore */ } location.href = '/'; }}>Start a fresh workspace</a>
        </div>
      </nav>
      <main className="main">
        {view?.meta.isReplay && (
          <div className="replay-banner">
            <span>⏪ Replay: the workpaper as of <b>{new Date(view.meta.asOf).toUTCString().slice(5, 22)} UTC</b> — engine {view.baseVersion}, {view.documents.length} documents. Read-only.</span>
            <span className="spacer" /><button className="btn sm" onClick={() => setAsOf(null)}>Back to live</button>
          </div>
        )}
        {asOf && !view?.meta.isReplay && <div className="replay-banner">Loading replay…</div>}
        {children}
      </main>
    </div>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { view, cmd } = useStore();
  const [palette, setPalette] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); }
      if (e.key === '/' && !(e.target as HTMLElement).closest('input,textarea,select')) { e.preventDefault(); setPalette(true); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  const mac = /Mac/.test(navigator.platform);
  const next = view?.script?.next;
  return (
    <header className="topbar">
      <button className="btn ghost" onClick={onMenu} aria-label="Menu" style={{ display: 'none' }} id="menubtn">☰</button>
      <div className="brand"><span className="brand-mark">M</span><span>Workpaper</span></div>
      <div className="client-chip"><b>Okafor-Lindqvist · 2025</b><span>MFJ · CA→TX part-year · CL-20417</span></div>
      <div className="searchbox" onClick={() => setPalette(true)} data-tour="search">
        <span>Search numbers, documents, people…</span><span className="spacer" /><span className="kbd">{mac ? '⌘' : 'Ctrl'} K</span>
      </div>
      <span className="spacer" />
      {view && (
        <div className="row small" title="Season clock: the scenario date. Advance plays the next packet timeline event.">
          <span className="muted">Season</span><b>{date(view.meta.now)}</b>
          {next && !view.meta.isReplay && <button className="btn sm" disabled={!!view.script.blocked} title={view.script.blocked ?? `Next: ${next.title}`} onClick={() => cmd({ type: 'season.advance' }, { success: `Season: ${next.title}` }).catch(() => undefined)}>▸ {view.script.blocked ? 'Next (gated)' : date(next.at)}</button>}
        </div>
      )}
      <button className="btn sm tourbtn" title="Restart the 60-second guided tour" onClick={() => { try { localStorage.removeItem('wp.tour'); } catch { /* ignore */ } window.dispatchEvent(new Event('wp:tour')); }}>Start here</button>
      <Presence />
      <Bell />
      <RoleSwitcher />
      {palette && <Palette onClose={() => setPalette(false)} />}
    </header>
  );
}

function Presence() {
  const { view, actor } = useStore();
  const others = (view?.presence || []).filter((p: any) => p.name && p.view);
  const uniq = [...new Map(others.map((p: any) => [p.name, p])).values()] as any[];
  if (uniq.length <= 1) return null;
  return <div className="row" style={{ gap: 2 }} title="Who is in this workspace now">{uniq.slice(0, 5).map((p) => <span key={p.client} title={`${p.name} · ${p.view}`} style={{ opacity: p.name === view?.viewer?.name ? 0.5 : 1 }}><Avatar id={view.people.find((x: any) => x.name === p.name)?.id ?? actor} size={20} /></span>)}</div>;
}

function Bell() {
  const { view, cmd } = useStore();
  const [open, setOpen] = useState(false);
  const n = view?.notifications;
  if (!n) return null;
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn ghost" onClick={() => { setOpen((x) => !x); if (!open && n.unread) cmd({ type: 'notifications.read' }, { quiet: true }).catch(() => undefined); }} aria-label="Notifications">
        🔔{n.unread > 0 && <span className="pill bad" style={{ height: 16, padding: '0 5px' }}>{n.unread}</span>}
      </button>
      {open && (
        <div className="menu" onMouseLeave={() => setOpen(false)}>
          <div className="sec">Notifications for {view.viewer?.name}</div>
          {n.items.length === 0 && <div className="mi muted">Nothing yet.</div>}
          {n.items.map((it: any) => <a key={it.seq} className="mi" href={it.link} onClick={() => setOpen(false)} style={{ color: 'inherit' }}><Avatar id={it.actor} size={18} /><span className="small">{it.text}</span></a>)}
        </div>
      )}
    </div>
  );
}

export function RoleSwitcher() {
  const { view, actor, setActor, go } = useStore();
  const [open, setOpen] = useState(false);
  const me = view?.people?.find((p: any) => p.id === actor);
  return (
    <div style={{ position: 'relative' }} data-tour="roles">
      <button className="chip" onClick={() => setOpen((x) => !x)} title="Switch person (demo stand-in for sign-in)">
        <Avatar id={actor} /><span className="small"><b>{me?.name ?? actor}</b> <span className="muted">· {me?.role.replace('_', ' ')}</span></span> ▾
      </button>
      {open && view && (
        <div className="menu">
          <div className="sec">Firm staff</div>
          {view.people.filter((p: any) => p.kind === 'staff').map((p: any) => (
            <div key={p.id} className={`mi ${p.id === actor ? 'on' : ''}`} onClick={() => { setActor(p.id); setOpen(false); }}>
              <Avatar id={p.id} /><div style={{ flex: 1 }}><div><b>{p.name}</b> {p.credential && <span className="muted">{p.credential}</span>}</div>
                <div className="tiny muted">{p.role.replace('_', ' ')}{!p.cleared ? ' · no sensitive-data clearance' : ''}{!p.active ? ` · inactive until ${p.activeFrom}` : ''}</div></div>
            </div>
          ))}
          <div className="sec">Client portal</div>
          {view.people.filter((p: any) => p.kind === 'client').map((p: any) => (
            <div key={p.id} className={`mi ${p.id === actor ? 'on' : ''}`} onClick={() => { setActor(p.id); setOpen(false); go('#/portal'); }}>
              <Avatar id={p.id} /><div><b>{p.name}</b><div className="tiny muted">client</div></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const { view, openTrace, go, setActor } = useStore();
  const ix = usePacketIndex();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const items = useMemo(() => {
    if (!ix || !view) return [];
    const out: { kind: string; label: string; sub?: string; run: () => void; score: number }[] = [];
    const s = q.trim().toLowerCase();
    const numQ = s.replace(/[,$]/g, '');
    const match = (...xs: (string | undefined)[]) => {
      if (!s) return 1;
      const hay = xs.filter(Boolean).join(' ').toLowerCase();
      if (hay.includes(s)) return 3;
      return s.split(/\s+/).every((w) => hay.includes(w)) ? 2 : 0;
    };
    const pages = [['overview', 'Overview'], ['findings', 'Findings inbox'], ['areas', 'Areas'], ['documents', 'Document index'], ['adjustments', 'Adjustments & what-if'], ['versions', 'Return & versions compare'], ['depreciation', 'Depreciation by asset'], ['carryovers', 'Carryovers & basis'], ['payments', 'Payments vs IRS/FTB'], ['prior', 'Prior preparer vs us'], ['completeness', 'Completeness'], ['timeline', 'Timeline & replay'], ['filing', 'Filing'], ['notice', 'Notice response'], ['rollforward', 'Roll-forward 2026'], ['people', 'People, time & deadlines'], ['admin', 'Standards & audit']];
    for (const [id, label] of pages) { const sc = match(label, id); if (sc) out.push({ kind: 'page', label, run: () => go(`#/${id}`), score: sc }); }
    for (const a of view.areas) { const sc = match(a.name, a.id, 'area'); if (sc) out.push({ kind: 'area', label: a.name, sub: `${a.open} open`, run: () => go(`#/areas/${a.id}`), score: sc }); }
    const lines = ix.lines.get(view.baseVersion)!;
    for (const l of lines.values()) {
      if (/^F8949\.[A-Z]\.(X|M)\d/.test(l.key) && s.length < 3) continue;
      const v = view.ours.lines[l.key]?.value ?? l.value;
      const sc = Math.max(match(l.key, l.label), typeof v === 'number' && numQ.length >= 3 && String(Math.round(v)).includes(numQ) ? 2 : 0);
      if (sc) out.push({ kind: 'number', label: `${l.label}`, sub: `${l.key} · ${lineValue(v, l.key)}`, run: () => openTrace({ kind: 'line', key: l.key }, true), score: sc + (l.key.startsWith('F1040') ? 0.5 : 0) });
    }
    for (const d of view.documents) { const sc = match(d.id, d.title, d.issuer, d.type); if (sc) out.push({ kind: 'document', label: `${d.id} ${d.title}`, sub: d.status, run: () => openTrace({ kind: 'doc', id: d.id }, true), score: sc }); }
    for (const f of view.findings) { const sc = match(f.title, f.id, f.area, f.rule); if (sc) out.push({ kind: 'finding', label: f.title, sub: f.status, run: () => go(`#/findings/${encodeURIComponent(f.id)}`), score: sc - 0.2 }); }
    for (const p of view.people) { const sc = match(p.name, p.role, 'person'); if (sc) out.push({ kind: 'person', label: p.name, sub: `switch to ${p.role.replace('_', ' ')}`, run: () => { setActor(p.id); if (p.kind === 'client') go('#/portal'); }, score: sc }); }
    for (const p of ix.people.values()) { const sc = match(p.name, 'household', p.role); if (sc) out.push({ kind: 'household', label: p.name, sub: p.role, run: () => openTrace({ kind: 'ref', ref: `household:${p.id}` }, true), score: sc - 0.3 }); }
    if (s.length >= 2) for (const e of ix.ev.values()) { if (out.length > 600) break; const sc = match(e.label, e.id); if (sc >= 2) out.push({ kind: 'value', label: e.label, sub: `${e.id} · ${e.document_id} · ${typeof e.value === 'number' ? lineValue(e.value) : e.value}`, run: () => openTrace({ kind: 'doc', id: e.document_id, ev: e.id, page: e.page }, true), score: sc - 0.6 }); }
    return out.sort((a, b) => b.score - a.score).slice(0, 60);
  }, [q, ix, view, go, openTrace, setActor]);
  useEffect(() => setSel(0), [q]);
  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ alignItems: 'start', paddingTop: '12vh' }}>
      <div className="modal palette">
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search lines (AGI, SchC.1, 151300), documents (D23, W-2), findings, people…"
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(x + 1, items.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(x - 1, 0)); }
            if (e.key === 'Enter' && items[sel]) { items[sel].run(); onClose(); }
          }} />
        <div className="res">
          {items.map((it, i) => (
            <div key={i} className={`item ${i === sel ? 'on' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => { it.run(); onClose(); }}>
              <span className="kind">{it.kind}</span><span style={{ flex: 1 }}>{it.label}</span><span className="muted small">{it.sub}</span>
            </div>
          ))}
          {!items.length && <div className="empty">No matches.</div>}
        </div>
      </div>
    </div>
  );
}

export function Toasts() {
  const { toasts } = useStore();
  return <div className="toasts">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind === 'bad' ? 'bad' : ''}`}>{t.text}{t.action && <button onClick={t.action.run}>{t.action.label}</button>}</div>)}</div>;
}

// ---------- Guided tour: 60 seconds, does the clicks for you ----------
const TOUR = [
  { title: 'Every number is a claim you can trace', body: 'Click any underlined number. Try Wages: the trace shows the rule, the inputs, and the exact field on the W-2 it came from — plus the duplicate W-2 photo the engine counted once.', do: (s: any) => { s.go('#/overview'); setTimeout(() => s.openTrace({ kind: 'line', key: 'F1040.1a' }, true), 250); }, glow: '[data-tour="wages"]' },
  { title: 'Checks that do not trust the engine', body: 'The findings inbox mixes engine diagnostics with our own rules. This one: RSU basis left blank on the 1099-B, so $47,620 of wages were taxed again as gains — with evidence and the estimated tax effect.', do: (s: any) => { s.closeTrace(); s.go('#/findings/' + encodeURIComponent('SUPPLEMENTAL_BASIS:D11')); }, glow: '[data-tour="finding-detail"]' },
  { title: 'Roles are enforced, not hidden', body: 'Now you are Marcus Bell, a preparer without sensitive-data clearance. SSNs, account numbers and the IP PIN are masked by the server; clicking 🔒 is refused and logged. Switch back any time from the person menu.', do: (s: any) => { s.setActor('st-04'); s.go('#/areas/intake'); }, glow: '[data-tour="roles"]' },
  { title: 'Where to go next', body: 'Filing shows exactly what gates the e-file. Timeline replays the season (v1 → v2 → v3, late K-1s, e-file reject). Notice response builds the 2028 exam binder. Press Ctrl/⌘ K to search anything.', do: (s: any) => { s.setActor('st-01'); s.go('#/filing'); }, glow: '[data-tour="nav-timeline"]' },
];

export function Tour() {
  const store = useStore();
  const [i, setI] = useState<number>(() => { try { return localStorage.getItem('wp.tour') === 'done' ? -1 : 0; } catch { return -1; } });
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const on = () => { setI(0); setStarted(false); };
    window.addEventListener('wp:tour', on);
    return () => window.removeEventListener('wp:tour', on);
  }, []);
  useEffect(() => {
    if (i < 0 || !started) return;
    const sel = TOUR[i]?.glow;
    const t = setTimeout(() => { document.querySelectorAll('.tour-glow').forEach((x) => x.classList.remove('tour-glow')); if (sel) document.querySelector(sel)?.classList.add('tour-glow'); }, 450);
    return () => { clearTimeout(t); document.querySelectorAll('.tour-glow').forEach((x) => x.classList.remove('tour-glow')); };
  }, [i, started]);
  if (i < 0 || !store.view || store.view.viewer?.kind === 'client') return null;
  const done = () => { setI(-1); try { localStorage.setItem('wp.tour', 'done'); } catch { /* ignore */ } };
  if (!started) return (
    <div className="tour">
      <div className="step">Start here · 60 seconds</div>
      <h2 style={{ margin: '4px 0' }}>A workpaper that proves the return</h2>
      <p className="small" style={{ margin: '0 0 10px' }}>Okafor-Lindqvist 2025, loaded straight from the packet. Nothing is pre-reviewed: every finding below was detected by rules; every judgment is yours to make. Four steps: trace a number, see a finding, switch role, where next.</p>
      <div className="row"><button className="btn primary" onClick={() => { setStarted(true); TOUR[0].do(store); }}>Start the tour</button><button className="btn ghost" onClick={done}>Skip</button></div>
    </div>
  );
  const step = TOUR[i];
  return (
    <div className="tour">
      <div className="step">Step {i + 1} of {TOUR.length}</div>
      <h2 style={{ margin: '4px 0' }}>{step.title}</h2>
      <p className="small" style={{ margin: '0 0 10px' }}>{step.body}</p>
      <div className="row">
        {i < TOUR.length - 1 ? <button className="btn primary" onClick={() => { TOUR[i + 1].do(store); setI(i + 1); }}>Next</button> : <button className="btn primary" onClick={done}>Finish</button>}
        <button className="btn ghost" onClick={done}>Close</button>
        <span className="spacer" /><span className="muted tiny">{i + 1}/{TOUR.length}</span>
      </div>
    </div>
  );
}

export function PersonLine({ id }: { id: string }) { return <Who id={id} />; }
