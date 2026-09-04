/** SQLite persistence for the score board (tables live in the same
 * linebot.sqlite as cfg/log). Every mutation returns the recomputed board
 * view so the client can re-render from a single response, the same way
 * YURU's molkky services do. */
import { db } from '../lib/db.js';
import {
  ConflictError,
  MAX_PLAYERS,
  RuleError,
  computeState,
  normalizeName,
  normalizeNames,
  normalizePlayerIndex,
  normalizePoints,
  normalizeTitle,
} from './rules.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS board (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'playing',
    started_at TEXT NOT NULL,
    ended_at TEXT
  );
  CREATE TABLE IF NOT EXISTS board_player (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL,
    ord INTEGER NOT NULL,
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS board_turn (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    player_index INTEGER NOT NULL,
    points INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS board_player_board ON board_player (board_id, ord);
  CREATE INDEX IF NOT EXISTS board_turn_board ON board_turn (board_id, seq);
`);

const stmts = {
  insertBoard: db.prepare('INSERT INTO board (title, status, started_at) VALUES (?, ?, ?)'),
  getBoard: db.prepare('SELECT * FROM board WHERE id = ?'),
  listActive: db.prepare("SELECT * FROM board WHERE status = 'playing' ORDER BY started_at DESC, id DESC"),
  listEnded: db.prepare(
    "SELECT * FROM board WHERE status IN ('finished', 'aborted') ORDER BY ended_at DESC, id DESC LIMIT ?"
  ),
  listFinished: db.prepare("SELECT * FROM board WHERE status = 'finished'"),
  setStatus: db.prepare('UPDATE board SET status = ?, ended_at = ? WHERE id = ?'),
  deleteBoard: db.prepare('DELETE FROM board WHERE id = ?'),

  players: db.prepare('SELECT name FROM board_player WHERE board_id = ? ORDER BY ord'),
  insertPlayer: db.prepare('INSERT INTO board_player (board_id, ord, name) VALUES (?, ?, ?)'),
  deletePlayers: db.prepare('DELETE FROM board_player WHERE board_id = ?'),
  recentNames: db.prepare(
    'SELECT name, MAX(id) AS last_id FROM board_player GROUP BY name ORDER BY last_id DESC LIMIT 50'
  ),

  turns: db.prepare(
    'SELECT seq, player_index AS playerIndex, points, created_at AS createdAt FROM board_turn WHERE board_id = ? ORDER BY seq'
  ),
  lastTurn: db.prepare('SELECT id, seq FROM board_turn WHERE board_id = ? ORDER BY seq DESC LIMIT 1'),
  insertTurn: db.prepare(
    'INSERT INTO board_turn (board_id, seq, player_index, points, created_at) VALUES (?, ?, ?, ?, ?)'
  ),
  deleteTurn: db.prepare('DELETE FROM board_turn WHERE id = ?'),
  deleteTurns: db.prepare('DELETE FROM board_turn WHERE board_id = ?'),
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

/** Full board view as sent to the client (camelCase, epoch-ms timestamps). */
export function buildView(row) {
  const players = stmts.players.all(row.id);
  const turns = stmts.turns.all(row.id);
  const state = computeState(players, turns);
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    startedAt: ms(row.started_at),
    endedAt: ms(row.ended_at),
    players: state.players,
    ranking: state.ranking,
    turns: state.turns,
    winnerIndex: row.status === 'finished' && state.ranking.length ? state.ranking[0] : null,
  };
}

function requirePlaying(id) {
  const row = stmts.getBoard.get(id);
  if (!row) return null;
  if (row.status !== 'playing') throw new ConflictError('このボードは終了しています');
  return row;
}

export function getBoard(id) {
  const row = stmts.getBoard.get(id);
  return row ? buildView(row) : null;
}

export function listActiveBoards() {
  return stmts.listActive.all().map(buildView);
}

export function listEndedBoards(limit = 50) {
  return stmts.listEnded.all(limit).map(buildView);
}

export function createBoard({ title, players }) {
  const cleanTitle = normalizeTitle(title);
  const names = normalizeNames(players);
  return transaction(() => {
    const { lastInsertRowid: id } = stmts.insertBoard.run(cleanTitle, 'playing', now());
    names.forEach((name, ord) => stmts.insertPlayer.run(id, ord, name));
    return buildView(stmts.getBoard.get(id));
  });
}

/** Adds a late joiner. Returns null if the board doesn't exist. */
export function addPlayer(id, rawName) {
  const name = normalizeName(rawName);
  return transaction(() => {
    const row = requirePlaying(id);
    if (!row) return null;
    const players = stmts.players.all(id);
    if (players.some((p) => p.name === name)) throw new RuleError(`「${name}」はすでに参加しています`);
    if (players.length >= MAX_PLAYERS) throw new RuleError(`参加者は${MAX_PLAYERS}人までです`);
    stmts.insertPlayer.run(id, players.length, name);
    return buildView(row);
  });
}

export function addTurn(id, rawPlayerIndex, rawPoints) {
  const points = normalizePoints(rawPoints);
  return transaction(() => {
    const row = requirePlaying(id);
    if (!row) return null;
    const playerIndex = normalizePlayerIndex(rawPlayerIndex, stmts.players.all(id).length);
    const last = stmts.lastTurn.get(id);
    stmts.insertTurn.run(id, last ? last.seq + 1 : 0, playerIndex, points, now());
    return buildView(row);
  });
}

export function undoLastTurn(id) {
  return transaction(() => {
    const row = requirePlaying(id);
    if (!row) return null;
    const last = stmts.lastTurn.get(id);
    if (!last) throw new ConflictError('取り消す記録がありません');
    stmts.deleteTurn.run(last.id);
    return buildView(row);
  });
}

function endBoard(id, status) {
  return transaction(() => {
    const row = requirePlaying(id);
    if (!row) return null;
    stmts.setStatus.run(status, now(), id);
    return buildView(stmts.getBoard.get(id));
  });
}

export const finishBoard = (id) => endBoard(id, 'finished');
export const abortBoard = (id) => endBoard(id, 'aborted');

export function deleteBoard(id) {
  return transaction(() => {
    if (!stmts.getBoard.get(id)) return false;
    stmts.deleteTurns.run(id);
    stmts.deletePlayers.run(id);
    stmts.deleteBoard.run(id);
    return true;
  });
}

/** Nicknames seen on any board, most recent first - used for the "add again" chips. */
export function listPlayerNames() {
  return stmts.recentNames.all().map((r) => r.name);
}

/** Per-nickname totals over finished boards only. */
export function playerStats() {
  const byName = new Map();
  for (const row of stmts.listFinished.all()) {
    const view = buildView(row);
    for (const p of view.players) {
      const s = byName.get(p.name) ?? { name: p.name, games: 0, wins: 0, totalScore: 0, bestScore: null };
      s.games += 1;
      if (p.rank === 1) s.wins += 1;
      s.totalScore += p.score;
      s.bestScore = s.bestScore === null ? p.score : Math.max(s.bestScore, p.score);
      byName.set(p.name, s);
    }
  }
  return [...byName.values()]
    .map((s) => ({
      name: s.name,
      games: s.games,
      wins: s.wins,
      winRate: s.games ? s.wins / s.games : 0,
      avgScore: s.games ? s.totalScore / s.games : 0,
      bestScore: s.bestScore,
    }))
    .sort((a, b) => b.wins - a.wins || b.avgScore - a.avgScore || a.name.localeCompare(b.name, 'ja'));
}
