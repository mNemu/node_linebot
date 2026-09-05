/** LINE login for the LIFF score pages.
 *
 * The page obtains a LIFF access token (liff.getAccessToken()) and sends it as
 * `Authorization: Bearer <token>`. We verify it with LINE and read the user's
 * profile, caching the result per token for a few minutes so every tap on the
 * page doesn't round-trip to LINE. Identity is the LINE userId. The name shown
 * on the score pages is NOT the LINE display name but a nickname the user sets
 * separately (stored here, keyed by userId - the equivalent of YURU's site
 * nickname). Until it is set, `name` is empty and the pages ask for it before
 * letting the user join anything.
 *
 * For local development, LIFF_DEV_AUTH=1 additionally accepts tokens of the
 * form `dev:<userId>` without contacting LINE. Never enable it in production. */
import NodeCache from 'node-cache';
import { db } from '../lib/db.js';
import { config } from '../config.js';
import { AuthError, RuleError } from './errors.js';

const VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';
const PROFILE_URL = 'https://api.line.me/v2/profile';
const MAX_NICKNAME = 32;

const profileCache = new NodeCache({ stdTTL: 10 * 60, checkperiod: 120 });

db.exec(`
  CREATE TABLE IF NOT EXISTS liff_nickname (
    lineid TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);
const stmts = {
  get: db.prepare('SELECT name FROM liff_nickname WHERE lineid = ?'),
  set: db.prepare(`
    INSERT INTO liff_nickname (lineid, name, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(lineid) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
  `),
  del: db.prepare('DELETE FROM liff_nickname WHERE lineid = ?'),
};

export function getNickname(lineid) {
  return stmts.get.get(lineid)?.name ?? '';
}

/** Sets (or, with an empty name, clears) the nickname shown on the score pages. */
export function setNickname(lineid, rawName) {
  const name = String(rawName ?? '').trim();
  if (name.length > MAX_NICKNAME) throw new RuleError(`ニックネームは${MAX_NICKNAME}文字以内にしてください`);
  if (name) stmts.set.run(lineid, name, new Date().toISOString());
  else stmts.del.run(lineid);
  return name;
}

async function fetchLineProfile(token) {
  const verify = await fetch(`${VERIFY_URL}?access_token=${encodeURIComponent(token)}`);
  if (!verify.ok) throw new AuthError();
  const res = await fetch(PROFILE_URL, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new AuthError();
  const { userId, displayName } = await res.json();
  if (!userId) throw new AuthError();
  return { userId, displayName: displayName || userId };
}

/** Resolves a LIFF access token to { userId, displayName, name }; `name` is the
 * nickname set on the score pages, or '' if the user hasn't set one yet. */
export async function resolveUser(token) {
  if (!token) throw new AuthError();
  let profile = profileCache.get(token);
  if (!profile) {
    if (config.liffDevAuth && token.startsWith('dev:')) {
      const userId = token.slice(4);
      profile = { userId, displayName: `dev ${userId}` };
    } else {
      profile = await fetchLineProfile(token);
    }
    profileCache.set(token, profile);
  }
  return { ...profile, name: getNickname(profile.userId) };
}

const bearer = (req) => {
  const header = req.get('Authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
};

/** Express middleware: requires a valid LINE login and sets req.user. */
export function requireUser(req, res, next) {
  resolveUser(bearer(req))
    .then((user) => {
      req.user = user;
      next();
    })
    .catch(next);
}
