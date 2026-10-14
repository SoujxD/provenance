// The event log: append-only, hash-chained, replayable, undo as an event.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'wp-ev-')), 'test.db');
const { append, appendMany, loadEvents, verifyChain, createWorkspaceRow, clearCache, canonical } = await import('../src/server/events.ts');
const { getDb } = await import('../src/server/db.ts');
const { fold } = await import('../src/server/state.ts');
const { firmStandards } = await import('../src/server/derive.ts');

const ws = 'ws-test01';
createWorkspaceRow(ws, 'test', 'x');
append(ws, { actor: 'system', type: 'workspace.created', payload: { packetSha256: 'x' }, at: '2026-01-01T00:00:00Z' });

test('chain verifies and every event links to the previous hash', () => {
  appendMany(ws, [
    { actor: 'st-01', type: 'note.added', subject: 'line:SchC.1', payload: { target: 'line:SchC.1', text: 'a' }, at: '2026-06-23T09:00:00Z' },
    { actor: 'st-01', type: 'note.added', subject: 'line:SchC.1', payload: { target: 'line:SchC.1', text: 'b' }, at: '2026-06-23T09:01:00Z' },
  ]);
  const ev = loadEvents(ws);
  for (let i = 1; i < ev.length; i++) assert.equal(ev[i].prev_hash, ev[i - 1].hash);
  assert.equal(verifyChain(ws).ok, true);
});

test('UPDATE and DELETE on events are refused by the database', () => {
  assert.throws(() => getDb().prepare("UPDATE events SET actor = 'evil' WHERE ws = ?").run(ws), /append-only/);
  assert.throws(() => getDb().prepare('DELETE FROM events WHERE ws = ?').run(ws), /append-only/);
});

test('tampering with a stored event breaks the chain', () => {
  const db = getDb();
  db.exec('DROP TRIGGER events_no_update');
  db.prepare("UPDATE events SET payload = ? WHERE ws = ? AND seq = 2").run(JSON.stringify({ target: 'line:SchC.1', text: 'rewritten' }), ws);
  clearCache(ws);
  const r = verifyChain(ws);
  assert.equal(r.ok, false);
  assert.equal(r.brokenAt, 2);
  // restore for later tests
  db.prepare("UPDATE events SET payload = ? WHERE ws = ? AND seq = 2").run(JSON.stringify({ target: 'line:SchC.1', text: 'a' }), ws);
  db.exec("CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;");
  clearCache(ws);
  assert.equal(verifyChain(ws).ok, true);
});

test('canonical JSON is key-order independent', () => {
  assert.equal(canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), canonical({ a: [2, { c: 2, d: 1 }], b: 1 }));
});

test('undo is an event: the fold skips the batch, history keeps it; redo restores it', () => {
  const adj = (id: string) => ({ actor: 'st-01', type: 'adjustment.created', subject: id, payload: { id, title: id, changes: [{ target: 'SchB.1.2', original: 1840, value: 0 }], reason: 'dup', findingIds: [] }, at: '2026-06-23T10:00:00Z', batch: 'batch-1' });
  appendMany(ws, [adj('ADJ-001'), adj('ADJ-002')]);
  let s = fold(ws, loadEvents(ws), firmStandards());
  assert.equal(s.adjustments.size, 2);
  append(ws, { actor: 'st-01', type: 'batch.undone', payload: { batch: 'batch-1' }, at: '2026-06-23T10:05:00Z' });
  s = fold(ws, loadEvents(ws), firmStandards());
  assert.equal(s.adjustments.size, 0);
  assert.equal(s.batches.get('batch-1')!.undone, true);
  assert.ok(loadEvents(ws).some((e) => e.payload.id === 'ADJ-001'), 'the original events remain in the log');
  append(ws, { actor: 'st-01', type: 'batch.redone', payload: { batch: 'batch-1' }, at: '2026-06-23T10:06:00Z' });
  assert.equal(fold(ws, loadEvents(ws), firmStandards()).adjustments.size, 2);
});

test('replay: folding up to a moment reproduces the state at that moment', () => {
  const at = '2026-06-23T09:00:30Z';
  const s = fold(ws, loadEvents(ws), firmStandards(), at);
  assert.equal(s.notes.length, 1);
  assert.equal(s.adjustments.size, 0);
});
