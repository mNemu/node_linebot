/** Mölkky game persistence (SQLite). Port of YURU's molkky/services.py:
 * the game row only stores the setup (teams / rules); scores are recomputed
 * from the throw log by rules.computeState on every read. */
import { db } from '../lib/db.js';
import { ConflictError, RuleError } from '../liff/errors.js';
import { MAX_POINTS, MAX_TITLE_LENGTH, MISS_RULES, MODES, computeState, normalizePoints, normalizeTeams } from './rules.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS molkky_game (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL DEFAULT 'playing',
    title TEXT NOT NULL DEFAULT '',
    mode TEXT NOT NULL,
    miss_rule TEXT NOT NULL,
    play_on INTEGER NOT NULL DEFAULT 0,
    teams TEXT NOT NULL,
    winner_index INTEGER,
    started_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE TABLE IF NOT EXISTS molkky_turn (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    team_index INTEGER NOT NULL,
    thrower TEXT NOT NULL,
    points INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (game_id, seq)
  );
`);

const stmts = {
  get: db.prepare('SELECT * FROM molkky_game WHERE id = ?'),
  active: db.prepare("SELECT * FROM molkky_game WHERE status = 'playing' ORDER BY started_at, id"),
  ended: db.prepare(
    "SELECT * FROM molkky_game WHERE status <> 'playing' ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?"
  ),
  countEnded: db.prepare("SELECT COUNT(*) AS n FROM molkky_game WHERE status <> 'playing'"),
  finished: db.prepare("SELECT * FROM molkky_game WHERE status = 'finished'"),
  recent: db.prepare('SELECT teams FROM molkky_game ORDER BY started_at DESC, id DESC LIMIT ?'),
  insert: db.prepare(
    'INSERT INTO molkky_game (status, title, mode, miss_rule, play_on, teams, started_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
  ),
  update: db.prepare(
    'UPDATE molkky_game SET status = ?, play_on = ?, winner_index = ?, finished_at = ? WHERE id = ?'
  ),
  del: db.prepare('DELETE FROM molkky_game WHERE id = ?'),
  turns: db.prepare(
    'SELECT seq, team_index AS teamIndex, thrower, points FROM molkky_turn WHERE game_id = ? ORDER BY seq'
  ),
  turnsOfFinished: db.prepare(
    "SELECT t.thrower, t.points FROM molkky_turn t JOIN molkky_game g ON g.id = t.game_id WHERE g.status = 'finished'"
  ),
  lastTurn: db.prepare('SELECT id, seq FROM molkky_turn WHERE game_id = ? ORDER BY seq DESC LIMIT 1'),
  insertTurn: db.prepare(
    'INSERT INTO molkky_turn (game_id, seq, team_index, thrower, points, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  delTurn: db.prepare('DELETE FROM molkky_turn WHERE id = ?'),
  delTurns: db.prepare('DELETE FROM molkky_turn WHERE game_id = ?'),
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

const rules = (row) => ({ teams: JSON.parse(row.teams), missRule: row.miss_rule, playOn: Boolean(row.play_on) });
const gameState = (row) => computeState(rules(row), stmts.turns.all(row.id));

/** Game row + computed state, in the shape the page expects. */
export function buildGameView(row) {
  const state = gameState(row);
  return {
    id: row.id,
    status: row.status,
    title: row.title || null,
    mode: row.mode,
    missRule: row.miss_rule,
    playOn: Boolean(row.play_on),
    startedAt: ms(row.started_at),
    finishedAt: ms(row.finished_at),
    winnerIndex: row.status === 'finished' ? row.winner_index : state.winnerIndex,
    finished: state.finished,
    canContinue: state.canContinue,
    activeCount: state.activeCount,
    teams: state.teams,
    currentTeamIndex: state.currentTeamIndex,
    currentThrower: state.currentThrower,
    turns: state.turns,
    lastEvent: state.lastEvent,
  };
}

const save = (row) => stmts.update.run(row.status, row.play_on ? 1 : 0, row.winner_index, row.finished_at, row.id);

export function getGame(id) {
  const row = stmts.get.get(id);
  return row ? buildGameView(row) : null;
}

export function listActiveGames() {
  return stmts.active.all().map(buildGameView);
}

export function createGame(payload) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const mode = body.mode;
  const missRule = body.missRule ?? body.miss_rule;
  if (!MODES.includes(mode)) throw new RuleError('mode は solo / team のいずれかです');
  if (!MISS_RULES.includes(missRule)) throw new RuleError('missRule は eliminate / reset のいずれかです');
  const teams = normalizeTeams(body.teams);
  const title = String(body.title ?? '').trim().slice(0, MAX_TITLE_LENGTH);
  const { lastInsertRowid: id } = stmts.insert.run('playing', title, mode, missRule, JSON.stringify(teams), now());
  return buildGameView(stmts.get.get(id));
}

/** Adds one throw; whose turn it is (and who throws) is decided server-side. */
export function addTurn(id, rawPoints) {
  const points = normalizePoints(rawPoints);
  return transaction(() => {
    const row = stmts.get.get(id);
    if (!row) return null;
    if (row.status !== 'playing') throw new ConflictError('このゲームは終了しています');
    const turns = stmts.turns.all(id);
    const state = computeState(rules(row), turns);
    if (state.finished) throw new ConflictError('既に勝者が決まっています');
    const seq = turns.length ? turns[turns.length - 1].seq + 1 : 0;
    const teamIndex = state.currentTeamIndex;
    const thrower = state.currentThrower;
    stmts.insertTurn.run(id, seq, teamIndex, thrower, points, now());
    const after = computeState(rules(row), [...turns, { seq, teamIndex, thrower, points }]);
    if (after.finished) {
      row.status = 'finished';
      row.winner_index = after.winnerIndex;
      row.finished_at = now();
      save(row);
    }
    return buildGameView(stmts.get.get(id));
  });
}

/** Removes the last throw; a finished game goes back to playing. */
export function undoLastTurn(id) {
  return transaction(() => {
    const row = stmts.get.get(id);
    if (!row) return null;
    if (row.status === 'aborted') throw new RuleError('中断したゲームは操作できません');
    const last = stmts.lastTurn.get(id);
    if (!last) throw new RuleError('取り消せる投擲がありません');
    stmts.delTurn.run(last.id);
    let changed = false;
    if (row.status === 'finished') {
      row.status = 'playing';
      row.winner_index = null;
      row.finished_at = null;
      changed = true;
    }
    // If every 50 has been undone, forget the "continue" choice so it can be offered again.
    if (row.play_on && !gameState(row).teams.some((t) => t.done)) {
      row.play_on = 0;
      changed = true;
    }
    if (changed) save(row);
    return buildGameView(stmts.get.get(id));
  });
}

/** After the first 50, keep playing with the remaining teams to settle 2nd place and below. */
export function continueGame(id) {
  return transaction(() => {
    const row = stmts.get.get(id);
    if (!row) return null;
    if (row.status !== 'finished') throw new RuleError('終了したゲームのみ続行できます');
    if (!gameState(row).canContinue) throw new RuleError('続行できる状態ではありません(残りチームが1つ以下、または続行済み)');
    row.play_on = 1;
    row.status = 'playing';
    row.finished_at = null;
    save(row);
    return buildGameView(stmts.get.get(id));
  });
}

export function abortGame(id) {
  return transaction(() => {
    const row = stmts.get.get(id);
    if (!row) return null;
    if (row.status === 'playing') {
      row.status = 'aborted';
      row.finished_at = now();
      save(row);
    }
    return buildGameView(stmts.get.get(id));
  });
}

export function deleteGame(id) {
  return transaction(() => {
    if (!stmts.get.get(id)) return false;
    stmts.delTurns.run(id);
    stmts.del.run(id);
    return true;
  });
}

/** History (finished / aborted, newest first) with final scores. */
export function listGames(limit = 50, offset = 0) {
  return stmts.ended.all(limit, offset).map((row) => {
    const state = gameState(row);
    return {
      id: row.id,
      status: row.status,
      title: row.title || null,
      mode: row.mode,
      missRule: row.miss_rule,
      playOn: Boolean(row.play_on),
      startedAt: ms(row.started_at),
      finishedAt: ms(row.finished_at),
      winnerIndex: row.winner_index,
      turnCount: state.turns.length,
      teams: state.teams.map((t) => ({
        name: t.name,
        members: t.members,
        score: t.score,
        eliminated: t.eliminated,
        done: t.done,
        rank: t.rank,
      })),
    };
  });
}

export function countGames() {
  return stmts.countEnded.get().n;
}

/** Past participant names, most recent first, de-duplicated. */
export function listPlayerNames(limit = 100) {
  const names = [];
  const seen = new Set();
  for (const { teams } of stmts.recent.all(limit)) {
    for (const team of JSON.parse(teams)) {
      for (const m of team.members) {
        if (!seen.has(m)) {
          seen.add(m);
          names.push(m);
        }
      }
    }
  }
  return names;
}

/** Per-player stats over finished games only. */
export function getPlayerStats() {
  const stats = new Map();
  const ensure = (name) => {
    if (!stats.has(name)) stats.set(name, { name, games: 0, wins: 0, throws: 0, totalPoints: 0, twelves: 0, zeros: 0 });
    return stats.get(name);
  };
  for (const row of stmts.finished.all()) {
    JSON.parse(row.teams).forEach((team, i) => {
      for (const m of team.members) {
        const s = ensure(m);
        s.games += 1;
        if (i === row.winner_index) s.wins += 1;
      }
    });
  }
  for (const { thrower, points } of stmts.turnsOfFinished.all()) {
    const s = ensure(thrower);
    s.throws += 1;
    s.totalPoints += points;
    if (points === MAX_POINTS) s.twelves += 1;
    if (points === 0) s.zeros += 1;
  }
  return [...stats.values()]
    .map((s) => ({
      ...s,
      winRate: s.games ? s.wins / s.games : 0,
      avgPoints: s.throws ? s.totalPoints / s.throws : 0,
      zeroRate: s.throws ? s.zeros / s.throws : 0,
    }))
    .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || b.avgPoints - a.avgPoints || a.name.localeCompare(b.name, 'ja'));
}
