/** Generic score board JSON API, mounted at /api/scoreboard. Same shape as
 * the molkky API: every mutation responds with the full recomputed board,
 * errors are { error } with the matching status. LINE login (LIFF) required. */
import express from 'express';
import { requireUser } from '../liff/auth.js';
import { apiErrorHandler, notFound, toInt } from '../liff/errors.js';
import * as store from './store.js';

export const scoreboardApi = express.Router();
scoreboardApi.use(express.json());
scoreboardApi.use(requireUser);

const boardResponse = (res, view, status = 200) => (view === null ? notFound(res) : res.status(status).json({ board: view }));
const id = (req) => toInt(req.params.id, -1);

scoreboardApi.get('/boards/active', (req, res) => {
  res.json({ boards: store.listActiveBoards() });
});

scoreboardApi.get('/boards', (req, res) => {
  const limit = Math.min(Math.max(toInt(req.query.limit, 50), 1), 200);
  res.json({ boards: store.listEndedBoards(limit) });
});

scoreboardApi.post('/boards', (req, res) => {
  const body = req.body ?? {};
  boardResponse(res, store.createBoard({ title: body.title, players: body.players }), 201);
});

scoreboardApi.get('/boards/:id', (req, res) => {
  boardResponse(res, store.getBoard(id(req)));
});

scoreboardApi.delete('/boards/:id', (req, res) => {
  if (!store.deleteBoard(id(req))) return notFound(res);
  return res.json({ ok: true });
});

scoreboardApi.post('/boards/:id/players', (req, res) => {
  boardResponse(res, store.addPlayer(id(req), req.body?.name));
});

scoreboardApi.post('/boards/:id/turns', (req, res) => {
  boardResponse(res, store.addTurn(id(req), req.body?.playerIndex, req.body?.points));
});

scoreboardApi.delete('/boards/:id/turns/last', (req, res) => {
  boardResponse(res, store.undoLastTurn(id(req)));
});

scoreboardApi.post('/boards/:id/finish', (req, res) => {
  boardResponse(res, store.finishBoard(id(req)));
});

scoreboardApi.post('/boards/:id/abort', (req, res) => {
  boardResponse(res, store.abortBoard(id(req)));
});

scoreboardApi.get('/players', (req, res) => {
  res.json({ players: store.listPlayerNames() });
});

scoreboardApi.get('/stats', (req, res) => {
  res.json({ players: store.playerStats() });
});

scoreboardApi.use(apiErrorHandler);
