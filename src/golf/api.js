/** Golf JSON API, mounted at /api/golf. Same paths and shapes as YURU's
 * golf/views.py minus the invite route. LINE login (LIFF) is required; the
 * action log can only be written by its owner, and finish / abort / delete
 * only by the round's creator. */
import express from 'express';
import { requireUser } from '../liff/auth.js';
import { apiErrorHandler, notFound, toInt } from '../liff/errors.js';
import * as store from './store.js';

export const golfApi = express.Router();
golfApi.use(express.json());
golfApi.use(requireUser);

const roundResponse = (res, view) => (view === null ? notFound(res) : res.json({ round: view }));
const id = (req) => toInt(req.params.id, -1);

golfApi.get('/rounds/active', (req, res) => {
  res.json({ rounds: store.listActiveRounds(req.user.userId) });
});

golfApi.get('/rounds', (req, res) => {
  const limit = Math.min(Math.max(toInt(req.query.limit, 50), 1), 200);
  const offset = Math.max(toInt(req.query.offset, 0), 0);
  res.json({ rounds: store.listRounds(limit, offset, req.user.userId), total: store.countRounds() });
});

golfApi.post('/rounds', (req, res) => {
  res.status(201).json({ round: store.createRound(req.body, req.user.userId, req.user.name) });
});

golfApi.get('/rounds/:id', (req, res) => {
  roundResponse(res, store.getRound(id(req), req.user.userId));
});

golfApi.delete('/rounds/:id', (req, res) => {
  if (!store.deleteRound(id(req), req.user.userId)) return notFound(res);
  return res.json({ ok: true });
});

golfApi.post('/rounds/:id/join', (req, res) => {
  roundResponse(res, store.joinRound(id(req), req.user.userId, req.user.name, req.body?.handicap));
});

golfApi.get('/rounds/:id/me/actions', (req, res) => {
  const actions = store.getMyActions(id(req), req.user.userId);
  if (actions === null) return notFound(res);
  return res.json({ actions });
});

golfApi.post('/rounds/:id/me/actions', (req, res) => {
  const result = store.syncActions(id(req), req.user.userId, req.body?.actions);
  if (result === null) return notFound(res);
  return res.json({ round: result.round, lastSeq: result.lastSeq });
});

golfApi.post('/rounds/:id/finish', (req, res) => {
  roundResponse(res, store.finishRound(id(req), req.user.userId));
});

golfApi.post('/rounds/:id/abort', (req, res) => {
  roundResponse(res, store.abortRound(id(req), req.user.userId));
});

golfApi.get('/stats', (req, res) => {
  res.json({ players: store.getPlayerStats() });
});

golfApi.use(apiErrorHandler);
