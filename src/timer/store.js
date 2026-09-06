/** SQLite persistence for shared timers (same linebot.sqlite as scoreboard/molkky).
 * Two kinds:
 *  - deadline: counts down to a fixed target date/time. No start/pause/reset;
 *    the remaining time is simply targetAt - now, recomputed on every view.
 *  - duration: a stopwatch-style countdown from a fixed length, with
 *    start/pause/reset. While running, remaining time is derived from
 *    startedAt so every viewer computes the same value without polling in
 *    lockstep. */
import { db } from '../lib/db.js';
import { ConflictError } from '../liff/errors.js';
import { normalizeDurationMs, normalizeKind, normalizeName, normalizeTargetAt } from './rules.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS timer (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    target_at TEXT,
    duration_ms INTEGER,
    status TEXT NOT NULL DEFAULT 'idle',
    started_at TEXT,
    remaining_ms INTEGER,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

const stmts = {
  insert: db.prepare(`
    INSERT INTO timer (name, kind, target_at, duration_ms, status, started_at, remaining_ms, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  get: db.prepare('SELECT * FROM timer WHERE id = ?'),
  list: db.prepare('SELECT * FROM timer ORDER BY created_at DESC, id DESC'),
  setRunning: db.prepare("UPDATE timer SET status = 'running', started_at = ?, remaining_ms = ? WHERE id = ?"),
  setPaused: db.prepare("UPDATE timer SET status = 'paused', started_at = NULL, remaining_ms = ? WHERE id = ?"),
  setIdle: db.prepare("UPDATE timer SET status = 'idle', started_at = NULL, remaining_ms = ? WHERE id = ?"),
  delete: db.prepare('DELETE FROM timer WHERE id = ?'),
};

const now = () => new Date().toISOString();
const ms = (iso) => (iso ? Date.parse(iso) : null);

/** Full timer view as sent to the client (camelCase, epoch-ms timestamps,
 * remaining time already resolved for the current moment). */
export function buildView(row) {
  const base = {
    id: row.id,
    name: row.name,
    kind: row.kind,
    createdBy: row.created_by,
    createdAt: ms(row.created_at),
  };
  if (row.kind === 'deadline') {
    const targetAt = ms(row.target_at);
    return { ...base, targetAt, remainingMs: targetAt - Date.now() };
  }
  const durationMs = row.duration_ms;
  let remainingMs = row.remaining_ms;
  if (row.status === 'running') {
    remainingMs = Math.max(0, row.remaining_ms - (Date.now() - ms(row.started_at)));
  }
  return {
    ...base,
    durationMs,
    status: row.status === 'running' && remainingMs <= 0 ? 'finished' : row.status,
    remainingMs,
  };
}

export function listTimers() {
  return stmts.list.all().map(buildView);
}

export function getTimer(id) {
  const row = stmts.get.get(id);
  return row ? buildView(row) : null;
}

export function createTimer({ name, kind, targetAt, durationMs }, createdBy) {
  const cleanName = normalizeName(name);
  const cleanKind = normalizeKind(kind);
  const created = now();
  let id;
  if (cleanKind === 'deadline') {
    const cleanTargetAt = normalizeTargetAt(targetAt);
    ({ lastInsertRowid: id } = stmts.insert.run(cleanName, cleanKind, cleanTargetAt, null, 'idle', null, null, createdBy, created));
  } else {
    const cleanDurationMs = normalizeDurationMs(durationMs);
    ({ lastInsertRowid: id } = stmts.insert.run(cleanName, cleanKind, null, cleanDurationMs, 'idle', null, cleanDurationMs, createdBy, created));
  }
  return getTimer(id);
}

function requireDuration(id) {
  const row = stmts.get.get(id);
  if (!row) return null;
  if (row.kind !== 'duration') throw new ConflictError('この種類のタイマーには使えません');
  return row;
}

export function startTimer(id) {
  const row = requireDuration(id);
  if (!row) return null;
  if (row.status === 'running') return buildView(row);
  const remaining = row.status === 'idle' ? row.duration_ms : row.remaining_ms;
  stmts.setRunning.run(now(), remaining, id);
  return getTimer(id);
}

export function pauseTimer(id) {
  const row = requireDuration(id);
  if (!row) return null;
  if (row.status !== 'running') return buildView(row);
  const remaining = Math.max(0, row.remaining_ms - (Date.now() - ms(row.started_at)));
  stmts.setPaused.run(remaining, id);
  return getTimer(id);
}

export function resetTimer(id) {
  const row = requireDuration(id);
  if (!row) return null;
  stmts.setIdle.run(row.duration_ms, id);
  return getTimer(id);
}

export function deleteTimer(id) {
  if (!stmts.get.get(id)) return false;
  stmts.delete.run(id);
  return true;
}
