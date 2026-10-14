// SQLite persistence (node:sqlite, no native dependencies). The events table is append-only:
// this module exposes no UPDATE or DELETE for events. "Undo" and "revert" are new events.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DB_PATH = process.env.DB_PATH || resolve(process.env.DATA_DIR || 'data', 'workpaper.db');

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      label TEXT,
      packet_sha256 TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      ws TEXT NOT NULL,
      seq INTEGER NOT NULL,
      id TEXT NOT NULL,
      at TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      actor TEXT NOT NULL,
      type TEXT NOT NULL,
      subject TEXT,
      payload TEXT NOT NULL,
      batch TEXT,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL,
      PRIMARY KEY (ws, seq)
    );
    CREATE INDEX IF NOT EXISTS events_ws_type ON events (ws, type);
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      ws TEXT NOT NULL,
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      data BLOB NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
      BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
      BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
  `);
  return db;
}

export function dbPath() {
  return DB_PATH;
}
