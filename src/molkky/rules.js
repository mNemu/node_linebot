/** Mölkky scoring (pure functions, no DB). Port of YURU's molkky/rules.py,
 * which itself came from gpsbot's computeState. Game state is recomputed from
 * the throw log every time, so "undo" is just deleting the last log row. */
import { RuleError } from '../liff/errors.js';

export const TARGET_SCORE = 50; // exact hit wins
export const BUST_SCORE = 25; // going over 50 drops you here
export const MAX_MISSES = 3; // consecutive misses allowed
export const MISS_RULES = ['eliminate', 'reset'];
export const MODES = ['solo', 'team'];
export const MAX_POINTS = 12;
export const MAX_TITLE_LENGTH = 40;
export const MAX_NAME_LENGTH = 64;

const isActive = (team) => !team.done && !team.eliminated;

/** First active team at or after `start` (wrapping); `start` itself if none. */
function nextActiveIndex(teams, start) {
  const n = teams.length;
  for (let i = 0; i < n; i++) {
    const idx = (start + i) % n;
    if (isActive(teams[idx])) return idx;
  }
  return start % n;
}

/** Final ranks at the end: reached 50 (in order) → rest by score → eliminated by score. */
function assignFinalRanks(teams) {
  const kind = (t) => (t.done ? 0 : t.eliminated ? 2 : 1);
  const order = teams
    .map((t, i) => i)
    .sort((a, b) => {
      const ta = teams[a];
      const tb = teams[b];
      const ka = kind(ta);
      const kb = kind(tb);
      if (ka !== kb) return ka - kb;
      if (ka === 0 && ta.rank !== tb.rank) return ta.rank - tb.rank;
      if (ta.score !== tb.score) return tb.score - ta.score;
      return a - b;
    });
  order.forEach((i, pos) => {
    teams[i].rank = pos + 1;
  });
}

/**
 * Recomputes the game from its throw log.
 * game:  { teams: [{ name, members }], missRule: 'reset'|'eliminate', playOn: bool }
 * turns: [{ seq, teamIndex, thrower, points }] in seq order
 * With playOn, play continues after the first 50 to rank the remaining teams.
 */
export function computeState(game, turns) {
  const teams = game.teams.map((t) => ({
    name: t.name,
    members: [...t.members],
    score: 0,
    consecutiveMisses: 0,
    eliminated: false,
    done: false, // reached 50 (throws no more)
    rank: null, // arrival order; every team gets a final rank when finished
    throwCount: 0,
  }));
  const missRule = game.missRule ?? 'reset';
  const playOn = Boolean(game.playOn);
  let winnerIndex = null;
  let finished = false;
  let nextRank = 1;
  let currentTeamIndex = 0;
  const log = [];

  for (const turn of turns) {
    if (finished) break;
    const idx = turn.teamIndex;
    if (idx < 0 || idx >= teams.length) continue;
    const t = teams[idx];
    t.throwCount += 1;
    let event = null;
    const points = turn.points;

    if (points === 0) {
      t.consecutiveMisses += 1;
      if (t.consecutiveMisses >= MAX_MISSES) {
        if (missRule === 'eliminate') {
          t.eliminated = true;
          event = 'eliminated';
        } else {
          t.score = 0;
          t.consecutiveMisses = 0;
          event = 'resetZero';
        }
      }
    } else {
      t.consecutiveMisses = 0;
      t.score += points;
      if (t.score === TARGET_SCORE) {
        t.done = true;
        t.rank = nextRank;
        nextRank += 1;
        if (winnerIndex === null) {
          winnerIndex = idx;
          event = 'win';
        } else {
          event = 'goal';
        }
      } else if (t.score > TARGET_SCORE) {
        t.score = BUST_SCORE;
        event = 'bust';
      }
    }

    const active = teams.map((x, i) => (isActive(x) ? i : -1)).filter((i) => i >= 0);
    if (event === 'win' && !playOn) {
      finished = true;
    } else if (active.length <= 1) {
      finished = true;
      if (winnerIndex === null) {
        // Nobody reached 50 (decided by eliminations): the survivor, or the top score.
        if (active.length === 1) winnerIndex = active[0];
        else {
          winnerIndex = teams.reduce((best, x, i) => (x.score > teams[best].score ? i : best), 0);
        }
      }
    }

    log.push({ seq: turn.seq, teamIndex: idx, thrower: turn.thrower, points, scoreAfter: t.score, event });
    currentTeamIndex = nextActiveIndex(teams, idx + 1);
  }

  if (finished) assignFinalRanks(teams);
  const activeCount = teams.filter(isActive).length;
  const current = teams[currentTeamIndex];
  const currentThrower = finished || !current ? null : current.members[current.throwCount % current.members.length];
  const lastEvent = log.length ? log[log.length - 1].event : null;
  // Ended on the first 50 but 2+ teams remain: the players may choose to continue for 2nd place etc.
  const canContinue = Boolean(
    finished && !playOn && winnerIndex !== null && teams[winnerIndex].done && activeCount >= 2
  );

  return {
    teams,
    winnerIndex,
    finished,
    canContinue,
    activeCount,
    currentTeamIndex,
    currentThrower,
    turns: log,
    lastEvent,
  };
}

/** Validates the team setup from the client; trims names and fills default team names. */
export function normalizeTeams(teams) {
  if (!Array.isArray(teams) || teams.length < 2) throw new RuleError('チームは2つ以上必要です');
  const seen = new Set();
  return teams.map((raw, i) => {
    const t = raw && typeof raw === 'object' ? raw : {};
    const members = (Array.isArray(t.members) ? t.members : [])
      .map((m) => String(m ?? '').trim())
      .filter(Boolean);
    if (members.length === 0) throw new RuleError(`チーム${i + 1}にメンバーがいません`);
    for (const m of members) {
      if (seen.has(m)) throw new RuleError(`「${m}」が複数のチームに含まれています`);
      seen.add(m);
    }
    if (members.some((m) => m.length > MAX_NAME_LENGTH)) throw new RuleError(`名前は${MAX_NAME_LENGTH}文字以内にしてください`);
    const name = String(t.name ?? '').trim() || members.join('・');
    return { name: name.slice(0, MAX_NAME_LENGTH), members };
  });
}

export function normalizePoints(raw) {
  let points = raw;
  if (typeof points === 'string' && /^\d+$/.test(points.trim())) points = Number(points);
  if (!Number.isInteger(points) || points < 0 || points > MAX_POINTS) {
    throw new RuleError(`得点は 0〜${MAX_POINTS} の整数で指定してください`);
  }
  return points;
}
