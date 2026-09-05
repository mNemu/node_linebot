/** Errors shared by the LIFF score pages' JSON APIs (molkky / golf / scoreboard).
 * Port of YURU's common/scorepage.py: each error carries the HTTP status the
 * API responds with, and apiErrorHandler turns them into { error } bodies. */

/** Bad input (400). */
export class RuleError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/** Operation not allowed in the current state (409), e.g. a throw after the game ended. */
export class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.status = 409;
  }
}

/** Not permitted for this user (403), e.g. writing someone else's golf log. */
export class ForbiddenError extends Error {
  constructor(message) {
    super(message);
    this.status = 403;
  }
}

/** Missing / expired LINE login (401). The page re-runs liff.login() on this. */
export class AuthError extends Error {
  constructor(message = 'ログインが必要です') {
    super(message);
    this.status = 401;
  }
}

export const notFound = (res) => res.status(404).json({ error: 'not found' });

export const toInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) ? n : fallback;
};

// eslint-disable-next-line no-unused-vars
export function apiErrorHandler(err, req, res, next) {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid json' });
  const status = Number.isInteger(err.status) ? err.status : 500;
  if (status >= 500) console.error('[api] error:', err);
  return res.status(status).json({ error: status >= 500 ? 'サーバーエラー' : err.message });
}
