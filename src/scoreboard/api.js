/** JSON API for the score board page (public/scoreboard/), mounted at
 * /scoreboard/api. Same shape as YURU's molkky API: every board mutation
 * responds with the full recomputed board, errors are { error } with the
 * matching HTTP status (400 bad input / 404 / 409 wrong state).
 *
 * There is no login - the page only knows a self-chosen nickname - so access
 * is optionally gated by a shared key (SCOREBOARD_KEY): when set, requests
 * must carry it as the X-Board-Key header (the page picks it up from a
 * ?key= link once and remembers it). */
import express from 'express';
import { config } from '../config.js';
import * as store from './store.js';

export const scoreboardApi = express.Router();

scoreboardApi.use(express.json());

scoreboardApi.use((req, res, next) => {
  const expected = config.scoreboard.key;
  if (!expected) return next();
  const given = req.get('X-Board-Key') ?? req.query.key;
  if (given !== expected) return res.status(403).json({ error: 'アクセスキーが違います' });
  return next();
});

const boardResponse = (res, view, status = 200) =>
  view === null ? res.status(404).json({ error: 'ボードが見つかりません' }) : res.status(status).json({ board: view });

const boardId = (req) => Number(req.params.id);

scoreboardApi.get('/boards/active', (req, res) => {
  res.json({ boards: store.listActiveBoards() });
});

scoreboardApi.get('/boards', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  res.json({ boards: store.listEndedBoards(limit) });
});

scoreboardApi.post('/boards', (req, res) => {
  const body = req.body ?? {};
  boardResponse(res, store.createBoard({ title: body.title, players: body.players }), 201);
});

scoreboardApi.get('/boards/:id', (req, res) => {
  boardResponse(res, store.getBoard(boardId(req)));
});

scoreboardApi.delete('/boards/:id', (req, res) => {
  if (!store.deleteBoard(boardId(req))) return res.status(404).json({ error: 'ボードが見つかりません' });
  return res.json({ ok: true });
});

scoreboardApi.post('/boards/:id/players', (req, res) => {
  boardResponse(res, store.addPlayer(boardId(req), req.body?.name));
});

scoreboardApi.post('/boards/:id/turns', (req, res) => {
  boardResponse(res, store.addTurn(boardId(req), req.body?.playerIndex, req.body?.points));
});

scoreboardApi.delete('/boards/:id/turns/last', (req, res) => {
  boardResponse(res, store.undoLastTurn(boardId(req)));
});

scoreboardApi.post('/boards/:id/finish', (req, res) => {
  boardResponse(res, store.finishBoard(boardId(req)));
});

scoreboardApi.post('/boards/:id/abort', (req, res) => {
  boardResponse(res, store.abortBoard(boardId(req)));
});

scoreboardApi.get('/players', (req, res) => {
  res.json({ players: store.listPlayerNames() });
});

scoreboardApi.get('/stats', (req, res) => {
  res.json({ players: store.playerStats() });
});

// RuleError / ConflictError carry their HTTP status; anything else is a 500.
// eslint-disable-next-line no-unused-vars
scoreboardApi.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSONの形式が不正です' });
  const status = Number.isInteger(err.status) ? err.status : 500;
  if (status >= 500) console.error('[scoreboard] api error:', err);
  return res.status(status).json({ error: status >= 500 ? 'サーバーエラー' : err.message });
});
