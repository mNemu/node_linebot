/** Golf round persistence (SQLite). Port of YURU's golf/services.py minus the
 * invite-only ("参加者限定") rounds: every round is visible to everyone, and
 * only the creator can finish / abort / delete it. Each player's strokes are
 * an append-only action log written only by that player; the server de-dups
 * by (player, seq) so a device can re-send safely after being offline. */
import { db } from '../lib/db.js';
import { ConflictError, ForbiddenError, RuleError } from '../liff/errors.js';
import { MAX_TITLE_LENGTH, computePlayer, rankPlayers, validateAction, validateHandicap, validateHoles } from './rules.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS golf_round (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL DEFAULT 'playing',
    title TEXT NOT NULL DEFAULT '',
    holes INTEGER NOT NULL DEFAULT 9,
    created_by TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE TABLE IF NOT EXISTS golf_player (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL,
    lineid TEXT NOT NULL,
    name TEXT NOT NULL,
    handicap INTEGER NOT NULL DEFAULT 0,
    joined_at TEXT NOT NULL,
    UNIQUE (round_id, lineid)
  );
  CREATE TABLE IF NOT EXISTS golf_action (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    kind TEXT NOT NULL,
    hole INTEGER,
    value INTEGER,
    created_at TEXT NOT NULL,
    UNIQUE (player_id, seq)
  );
`);

const stmts = {
  get: db.prepare('SELECT * FROM golf_round WHERE id = ?'),
  active: db.prepare("SELECT * FROM golf_round WHERE status = 'playing' ORDER BY started_at, id"),
  ended: db.prepare("SELECT * FROM golf_round WHERE status <> 'playing' ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?"),
  countEnded: db.prepare("SELECT COUNT(*) AS n FROM golf_round WHERE status <> 'playing'"),
  finished: db.prepare("SELECT * FROM golf_round WHERE status = 'finished' ORDER BY started_at, id"),
  insert: db.prepare('INSERT INTO golf_round (status, title, holes, created_by, started_at) VALUES (?, ?, ?, ?, ?)'),
  setStatus: db.prepare('UPDATE golf_round SET status = ?, finished_at = ? WHERE id = ?'),
  del: db.prepare('DELETE FROM golf_round WHERE id = ?'),

  players: db.prepare('SELECT * FROM golf_player WHERE round_id = ? ORDER BY joined_at, id'),
  player: db.prepare('SELECT * FROM golf_player WHERE round_id = ? AND lineid = ?'),
  insertPlayer: db.prepare('INSERT INTO golf_player (round_id, lineid, name, handicap, joined_at) VALUES (?, ?, ?, ?, ?)'),
  updatePlayer: db.prepare('UPDATE golf_player SET name = ?, handicap = ? WHERE id = ?'),
  delPlayers: db.prepare('DELETE FROM golf_player WHERE round_id = ?'),

  actions: db.prepare('SELECT seq, kind, hole, value FROM golf_action WHERE player_id = ? ORDER BY seq'),
  seqs: db.prepare('SELECT seq FROM golf_action WHERE player_id = ?'),
  insertAction: db.prepare('INSERT INTO golf_action (player_id, seq, kind, hole, value, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
  delActionsOfRound: db.prepare('DELETE FROM golf_action WHERE player_id IN (SELECT id FROM golf_player WHERE round_id = ?)'),
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

function playerRows(round) {
  return stmts.players.all(round.id).map((p, order) => {
    const actions = stmts.actions.all(p.id);
    return {
      id: p.id,
      lineid: p.lineid,
      name: p.name,
      handicap: p.handicap,
      order,
      lastSeq: actions.length ? actions[actions.length - 1].seq : -1,
      ...computePlayer(actions, round.holes, p.handicap),
    };
  });
}

const allFinished = (rows) => rows.length > 0 && rows.every((r) => r.finished);

/** Round + everyone's computed scorecard; `viewer` marks "me" and management rights. */
export function buildRoundView(round, viewer = null) {
  const rows = playerRows(round);
  const ranked = rankPlayers(rows);
  const players = rows.map(({ lineid, ...rest }) => ({ ...rest, isMe: lineid === viewer }));
  return {
    id: round.id,
    status: round.status,
    title: round.title || null,
    holes: round.holes,
    startedAt: ms(round.started_at),
    finishedAt: ms(round.finished_at),
    players, // join order
    ranking: ranked.map((r) => r.id), // player ids in rank order
    allFinished: allFinished(rows),
    joined: players.some((p) => p.isMe),
    canManage: round.created_by === viewer,
  };
}

export function getRound(id, viewer = null) {
  const round = stmts.get.get(id);
  return round ? buildRoundView(round, viewer) : null;
}

export function listActiveRounds(viewer = null) {
  return stmts.active.all().map((r) => buildRoundView(r, viewer));
}

export function listRounds(limit = 50, offset = 0, viewer = null) {
  return stmts.ended.all(limit, offset).map((r) => buildRoundView(r, viewer));
}

export function countRounds() {
  return stmts.countEnded.get().n;
}

/** New round; the creator joins automatically. */
export function createRound(payload, lineid, name) {
  const body = payload && typeof payload === 'object' ? payload : {};
  if (!name) throw new RuleError('ニックネームを設定してから参加してください');
  const holes = validateHoles(body.holes ?? 9);
  const handicap = validateHandicap(body.handicap);
  const title = String(body.title ?? '').trim().slice(0, MAX_TITLE_LENGTH);
  return transaction(() => {
    const ts = now();
    const { lastInsertRowid: id } = stmts.insert.run('playing', title, holes, lineid, ts);
    stmts.insertPlayer.run(id, lineid, name, handicap, ts);
    return getRound(id, lineid);
  });
}

/** Joins the viewer (or updates their handicap / name if already in). */
export function joinRound(id, lineid, name, handicap) {
  if (!name) throw new RuleError('ニックネームを設定してから参加してください');
  const hc = validateHandicap(handicap);
  return transaction(() => {
    const round = stmts.get.get(id);
    if (!round) return null;
    if (round.status !== 'playing') throw new ConflictError('このラウンドは終了しています');
    const existing = stmts.player.get(id, lineid);
    if (existing) stmts.updatePlayer.run(name, hc, existing.id);
    else stmts.insertPlayer.run(id, lineid, name, hc, now());
    return getRound(id, lineid);
  });
}

/** The viewer's server-side log, for switching devices. */
export function getMyActions(id, lineid) {
  const round = stmts.get.get(id);
  if (!round) return null;
  const player = stmts.player.get(id, lineid);
  if (!player) throw new ForbiddenError('このラウンドに参加していません');
  return stmts.actions.all(player.id);
}

/** Accepts the viewer's actions; already-received seqs are ignored (idempotent).
 * Finishes the round when everyone has holed out, and reopens it if an undo takes someone back. */
export function syncActions(id, lineid, rawActions) {
  if (!Array.isArray(rawActions)) throw new RuleError('actions は配列で指定してください');
  return transaction(() => {
    const round = stmts.get.get(id);
    if (!round) return null;
    if (round.status === 'aborted') throw new ConflictError('このラウンドは中断されています');
    const player = stmts.player.get(id, lineid);
    if (!player) throw new ForbiddenError('このラウンドに参加していません');
    const actions = rawActions.map((a) => validateAction(a, round.holes));
    const existing = new Set(stmts.seqs.all(player.id).map((r) => r.seq));
    const fresh = new Map();
    for (const a of actions) {
      if (!existing.has(a.seq)) fresh.set(a.seq, a); // duplicate seq in one batch: last one wins
    }
    const ts = now();
    for (const a of fresh.values()) stmts.insertAction.run(player.id, a.seq, a.kind, a.hole, a.value, ts);
    const rows = playerRows(round);
    if (allFinished(rows) && round.status === 'playing') {
      stmts.setStatus.run('finished', ts, id);
    } else if (!allFinished(rows) && round.status === 'finished') {
      stmts.setStatus.run('playing', null, id);
    }
    const lastSeq = Math.max(-1, ...existing, ...fresh.keys());
    return { round: getRound(id, lineid), lastSeq };
  });
}

function checkManage(round, lineid) {
  if (round.created_by !== lineid) throw new ForbiddenError('ラウンドを作成した人のみ操作できます');
}

function endRound(id, lineid, status) {
  return transaction(() => {
    const round = stmts.get.get(id);
    if (!round) return null;
    checkManage(round, lineid);
    if (round.status === 'playing') stmts.setStatus.run(status, now(), id);
    return getRound(id, lineid);
  });
}

export const finishRound = (id, lineid) => endRound(id, lineid, 'finished');
export const abortRound = (id, lineid) => endRound(id, lineid, 'aborted');

export function deleteRound(id, lineid) {
  return transaction(() => {
    const round = stmts.get.get(id);
    if (!round) return false;
    checkManage(round, lineid);
    stmts.delActionsOfRound.run(id);
    stmts.delPlayers.run(id);
    stmts.del.run(id);
    return true;
  });
}

/** Per-person stats over finished rounds, grouped by LINE id (latest name shown). */
export function getPlayerStats() {
  const stats = new Map();
  for (const round of stmts.finished.all()) {
    for (const r of rankPlayers(playerRows(round))) {
      const s = stats.get(r.lineid) ?? { name: r.name, rounds: 0, wins: 0, totalGross: 0, totalNet: 0, bestGross: null };
      s.name = r.name;
      s.rounds += 1;
      s.totalGross += r.gross;
      s.totalNet += r.net;
      if (r.rank === 1) s.wins += 1;
      if (s.bestGross === null || r.gross < s.bestGross) s.bestGross = r.gross;
      stats.set(r.lineid, s);
    }
  }
  return [...stats.values()]
    .map((s) => ({ ...s, avgGross: s.rounds ? s.totalGross / s.rounds : 0, avgNet: s.rounds ? s.totalNet / s.rounds : 0 }))
    .sort((a, b) => b.wins - a.wins || a.avgNet - b.avgNet || a.avgGross - b.avgGross || a.name.localeCompare(b.name, 'ja'));
}
