/** Golf score state (pure functions). Port of YURU's golf/rules.py; the same
 * logic lives in public/liff/golf/golf.js so the page can update instantly
 * from its local action log without waiting for the server.
 *
 * Action log (in seq order):
 *   stroke     +1 stroke on the current hole
 *   next_hole  move to the next hole; after the last hole = hole out (finished)
 *   set        overwrite a hole's stroke count (fixing a missed tap)
 *   undo       cancel the previous effective action */
import { RuleError } from '../liff/errors.js';

export const KINDS = ['stroke', 'next_hole', 'set', 'undo'];
export const MIN_HOLES = 1;
export const MAX_HOLES = 36;
export const MAX_STROKES = 99;
export const MAX_TITLE_LENGTH = 40;

/** Actions that remain after applying undos (each undo drops the previous effective one). */
export function effectiveActions(actions) {
  const stack = [];
  for (const a of actions) {
    if (a.kind === 'undo') {
      if (stack.length) stack.pop();
    } else {
      stack.push(a);
    }
  }
  return stack;
}

/** One player's scorecard from their action log. */
export function computePlayer(actions, holes, handicap = 0) {
  const strokes = Array(holes).fill(0);
  let current = 1;
  let finished = false;
  for (const a of effectiveActions(actions)) {
    if (a.kind === 'stroke') {
      if (!finished) strokes[current - 1] = Math.min(strokes[current - 1] + 1, MAX_STROKES);
    } else if (a.kind === 'next_hole') {
      if (!finished) {
        if (current >= holes) finished = true;
        else current += 1;
      }
    } else if (a.kind === 'set') {
      if (Number.isInteger(a.hole) && a.hole >= 1 && a.hole <= holes && Number.isInteger(a.value)) {
        strokes[a.hole - 1] = Math.max(0, Math.min(a.value, MAX_STROKES));
      }
    }
  }
  const gross = strokes.reduce((s, v) => s + v, 0);
  return {
    strokes,
    currentHole: current,
    finished,
    holesPlayed: finished ? holes : current - 1,
    gross,
    net: gross - handicap,
  };
}

/** Ranks by net → gross → join order; ties share a rank. Mutates `rank` on each row and returns them ordered. */
export function rankPlayers(players) {
  const ordered = [...players].sort((a, b) => a.net - b.net || a.gross - b.gross || a.order - b.order);
  let rank = 0;
  let prev = null;
  ordered.forEach((p, i) => {
    const key = `${p.net}/${p.gross}`;
    if (key !== prev) {
      rank = i + 1;
      prev = key;
    }
    p.rank = rank;
  });
  return ordered;
}

export function validateHoles(value) {
  const holes = Number.parseInt(value, 10);
  if (!Number.isInteger(holes)) throw new RuleError('ホール数は整数で指定してください');
  if (holes < MIN_HOLES || holes > MAX_HOLES) throw new RuleError(`ホール数は ${MIN_HOLES}〜${MAX_HOLES} で指定してください`);
  return holes;
}

export function validateHandicap(value) {
  if (value === null || value === undefined || value === '') return 0;
  const handicap = Number.parseInt(value, 10);
  if (!Number.isInteger(handicap)) throw new RuleError('ハンデは整数で指定してください');
  if (handicap < -99 || handicap > 99) throw new RuleError('ハンデは -99〜99 で指定してください');
  return handicap;
}

/** Validates one action sent by the device. */
export function validateAction(raw, holes) {
  if (!raw || typeof raw !== 'object') throw new RuleError('操作の形式が不正です');
  const { seq, kind } = raw;
  if (!Number.isInteger(seq) || seq < 0) throw new RuleError('seq は 0 以上の整数で指定してください');
  if (!KINDS.includes(kind)) throw new RuleError(`kind は ${KINDS.join('/')} のいずれかです`);
  let hole = null;
  let value = null;
  if (kind === 'set') {
    hole = raw.hole;
    value = raw.value;
    if (!Number.isInteger(hole) || hole < 1 || hole > holes) throw new RuleError(`hole は 1〜${holes} で指定してください`);
    if (!Number.isInteger(value) || value < 0 || value > MAX_STROKES) throw new RuleError(`value は 0〜${MAX_STROKES} で指定してください`);
  }
  return { seq, kind, hole, value };
}
