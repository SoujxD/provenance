// App state: the masked packet (static), the derived view (live), who is acting, replay time,
// the trace drawer stack and toasts. Every write goes through `cmd`, then the view refetches
// (and every other open tab refetches through the live stream).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, subscribe, ApiError } from './api';

export type Toast = { id: number; text: string; kind?: 'bad' | 'ok'; action?: { label: string; run: () => void } };
export type TraceTarget = { kind: 'line'; key: string; version?: string } | { kind: 'doc'; id: string; page?: number; ev?: string } | { kind: 'ref'; ref: string };

type Store = {
  ws: string;
  packet: any;
  view: any;
  actor: string;
  setActor: (a: string) => void;
  asOf: string | null;
  setAsOf: (t: string | null) => void;
  refresh: () => Promise<void>;
  cmd: (body: any, opts?: { quiet?: boolean; success?: string }) => Promise<any>;
  trace: TraceTarget[];
  openTrace: (t: TraceTarget, replace?: boolean) => void;
  closeTrace: () => void;
  popTrace: (i: number) => void;
  toast: (t: Omit<Toast, 'id'>) => void;
  toasts: Toast[];
  route: string[];
  go: (hash: string) => void;
  loading: boolean;
  lastChange: any;
  revealed: Record<string, string>;
  reveal: (ref: string) => Promise<void>;
};

const Ctx = createContext<Store | null>(null);
export const useStore = () => useContext(Ctx)!;

function parseRoute(): string[] {
  const h = location.hash.replace(/^#\/?/, '');
  return h ? h.split('/').map(decodeURIComponent) : ['overview'];
}

export function StoreProvider({ ws, children }: { ws: string; children: ReactNode }) {
  const [packet, setPacket] = useState<any>(null);
  const [view, setView] = useState<any>(null);
  const [actor, setActorState] = useState<string>(() => { try { return localStorage.getItem('wp.actor') || 'st-01'; } catch { return 'st-01'; } });
  const [asOf, setAsOf] = useState<string | null>(null);
  const [trace, setTrace] = useState<TraceTarget[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [route, setRoute] = useState<string[]>(parseRoute());
  const [loading, setLoading] = useState(true);
  const [lastChange, setLastChange] = useState<any>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const seq = useRef(0);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++seq.current;
    setToasts((x) => [...x, { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), t.action ? 9000 : 5200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const v = await api.view(ws, actor, asOf);
      setView(v);
    } catch (e: any) {
      toast({ text: e.message, kind: 'bad' });
    } finally {
      setLoading(false);
    }
  }, [ws, actor, asOf, toast]);

  useEffect(() => { api.packet().then(setPacket); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => subscribe(ws, (type, data) => {
    if (type === 'change') { setLastChange(data); refresh(); }
    if (type === 'presence') setView((v: any) => (v ? { ...v, presence: data } : v));
  }), [ws, refresh]);
  useEffect(() => {
    const on = () => setRoute(parseRoute());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  // Presence heartbeat: who is looking at what.
  useEffect(() => {
    const client = sessionStorage.getItem('wp.client') || Math.random().toString(36).slice(2);
    sessionStorage.setItem('wp.client', client);
    const beat = () => api.presence(ws, actor, route.join('/'), client);
    beat();
    const t = setInterval(beat, 20000);
    return () => clearInterval(t);
  }, [ws, actor, route]);

  const setActor = useCallback((a: string) => {
    setActorState(a);
    setRevealed({});
    try { localStorage.setItem('wp.actor', a); } catch { /* ignore */ }
  }, []);

  const cmd = useCallback(async (body: any, opts: { quiet?: boolean; success?: string } = {}) => {
    try {
      const r = await api.cmd(ws, actor, body);
      if (opts.success) toast({ text: opts.success, kind: 'ok' });
      await refresh();
      return r;
    } catch (e: any) {
      if (!opts.quiet) toast({ text: e instanceof ApiError && e.rule ? `${e.message}` : e.message, kind: 'bad' });
      throw e;
    }
  }, [ws, actor, refresh, toast]);

  const reveal = useCallback(async (ref: string) => {
    try {
      const r = await api.cmd(ws, actor, { type: 'unmask', ref, purpose: 'Viewed in workpaper' });
      setRevealed((x) => ({ ...x, [ref]: r.value }));
      toast({ text: 'Revealed — this view is logged.', kind: 'ok' });
    } catch (e: any) {
      toast({ text: e.message, kind: 'bad' });
    }
  }, [ws, actor, toast]);

  const go = useCallback((hash: string) => { location.hash = hash.startsWith('#') ? hash : `#/${hash}`; }, []);
  const openTrace = useCallback((t: TraceTarget, replace = false) => setTrace((x) => (replace ? [t] : [...x, t])), []);
  const closeTrace = useCallback(() => setTrace([]), []);
  const popTrace = useCallback((i: number) => setTrace((x) => x.slice(0, i + 1)), []);

  const value = useMemo<Store>(() => ({ ws, packet, view, actor, setActor, asOf, setAsOf, refresh, cmd, trace, openTrace, closeTrace, popTrace, toast, toasts, route, go, loading, lastChange, revealed, reveal }),
    [ws, packet, view, actor, setActor, asOf, refresh, cmd, trace, openTrace, closeTrace, popTrace, toast, toasts, route, go, loading, lastChange, revealed, reveal]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ---------- derived helpers over packet + view ----------
export function usePacketIndex() {
  const { packet } = useStore();
  return useMemo(() => {
    if (!packet) return null;
    const docs = new Map<string, any>(packet.documents.map((d: any) => [d.id, d]));
    const ev = new Map<string, any>(packet.extracted_values.map((e: any) => [e.id, e]));
    const evByDoc = new Map<string, any[]>();
    for (const e of packet.extracted_values) {
      if (!evByDoc.has(e.document_id)) evByDoc.set(e.document_id, []);
      evByDoc.get(e.document_id)!.push(e);
    }
    const lines = new Map<string, Map<string, any>>();
    for (const v of packet.return_versions) lines.set(v.version, new Map(v.lines.map((l: any) => [l.key, l])));
    const versions = new Map<string, any>(packet.return_versions.map((v: any) => [v.version, v]));
    const children = new Map<string, string[]>();
    for (const l of packet.return_versions[2].lines) for (const i of l.inputs) {
      if (!children.has(i)) children.set(i, []);
      children.get(i)!.push(l.key);
    }
    const people = new Map<string, any>(packet.household.people.map((p: any) => [p.id, p]));
    return { docs, ev, evByDoc, lines, versions, children, people, rules: packet.engine_reference.rules, params: packet.engine_reference.parameters };
  }, [packet]);
}

export function useLine(key: string) {
  const { view } = useStore();
  const ix = usePacketIndex();
  if (!ix || !view) return null;
  const base = ix.lines.get(view.baseVersion)?.get(key);
  const ours = view.ours.lines[key];
  const added = view.ours.added.find((l: any) => l.key === key);
  return { line: base ?? added, value: ours ? ours.value : base?.value, status: ours?.status ?? 'engine', base };
}
