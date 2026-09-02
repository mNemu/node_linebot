import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
const db = new DatabaseSync(path.join(config.dataDir, 'linebot.sqlite'));

db.exec(`
  CREATE TABLE IF NOT EXISTS cfg (
    sname TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (sname, key)
  );
  CREATE TABLE IF NOT EXISTS log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    sname TEXT NOT NULL,
    user_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    message TEXT NOT NULL,
    raw TEXT NOT NULL
  );
`);

const stmts = {
  getCfg: db.prepare('SELECT value FROM cfg WHERE sname = ? AND key = ?'),
  setCfg: db.prepare(`
    INSERT INTO cfg (sname, key, value) VALUES (?, ?, ?)
    ON CONFLICT(sname, key) DO UPDATE SET value = excluded.value
  `),
  listCfg: db.prepare('SELECT key, value FROM cfg WHERE sname = ? ORDER BY key'),
  insertLog: db.prepare(`
    INSERT INTO log (ts, sname, user_id, display_name, message, raw)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  listSnames: db.prepare(`
    SELECT l.sname, l.display_name, l.ts
    FROM log l
    WHERE l.ts = (SELECT MAX(ts) FROM log WHERE sname = l.sname)
    ORDER BY l.ts DESC
  `),
};

/** Per-conversation (sname) config key/value store - replaces the old
 * per-sname Google Sheets tab used for Calendar id, Drive Folder id,
 * and mail digest settings (recipient/subject/replyTo/SenderName). */
export function getCfg(sname, key) {
  return stmts.getCfg.get(sname, key)?.value;
}

export function setCfg(sname, key, value) {
  stmts.setCfg.run(sname, key, value);
}

export function listCfg(sname) {
  return stmts.listCfg.all(sname);
}

/** Conversations (sname) seen so far, each with the display name and
 * timestamp of the last logged message - lets an admin find the right
 * sname without digging through raw LINE ids by hand. */
export function listSnames() {
  return stmts.listSnames.all();
}

/** Append-only chat log, one row per inbound/outbound message - replaces
 * the old per-sname Google Sheets tab used purely as a human-readable
 * audit trail (the bot never reads it back). */
export function appendLog(sname, userId, displayName, message, raw, ts = new Date().toISOString()) {
  stmts.insertLog.run(ts, sname, userId, displayName, message, raw);
}
