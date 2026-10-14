// Thin API client. The actor (role switcher) travels as a header on every request.
export function workspaceFromUrl(): string | null {
  const m = location.pathname.match(/\/w\/(ws-[a-f0-9]+)/);
  return m ? m[1] : null;
}

export async function ensureWorkspace(): Promise<string> {
  const fromUrl = workspaceFromUrl();
  if (fromUrl) {
    const r = await fetch(`/api/ws/${fromUrl}`);
    if (r.ok) return fromUrl;
  }
  let saved: string | null = null;
  try { saved = localStorage.getItem('wp.ws'); } catch { /* storage unavailable */ }
  if (saved && !fromUrl) {
    const r = await fetch(`/api/ws/${saved}`);
    if (r.ok) { history.replaceState(null, '', `/w/${saved}${location.hash}`); return saved; }
  }
  const r = await fetch('/api/ws', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const { ws } = await r.json();
  try { localStorage.setItem('wp.ws', ws); } catch { /* ignore */ }
  history.replaceState(null, '', `/w/${ws}${location.hash || '#/overview'}`);
  return ws;
}

export class ApiError extends Error {
  status: number;
  rule?: string;
  constructor(message: string, status: number, rule?: string) {
    super(message);
    this.status = status;
    this.rule = rule;
  }
}

async function json(r: Response) {
  const t = await r.text();
  let body: any;
  try { body = JSON.parse(t); } catch { body = { error: t }; }
  if (!r.ok) throw new ApiError(body.error || `HTTP ${r.status}`, r.status, body.rule);
  return body;
}

export const api = {
  packet: () => fetch('/api/packet').then(json),
  view: (ws: string, actor: string, asOf?: string | null) => fetch(`/api/ws/${ws}/view?actor=${encodeURIComponent(actor)}${asOf ? `&asOf=${encodeURIComponent(asOf)}` : ''}`).then(json),
  cmd: (ws: string, actor: string, body: any) => fetch(`/api/ws/${ws}/cmd`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-actor': actor }, body: JSON.stringify(body) }).then(json),
  whatif: (ws: string, actor: string, changes: any[]) => fetch(`/api/ws/${ws}/whatif`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-actor': actor }, body: JSON.stringify({ changes }) }).then(json),
  attach: (ws: string, actor: string, body: any) => fetch(`/api/ws/${ws}/attachments`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-actor': actor }, body: JSON.stringify(body) }).then(json),
  rollforward: (ws: string) => fetch(`/api/ws/${ws}/rollforward`).then(json),
  startRollforward: (ws: string, actor: string) => fetch(`/api/ws/${ws}/rollforward`, { method: 'POST', headers: { 'x-actor': actor } }).then(json),
  events: (ws: string, actor: string) => fetch(`/api/ws/${ws}/events?actor=${actor}`).then(json),
  verify: (ws: string) => fetch(`/api/ws/${ws}/verify`).then(json),
  presence: (ws: string, actor: string, view: string, client: string) => fetch(`/api/ws/${ws}/presence`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-actor': actor }, body: JSON.stringify({ view, client }) }).catch(() => undefined),
};

export function subscribe(ws: string, on: (type: string, data: any) => void): () => void {
  const es = new EventSource(`/api/ws/${ws}/stream`);
  es.addEventListener('change', (e) => on('change', JSON.parse((e as MessageEvent).data)));
  es.addEventListener('presence', (e) => on('presence', JSON.parse((e as MessageEvent).data)));
  return () => es.close();
}

export function fileToBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = reject;
    r.readAsDataURL(f);
  });
}
