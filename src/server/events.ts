// The append-only, hash-chained event log. Every human act in the workpaper is one event:
// who, when (season time and wall time), what, about which subject, and why (payload).
// Each event's hash covers the previous hash, so editing history anywhere breaks the chain.
import { createHash, randomBytes } from 'node:crypto';
import { getDb } from './db.ts';
import type { WEvent } from '../shared/types.ts';

export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const keys = Object.keys(v as object).filter((k) => (v as any)[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((v as any)[k])}`).join(',')}}`;
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function newId(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString('hex')}`;
}

function hashOf(e: Omit<WEvent, 'hash'>): string {
  const { seq, id, ws, at, recorded_at, actor, type, subject, payload, batch, prev_hash } = e;
  return sha256(canonical({ seq, id, ws, at, recorded_at, actor, type, subject, payload, batch, prev_hash }));
}

type Listener = (ws: string, e: WEvent) => void;
const listeners = new Set<Listener>();
export function onEvent(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const cache = new Map<string, WEvent[]>();

export function loadEvents(ws: string): WEvent[] {
  const hit = cache.get(ws);
  if (hit) return hit;
  const rows = getDb().prepare('SELECT * FROM events WHERE ws = ? ORDER BY seq').all(ws) as any[];
  const list = rows.map(rowToEvent);
  cache.set(ws, list);
  return list;
}

function rowToEvent(r: any): WEvent {
  return { ...r, payload: JSON.parse(r.payload), subject: r.subject ?? null, batch: r.batch ?? null };
}

export type NewEvent = { actor: string; type: string; subject?: string | null; payload?: any; at: string; batch?: string | null };

export function append(ws: string, ne: NewEvent): WEvent {
  return appendMany(ws, [ne])[0];
}

export function appendMany(ws: string, list: NewEvent[]): WEvent[] {
  const db = getDb();
  const events = loadEvents(ws);
  const out: WEvent[] = [];
  const insert = db.prepare('INSERT INTO events (ws, seq, id, at, recorded_at, actor, type, subject, payload, batch, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  db.exec('BEGIN');
  try {
    let prev = events.length ? events[events.length - 1].hash : 'genesis';
    let seq = events.length ? events[events.length - 1].seq : 0;
    for (const ne of list) {
      seq += 1;
      const base = {
        seq,
        id: `e${String(seq).padStart(5, '0')}`,
        ws,
        at: ne.at,
        recorded_at: new Date().toISOString(),
        actor: ne.actor,
        type: ne.type,
        subject: ne.subject ?? null,
        payload: ne.payload ?? {},
        batch: ne.batch ?? null,
        prev_hash: prev,
      };
      const e: WEvent = { ...base, hash: hashOf(base) };
      insert.run(ws, e.seq, e.id, e.at, e.recorded_at, e.actor, e.type, e.subject, JSON.stringify(e.payload), e.batch, e.prev_hash, e.hash);
      prev = e.hash;
      out.push(e);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  events.push(...out);
  for (const e of out) for (const fn of listeners) fn(ws, e);
  return out;
}

/** Recompute the chain. Returns the first broken seq, or null when the log is intact. */
export function verifyChain(ws: string): { ok: boolean; brokenAt: number | null; count: number; head: string } {
  const rows = getDb().prepare('SELECT * FROM events WHERE ws = ? ORDER BY seq').all(ws) as any[];
  let prev = 'genesis';
  for (const r of rows) {
    const e = rowToEvent(r);
    const { hash, ...rest } = e;
    if (e.prev_hash !== prev || hashOf(rest) !== hash) return { ok: false, brokenAt: e.seq, count: rows.length, head: prev };
    prev = hash;
  }
  return { ok: true, brokenAt: null, count: rows.length, head: prev };
}

export function listWorkspaces(): any[] {
  return getDb().prepare('SELECT * FROM workspaces ORDER BY created_at DESC').all() as any[];
}

export function workspaceExists(ws: string): boolean {
  return !!getDb().prepare('SELECT id FROM workspaces WHERE id = ?').get(ws);
}

export function createWorkspaceRow(ws: string, label: string, packetSha: string) {
  getDb().prepare('INSERT INTO workspaces (id, created_at, label, packet_sha256) VALUES (?,?,?,?)').run(ws, new Date().toISOString(), label, packetSha);
}

/** Test helper: drop the in-memory cache so the next read comes from SQLite. */
export function clearCache(ws?: string) {
  if (ws) cache.delete(ws);
  else cache.clear();
}
