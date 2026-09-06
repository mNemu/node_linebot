/** SQLite persistence for timers (same linebot.sqlite as scoreboard/molkky).
 *
 * Timers live inside a "set" (timer_set): a named, user-owned collection.
 * A set is visible to its owner always, and to everyone else only once its
 * owner turns on `shared`. Anyone who can see a set (owner or, once shared,
 * any logged-in user) can create/operate/delete the timers inside it - the
 * `shared` flag only gates visibility, not what a visitor can do once they
 * can see it. Each user gets a private "自分用" set auto-created on first
 * use (see ensureDefaultSet).
 *
 * Two timer kinds:
 *  - deadline: counts down to a fixed target date/time. No start/pause/reset;
 *    the remaining time is simply targetAt - now, recomputed on every view.
 *  - duration: a stopwatch-style countdown from a fixed length, with
 *    start/pause/reset. While running, remaining time is derived from
 *    startedAt so every viewer computes the same value without polling in
 *    lockstep. */
import { db } from '../lib/db.js';
import { ConflictError, ForbiddenError, RuleError } from '../liff/errors.js';
import { normalizeDurationMs, normalizeKind, normalizeName, normalizeSetName, normalizeTargetAt } from './rules.js';

// このデータが導入される前から本番にあった、誰の物でもない全体共有の
// タイマー群の移行先。実ユーザーのLINE userIdとは絶対に衝突しない固定値。
const SYSTEM_OWNER = 'system';
const DEFAULT_SET_NAME = '自分用';
const MIGRATED_SET_NAME = '共有';

db.exec(`
  CREATE TABLE IF NOT EXISTS timer_set (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    shared INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS timer (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    set_id INTEGER,
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

// 導入前の timer テーブルには set_id が無いので、既存DBには後付けする。
const timerColumns = db.prepare("PRAGMA table_info(timer)").all().map((c) => c.name);
if (!timerColumns.includes('set_id')) {
  db.exec('ALTER TABLE timer ADD COLUMN set_id INTEGER');
}

// set_id が無い(=導入前からある)タイマーを、全員が見える「共有」セットへ
// 一度だけ移す。
(function migrateOwnerlessTimers() {
  const orphans = db.prepare('SELECT COUNT(*) AS n FROM timer WHERE set_id IS NULL').get().n;
  if (orphans === 0) return;
  const migratedSetId = getOrCreateSystemSharedSet();
  db.prepare('UPDATE timer SET set_id = ? WHERE set_id IS NULL').run(migratedSetId);
})();

function getOrCreateSystemSharedSet() {
  const existing = db
    .prepare('SELECT id FROM timer_set WHERE owner_user_id = ? AND name = ?')
    .get(SYSTEM_OWNER, MIGRATED_SET_NAME);
  if (existing) return existing.id;
  const { lastInsertRowid } = db
    .prepare('INSERT INTO timer_set (name, owner_user_id, shared, created_at) VALUES (?, ?, 1, ?)')
    .run(MIGRATED_SET_NAME, SYSTEM_OWNER, new Date().toISOString());
  return lastInsertRowid;
}

const stmts = {
  insertTimer: db.prepare(`
    INSERT INTO timer (set_id, name, kind, target_at, duration_ms, status, started_at, remaining_ms, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getTimer: db.prepare('SELECT * FROM timer WHERE id = ?'),
  listBySet: db.prepare('SELECT * FROM timer WHERE set_id = ? ORDER BY created_at DESC, id DESC'),
  setRunning: db.prepare("UPDATE timer SET status = 'running', started_at = ?, remaining_ms = ? WHERE id = ?"),
  setPaused: db.prepare("UPDATE timer SET status = 'paused', started_at = NULL, remaining_ms = ? WHERE id = ?"),
  setIdle: db.prepare("UPDATE timer SET status = 'idle', started_at = NULL, remaining_ms = ? WHERE id = ?"),
  deleteTimer: db.prepare('DELETE FROM timer WHERE id = ?'),

  insertSet: db.prepare('INSERT INTO timer_set (name, owner_user_id, shared, created_at) VALUES (?, ?, ?, ?)'),
  getSet: db.prepare('SELECT * FROM timer_set WHERE id = ?'),
  ownedSets: db.prepare('SELECT * FROM timer_set WHERE owner_user_id = ? ORDER BY created_at, id'),
  sharedSetsExcept: db.prepare('SELECT * FROM timer_set WHERE shared = 1 AND owner_user_id != ? ORDER BY created_at, id'),
  updateSet: db.prepare('UPDATE timer_set SET name = ?, shared = ? WHERE id = ?'),
  deleteSet: db.prepare('DELETE FROM timer_set WHERE id = ?'),
  deleteTimersOfSet: db.prepare('DELETE FROM timer WHERE set_id = ?'),
};

const now = () => new Date().toISOString();
const ms = (iso) => (iso ? Date.parse(iso) : null);

function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/* ─── セット ─── */

const setView = (row, userId) => ({
  id: row.id,
  name: row.name,
  shared: !!row.shared,
  isMine: row.owner_user_id === userId,
  createdAt: ms(row.created_at),
});

/** 見えるセット一覧(自分のもの全部 + 他人が共有にしたもの)。ユーザーが
 * 一つもセットを持っていなければ、非共有の既定セットを1つ作る。 */
export function listVisibleSets(userId) {
  ensureDefaultSet(userId);
  const mine = stmts.ownedSets.all(userId);
  const others = stmts.sharedSetsExcept.all(userId);
  return [...mine, ...others].map((row) => setView(row, userId));
}

export function ensureDefaultSet(userId) {
  if (stmts.ownedSets.get(userId)) return;
  stmts.insertSet.run(DEFAULT_SET_NAME, userId, 0, now());
}

export function createSet(name, shared, userId) {
  const cleanName = normalizeSetName(name);
  const { lastInsertRowid: id } = stmts.insertSet.run(cleanName, userId, shared ? 1 : 0, now());
  return setView(stmts.getSet.get(id), userId);
}

export function updateSet(id, userId, { name, shared }) {
  const row = stmts.getSet.get(id);
  if (!row) return null;
  if (row.owner_user_id !== userId) throw new ForbiddenError('自分が作成したセットのみ変更できます');
  const nextName = name === undefined ? row.name : normalizeSetName(name);
  const nextShared = shared === undefined ? row.shared : (shared ? 1 : 0);
  stmts.updateSet.run(nextName, nextShared, id);
  return setView(stmts.getSet.get(id), userId);
}

export function deleteSet(id, userId) {
  const row = stmts.getSet.get(id);
  if (!row) return false;
  if (row.owner_user_id !== userId) throw new ForbiddenError('自分が作成したセットのみ削除できます');
  if (stmts.ownedSets.all(userId).length <= 1) throw new RuleError('最後の1つのセットは削除できません');
  transaction(() => {
    stmts.deleteTimersOfSet.run(id);
    stmts.deleteSet.run(id);
  });
  return true;
}

/** セットが見えるか(所有者、または共有オンになっているか)。見えなければ
 * null(存在しない扱い)を返す - 見える相手には存在自体を隠す必要はないが、
 * 見えない相手には404と403を区別して教える理由もないため。 */
function visibleSet(setId, userId) {
  const row = stmts.getSet.get(setId);
  if (!row) return null;
  if (row.owner_user_id !== userId && !row.shared) return null;
  return row;
}

/* ─── タイマー ─── */

/** Full timer view as sent to the client (camelCase, epoch-ms timestamps,
 * remaining time already resolved for the current moment). */
export function buildView(row) {
  const base = {
    id: row.id,
    setId: row.set_id,
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

/** セット内のタイマー一覧。セットが見えなければ null。 */
export function listTimersInSet(setId, userId) {
  if (!visibleSet(setId, userId)) return null;
  return stmts.listBySet.all(setId).map(buildView);
}

export function getTimer(id) {
  const row = stmts.getTimer.get(id);
  return row ? buildView(row) : null;
}

export function createTimer(setId, { name, kind, targetAt, durationMs }, createdBy) {
  if (!visibleSet(setId, createdBy)) return null;
  const cleanName = normalizeName(name);
  const cleanKind = normalizeKind(kind);
  const created = now();
  let id;
  if (cleanKind === 'deadline') {
    const cleanTargetAt = normalizeTargetAt(targetAt);
    ({ lastInsertRowid: id } = stmts.insertTimer.run(setId, cleanName, cleanKind, cleanTargetAt, null, 'idle', null, null, createdBy, created));
  } else {
    const cleanDurationMs = normalizeDurationMs(durationMs);
    ({ lastInsertRowid: id } = stmts.insertTimer.run(setId, cleanName, cleanKind, null, cleanDurationMs, 'idle', null, cleanDurationMs, createdBy, created));
  }
  return getTimer(id);
}

/** タイマーIDから、操作者に見えているか(そのタイマーが属すセットが見える
 * か)を確認する。見つからない/見えない場合は null。 */
function requireVisibleTimer(id, userId) {
  const row = stmts.getTimer.get(id);
  if (!row) return null;
  if (!visibleSet(row.set_id, userId)) return null;
  return row;
}

function requireDuration(id, userId) {
  const row = requireVisibleTimer(id, userId);
  if (!row) return null;
  if (row.kind !== 'duration') throw new ConflictError('この種類のタイマーには使えません');
  return row;
}

export function startTimer(id, userId) {
  const row = requireDuration(id, userId);
  if (!row) return null;
  if (row.status === 'running') return buildView(row);
  const remaining = row.status === 'idle' ? row.duration_ms : row.remaining_ms;
  stmts.setRunning.run(now(), remaining, id);
  return getTimer(id);
}

export function pauseTimer(id, userId) {
  const row = requireDuration(id, userId);
  if (!row) return null;
  if (row.status !== 'running') return buildView(row);
  const remaining = Math.max(0, row.remaining_ms - (Date.now() - ms(row.started_at)));
  stmts.setPaused.run(remaining, id);
  return getTimer(id);
}

export function resetTimer(id, userId) {
  const row = requireDuration(id, userId);
  if (!row) return null;
  stmts.setIdle.run(row.duration_ms, id);
  return getTimer(id);
}

export function deleteTimer(id, userId) {
  if (!requireVisibleTimer(id, userId)) return false;
  stmts.deleteTimer.run(id);
  return true;
}
