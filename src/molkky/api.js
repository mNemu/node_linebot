/** Mölkky JSON API, mounted at /api/molkky. Same paths and response shapes
 * as YURU's molkky/views.py (and gpsbot's /api/molkky before it), so the
 * page JS is a near-verbatim port. LINE login (LIFF) is required. */
import express from 'express';
import { requireUser } from '../liff/auth.js';
import { apiErrorHandler, notFound, toInt } from '../liff/errors.js';
import * as store from './store.js';

export const molkkyApi = express.Router();
molkkyApi.use(express.json());
molkkyApi.use(requireUser);

const gameResponse = (res, view) => (view === null ? notFound(res) : res.json({ game: view }));
const id = (req) => toInt(req.params.id, -1);

molkkyApi.get('/games/active', (req, res) => {
  res.json({ games: store.listActiveGames() });
});

molkkyApi.get('/games', (req, res) => {
  const limit = Math.min(Math.max(toInt(req.query.limit, 50), 1), 200);
  const offset = Math.max(toInt(req.query.offset, 0), 0);
  res.json({ games: store.listGames(limit, offset), total: store.countGames() });
});

molkkyApi.post('/games', (req, res) => {
  res.status(201).json({ game: store.createGame(req.body) });
});

molkkyApi.get('/games/:id', (req, res) => {
  gameResponse(res, store.getGame(id(req)));
});

molkkyApi.delete('/games/:id', (req, res) => {
  if (!store.deleteGame(id(req))) return notFound(res);
  return res.json({ ok: true });
});

molkkyApi.post('/games/:id/turns', (req, res) => {
  gameResponse(res, store.addTurn(id(req), req.body?.points));
});

molkkyApi.delete('/games/:id/turns/last', (req, res) => {
  gameResponse(res, store.undoLastTurn(id(req)));
});

molkkyApi.post('/games/:id/continue', (req, res) => {
  gameResponse(res, store.continueGame(id(req)));
});

molkkyApi.post('/games/:id/abort', (req, res) => {
  gameResponse(res, store.abortGame(id(req)));
});

molkkyApi.get('/stats', (req, res) => {
  res.json({ players: store.getPlayerStats() });
});

molkkyApi.get('/players', (req, res) => {
  res.json({ players: store.listPlayerNames() });
});

molkkyApi.use(apiErrorHandler);
