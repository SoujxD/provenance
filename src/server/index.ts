// HTTP API + static client. No framework: node:http, node:zlib, node:sqlite.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { packet } from './packet.ts';
import { append, loadEvents, onEvent, verifyChain, workspaceExists, createWorkspaceRow, listWorkspaces } from './events.ts';
import { deriveView, stateFor, invalidateViews, summarize, computeOursFor } from './derive.ts';
import { execute, attach } from './commands.ts';
import { person } from './access.ts';
import { clientCopy, examBinder, rollforwardPackage } from './outputs.ts';
import { buildMasker, maskDeep } from '../shared/mask.ts';
import { SEASON_START } from './state.ts';
import { seasonNow } from './season.ts';
import { getDb, dbPath } from './db.ts';
import { CHECKS } from './checks/rules.ts';
import { estimateEffect, computeOurs } from './calc.ts';

const PORT = Number(process.env.PORT || 8787);
const CLIENT_DIR = resolve('dist/client');
const P = packet();
const mask = buildMasker(P.sensitive);

// ---------- helpers ----------
function send(res: ServerResponse, req: IncomingMessage, status: number, body: unknown, type = 'application/json; charset=utf-8') {
  const raw = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const headers: Record<string, string> = { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (raw.length > 1024 && /gzip/.test(String(req.headers['accept-encoding'] || ''))) {
    headers['content-encoding'] = 'gzip';
    res.writeHead(status, headers);
    res.end(gzipSync(raw));
  } else {
    res.writeHead(status, headers);
    res.end(raw);
  }
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 12 * 1024 * 1024) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const masked = (x: unknown) => maskDeep(x, mask);

// ---------- workspaces ----------
export function createWorkspace(label = 'Okafor-Lindqvist 2025'): string {
  const ws = `ws-${randomBytes(5).toString('hex')}`;
  createWorkspaceRow(ws, label, P.sha256);
  append(ws, { actor: 'system', type: 'workspace.created', payload: { packetSha256: P.sha256, packet: P.p.packet, note: 'Packet loaded exactly as delivered; nothing seeded.' }, at: '2026-01-12T17:06:00Z' });
  append(ws, { actor: 'system', type: 'season.clock', payload: { to: SEASON_START, reason: 'Workpaper opens: engine v3 (2026-06-23) is the current return.' }, at: SEASON_START });
  return ws;
}

// ---------- presence & SSE ----------
const presence = new Map<string, Map<string, { view: string; at: number; name: string }>>();
const streams = new Map<string, Set<ServerResponse>>();

function broadcast(ws: string, event: string, data: unknown) {
  for (const res of streams.get(ws) || []) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
onEvent((ws, e) => {
  invalidateViews(ws);
  broadcast(ws, 'change', masked({ seq: e.seq, type: e.type, actor: e.actor, at: e.at, summary: summarize(e) }));
});
function presenceList(ws: string) {
  const m = presence.get(ws) || new Map();
  const now = Date.now();
  return [...m.entries()].filter(([, v]) => now - v.at < 45_000).map(([k, v]) => ({ client: k, ...v }));
}
setInterval(() => {
  for (const ws of streams.keys()) broadcast(ws, 'presence', presenceList(ws));
  for (const set of streams.values()) for (const res of set) res.write(': ping\n\n');
}, 20_000).unref();

// ---------- client view (portal): only what the client may see ----------
function clientView(ws: string, actor: string) {
  const v = deriveView(ws, actor);
  return {
    meta: v.meta, viewer: v.viewer, people: v.people.filter((p: any) => p.kind === 'client' || ['partner', 'preparer'].includes(p.role)),
    ours: { summary: v.ours.summary }, baseVersion: v.baseVersion,
    questions: v.questions.filter((q: any) => q.to === 'client'),
    messages: v.messages.filter((m: any) => m.to === 'client' || m.to === 'firm' || m.source === 'packet'),
    filing: v.filing, payments: v.payments, notifications: v.notifications,
    documents: v.documents.filter((d: any) => d.uploaded_by === 'client' || d.uploaded_by === actor).map((d: any) => ({ id: d.id, title: d.title, received_at: d.received_at, status: d.status })),
    attachments: v.attachments.filter((a: any) => a.actor === actor),
    script: { next: v.script.next, blocked: v.script.blocked },
  };
}

// ---------- routes ----------
type Handler = (req: IncomingMessage, res: ServerResponse, params: Record<string, string>, url: URL) => Promise<void> | void;
const routes: { method: string; re: RegExp; keys: string[]; h: Handler }[] = [];
function route(method: string, path: string, h: Handler) {
  const keys: string[] = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, h });
}

function wsGuard(params: Record<string, string>) {
  if (!workspaceExists(params.ws)) throw Object.assign(new Error('Workspace not found. Start a new one from the home page.'), { status: 404 });
}
function actorOf(req: IncomingMessage, url: URL) {
  return String(req.headers['x-actor'] || url.searchParams.get('actor') || 'st-01');
}

route('GET', '/api/health', (req, res) => send(res, req, 200, { ok: true, packetSha256: P.sha256, db: dbPath(), checks: CHECKS.length }));

route('POST', '/api/ws', async (req, res) => {
  const body = await readBody(req).catch(() => ({}));
  send(res, req, 200, { ws: createWorkspace(body.label) });
});

route('GET', '/api/ws/:ws', (req, res, p) => {
  wsGuard(p);
  const s = stateFor(p.ws);
  send(res, req, 200, { ws: p.ws, events: s.events.length, clock: s.clock, packetSha256: s.packetSha256 });
});

route('GET', '/api/packet', (req, res) => {
  // The packet as delivered, masked. Same for every workspace; cached.
  send(res, req, 200, packetMasked());
});
let packetCache: Buffer | null = null;
function packetMasked() {
  if (!packetCache) packetCache = Buffer.from(JSON.stringify(masked({ ...P.p, sha256: P.sha256 })));
  return packetCache;
}

route('GET', '/api/ws/:ws/view', (req, res, p, url) => {
  wsGuard(p);
  const actor = actorOf(req, url);
  const who = person(actor);
  if (who?.kind === 'client') return send(res, req, 200, masked(clientView(p.ws, actor)));
  const v = deriveView(p.ws, actor, url.searchParams.get('asOf') || undefined);
  send(res, req, 200, masked({ ...v, presence: presenceList(p.ws) }));
});

route('POST', '/api/ws/:ws/cmd', async (req, res, p, url) => {
  wsGuard(p);
  const body = await readBody(req);
  const out = execute(p.ws, actorOf(req, url), body);
  // Unmask is the one response that is deliberately not masked (and it is logged).
  send(res, req, 200, body.type === 'unmask' ? out : masked(out));
});

route('POST', '/api/ws/:ws/attachments', async (req, res, p, url) => {
  wsGuard(p);
  send(res, req, 200, attach(p.ws, actorOf(req, url), await readBody(req)));
});

route('GET', '/api/ws/:ws/attachments/:id', (req, res, p) => {
  wsGuard(p);
  const row = getDb().prepare('SELECT * FROM attachments WHERE id = ? AND ws = ?').get(p.id, p.ws) as any;
  if (!row) return send(res, req, 404, { error: 'Not found' });
  res.writeHead(200, { 'content-type': row.mime, 'content-disposition': `inline; filename="${String(row.name).replace(/"/g, '')}"`, 'x-sha256': row.sha256 });
  res.end(Buffer.from(row.data));
});

route('GET', '/api/ws/:ws/stream', (req, res, p, url) => {
  wsGuard(p);
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.write(`retry: 3000\n\n`);
  if (!streams.has(p.ws)) streams.set(p.ws, new Set());
  streams.get(p.ws)!.add(res);
  req.on('close', () => streams.get(p.ws)?.delete(res));
});

route('POST', '/api/ws/:ws/presence', async (req, res, p, url) => {
  wsGuard(p);
  const body = await readBody(req);
  const actor = actorOf(req, url);
  if (!presence.has(p.ws)) presence.set(p.ws, new Map());
  presence.get(p.ws)!.set(String(body.client || actor), { view: String(body.view || ''), at: Date.now(), name: person(actor)?.name ?? actor });
  broadcast(p.ws, 'presence', presenceList(p.ws));
  send(res, req, 200, { ok: true });
});

route('GET', '/api/ws/:ws/events', (req, res, p, url) => {
  wsGuard(p);
  const who = person(actorOf(req, url));
  if (!who || who.kind !== 'staff') return send(res, req, 403, { error: 'Staff only.' });
  send(res, req, 200, masked({ chain: verifyChain(p.ws), events: loadEvents(p.ws) }));
});

route('GET', '/api/ws/:ws/verify', (req, res, p) => {
  wsGuard(p);
  send(res, req, 200, { ...verifyChain(p.ws), packetSha256: P.sha256, recordedPacketSha256: stateFor(p.ws).packetSha256 });
});

route('GET', '/api/ws/:ws/client-copy', (req, res, p) => {
  wsGuard(p);
  const { html, hash } = clientCopy(p.ws);
  res.setHeader('x-sha256', hash);
  send(res, req, 200, html, 'text/html; charset=utf-8');
});

route('GET', '/api/ws/:ws/binder/:notice', (req, res, p, url) => {
  wsGuard(p);
  const { html, hash } = examBinder(p.ws, p.notice);
  const actor = actorOf(req, url);
  if (url.searchParams.get('record') === '1') {
    try { execute(p.ws, actor, { type: 'notice.binder', noticeId: p.notice, hash }); } catch { /* viewing is allowed even if recording is not */ }
  }
  res.setHeader('x-sha256', hash);
  if (url.searchParams.get('download') === '1') res.setHeader('content-disposition', `attachment; filename="exam-binder-${p.notice}.html"`);
  send(res, req, 200, html, 'text/html; charset=utf-8');
});

route('GET', '/api/ws/:ws/rollforward', (req, res, p) => {
  wsGuard(p);
  send(res, req, 200, masked(rollforwardPackage(p.ws)));
});

route('POST', '/api/ws/:ws/rollforward', (req, res, p, url) => {
  wsGuard(p);
  const { pkg, hash } = rollforwardPackage(p.ws);
  send(res, req, 200, masked(execute(p.ws, actorOf(req, url), { type: 'rollforward.start', pkg, hash })));
});

route('GET', '/api/ws/:ws/snapshot', (req, res, p) => {
  wsGuard(p);
  const s = stateFor(p.ws);
  if (!s.filing.frozen) return send(res, req, 404, { error: 'Not filed yet.' });
  const row = getDb().prepare('SELECT data, sha256 FROM attachments WHERE id = ?').get(s.filing.frozen.snapshotId) as any;
  res.setHeader('x-sha256', row.sha256);
  send(res, req, 200, Buffer.from(row.data), 'application/json; charset=utf-8');
});

route('POST', '/api/ws/:ws/whatif', async (req, res, p) => {
  wsGuard(p);
  // Sandbox: effect of hypothetical changes on top of the current return. Nothing is recorded.
  const body = await readBody(req);
  const st = stateFor(p.ws);
  const ours = computeOursFor(st, seasonNow(st));
  const current = ours.activeAdjustments.flatMap((a) => a.changes.filter((c) => !c.target.includes(':')).map((c) => ({ target: c.target, value: c.value, addTo: c.addTo, label: c.label, caSource: c.caSource })));
  const sandbox = (body.changes || []).filter((c: any) => c.target && c.value !== '' && c.value != null).map((c: any) => ({ ...c, value: Number(c.value) }));
  const withSandbox = estimateEffect(ours.model, [...current, ...sandbox]);
  const without = estimateEffect(ours.model, current);
  const r = computeOurs(ours.model, [...current, ...sandbox]);
  const lines = [...r.status.entries()].filter(([k]) => r.values.get(k) !== ours.values.get(k) || sandbox.some((c: any) => c.target === k)).slice(0, 200).map(([k, status]) => ({ key: k, label: ours.model.lines.get(k)?.label ?? k, before: ours.values.get(k) ?? null, after: r.values.get(k), status }));
  send(res, req, 200, masked({ effect: { fed: withSandbox.fed - without.fed, ca: withSandbox.ca - without.ca, estimate: true }, anchors: withSandbox.anchors, lines }));
});

route('GET', '/api/workspaces', (req, res) => send(res, req, 200, listWorkspaces().slice(0, 20).map((w) => ({ id: w.id, created_at: w.created_at, label: w.label }))));

// ---------- static ----------
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };
function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL) {
  let file = join(CLIENT_DIR, decodeURIComponent(url.pathname));
  if (!file.startsWith(CLIENT_DIR) || !existsSync(file) || statSync(file).isDirectory()) file = join(CLIENT_DIR, 'index.html');
  if (!existsSync(file)) return send(res, req, 200, '<!doctype html><title>Workpaper</title><p>Client not built. Run <code>npm run build</code>, or use <code>npm run dev</code>.</p>', 'text/html; charset=utf-8');
  const body = readFileSync(file);
  const type = MIME[extname(file)] || 'application/octet-stream';
  const headers: Record<string, string> = { 'content-type': type, 'cache-control': file.includes('/assets/') || file.includes('\\assets\\') ? 'public, max-age=31536000, immutable' : 'no-cache' };
  if (/gzip/.test(String(req.headers['accept-encoding'] || '')) && /text|javascript|json|svg/.test(type)) {
    headers['content-encoding'] = 'gzip';
    res.writeHead(200, headers);
    res.end(gzipSync(body));
  } else {
    res.writeHead(200, headers);
    res.end(body);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.re);
        if (!m) continue;
        const params: Record<string, string> = {};
        r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        await r.h(req, res, params, url);
        return;
      }
      return send(res, req, 404, { error: 'No such endpoint' });
    }
    serveStatic(req, res, url);
  } catch (err: any) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) send(res, req, status, { error: err.message, rule: err.rule });
    else res.end();
  }
});

getDb();
server.listen(PORT, () => {
  console.log(`Workpaper API on http://localhost:${PORT}  (packet sha256 ${P.sha256.slice(0, 16)}…, ${CHECKS.length} independent checks, db ${dbPath()})`);
});

export { seasonNow, computeOursFor };
