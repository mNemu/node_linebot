/** Generic score board rules - pure functions, no DB access.
 *
 * Modeled on YURU's molkky/rules.py + golf/rules.py: a board is an ordered
 * list of players plus an append-only log of point entries, and the whole
 * state (totals, ranking) is recomputed from that log every time so undo is
 * just "drop the last entry". Unlike those two, there are no game-specific
 * rules here (no target score, no bust, no holes/handicap): points simply
 * accumulate and the highest total ranks first. */

import { ConflictError, RuleError } from '../liff/errors.js';

export { ConflictError, RuleError };

export const MAX_PLAYERS = 20;
export const MAX_NAME_LENGTH = 32;
export const MAX_TITLE_LENGTH = 40;
export const MAX_ABS_POINTS = 9999;
export const STATUSES = ['playing', 'finished', 'aborted'];

export function normalizeName(raw) {
  const name = String(raw ?? '').trim();
  if (!name) throw new RuleError('名前を入力してください');
  if (name.length > MAX_NAME_LENGTH) throw new RuleError(`名前は${MAX_NAME_LENGTH}文字以内にしてください`);
  return name;
}

export function normalizeTitle(raw) {
  const title = String(raw ?? '').trim();
  if (title.length > MAX_TITLE_LENGTH) throw new RuleError(`タイトルは${MAX_TITLE_LENGTH}文字以内にしてください`);
  return title;
}

/** Validates the initial player list: 1..MAX_PLAYERS unique, non-empty names. */
export function normalizeNames(raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw new RuleError('参加者を1人以上追加してください');
  if (raw.length > MAX_PLAYERS) throw new RuleError(`参加者は${MAX_PLAYERS}人までです`);
  const names = [];
  for (const r of raw) {
    const name = normalizeName(r);
    if (names.includes(name)) throw new RuleError(`「${name}」が重複しています`);
    names.push(name);
  }
  return names;
}

export function normalizePoints(raw) {
  let points = raw;
  if (typeof points === 'string' && points.trim() !== '') points = Number(points);
  if (!Number.isInteger(points)) throw new RuleError('点数は整数で指定してください');
  if (Math.abs(points) > MAX_ABS_POINTS) throw new RuleError(`点数は±${MAX_ABS_POINTS}以内で指定してください`);
  return points;
}

export function normalizePlayerIndex(raw, playerCount) {
  const index = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (!Number.isInteger(index) || index < 0 || index >= playerCount) throw new RuleError('参加者の指定が不正です');
  return index;
}

/** Recomputes a board's state from its players and point log.
 *
 * players: [{ name }]                       (in join order)
 * turns:   [{ seq, playerIndex, points, createdAt }]  (seq ascending)
 *
 * Returns { players: [{ name, score, entries, rank }], ranking: [playerIndex...], turns: [...] }.
 * Ranking is by total score descending; ties share a rank (1, 1, 3 ...) and are
 * listed in join order. */
export function computeState(players, turns) {
  const scores = players.map(() => 0);
  const entries = players.map(() => 0);
  const log = [];

  for (const turn of turns) {
    const idx = turn.playerIndex;
    if (idx < 0 || idx >= players.length) continue;
    scores[idx] += turn.points;
    entries[idx] += 1;
    log.push({
      seq: turn.seq,
      playerIndex: idx,
      points: turn.points,
      scoreAfter: scores[idx],
      createdAt: turn.createdAt,
    });
  }

  const ordered = players
    .map((_, index) => ({ index, score: scores[index] }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const rank = [];
  let prevScore = null;
  let currentRank = 0;
  ordered.forEach((p, i) => {
    if (p.score !== prevScore) {
      currentRank = i + 1;
      prevScore = p.score;
    }
    rank[p.index] = currentRank;
  });

  return {
    players: players.map((p, i) => ({ name: p.name, score: scores[i], entries: entries[i], rank: rank[i] })),
    ranking: ordered.map((p) => p.index),
    turns: log,
  };
}
