/** Timer rules - pure functions, no DB access. Modeled on src/scoreboard/rules.js. */

import { RuleError } from '../liff/errors.js';

export { RuleError };

export const MAX_NAME_LENGTH = 40;
export const MAX_SET_NAME_LENGTH = 40;
export const KINDS = ['deadline', 'duration'];
export const MIN_DURATION_MS = 1000;
export const MAX_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

export function normalizeName(raw) {
  const name = String(raw ?? '').trim();
  if (!name) throw new RuleError('タイマー名を入力してください');
  if (name.length > MAX_NAME_LENGTH) throw new RuleError(`タイマー名は${MAX_NAME_LENGTH}文字以内にしてください`);
  return name;
}

export function normalizeSetName(raw) {
  const name = String(raw ?? '').trim();
  if (!name) throw new RuleError('セット名を入力してください');
  if (name.length > MAX_SET_NAME_LENGTH) throw new RuleError(`セット名は${MAX_SET_NAME_LENGTH}文字以内にしてください`);
  return name;
}

export function normalizeKind(raw) {
  if (!KINDS.includes(raw)) throw new RuleError('種類の指定が不正です');
  return raw;
}

export function normalizeTargetAt(raw) {
  const ms = typeof raw === 'string' || typeof raw === 'number' ? Date.parse(raw) : NaN;
  if (!Number.isFinite(ms)) throw new RuleError('日時の指定が不正です');
  return new Date(ms).toISOString();
}

export function normalizeDurationMs(raw) {
  const ms = typeof raw === 'string' ? Number(raw) : raw;
  if (!Number.isFinite(ms) || !Number.isInteger(ms)) throw new RuleError('時間の指定が不正です');
  if (ms < MIN_DURATION_MS || ms > MAX_DURATION_MS) {
    throw new RuleError('時間は1秒〜24時間の範囲で指定してください');
  }
  return ms;
}
