/** Timer JSON API, mounted at /api/timer. Same shape as the scoreboard API:
 * every mutation responds with the full recomputed resource, errors are
 * { error } with the matching status. LINE login (LIFF) required.
 *
 * Timers live inside a "set" a user owns; a set is visible to its owner
 * always, and to everyone else once the owner shares it. Anyone who can see
 * a set can create/operate/delete the timers inside it. */
import express from 'express';
import { requireUser } from '../liff/auth.js';
import { apiErrorHandler, notFound, toInt } from '../liff/errors.js';
import * as store from './store.js';

export const timerApi = express.Router();
timerApi.use(express.json());
timerApi.use(requireUser);

const setResponse = (res, view, status = 200) => (view === null ? notFound(res) : res.status(status).json({ set: view }));
const timerResponse = (res, view, status = 200) => (view === null ? notFound(res) : res.status(status).json({ timer: view }));
const id = (req) => toInt(req.params.id, -1);
const setId = (req) => toInt(req.params.setId, -1);

timerApi.get('/sets', (req, res) => {
  res.json({ sets: store.listVisibleSets(req.user.userId) });
});

timerApi.post('/sets', (req, res) => {
  const body = req.body ?? {};
  setResponse(res, store.createSet(body.name, body.shared, req.user.userId), 201);
});

timerApi.patch('/sets/:id', (req, res) => {
  const body = req.body ?? {};
  setResponse(res, store.updateSet(id(req), req.user.userId, { name: body.name, shared: body.shared }));
});

timerApi.delete('/sets/:id', (req, res) => {
  if (!store.deleteSet(id(req), req.user.userId)) return notFound(res);
  return res.json({ ok: true });
});

timerApi.get('/sets/:setId/timers', (req, res) => {
  const timers = store.listTimersInSet(setId(req), req.user.userId);
  if (timers === null) return notFound(res);
  return res.json({ timers });
});

timerApi.post('/sets/:setId/timers', (req, res) => {
  const body = req.body ?? {};
  timerResponse(res, store.createTimer(setId(req), body, req.user.userId), 201);
});

timerApi.delete('/timers/:id', (req, res) => {
  if (!store.deleteTimer(id(req), req.user.userId)) return notFound(res);
  return res.json({ ok: true });
});

timerApi.post('/timers/:id/start', (req, res) => {
  timerResponse(res, store.startTimer(id(req), req.user.userId));
});

timerApi.post('/timers/:id/pause', (req, res) => {
  timerResponse(res, store.pauseTimer(id(req), req.user.userId));
});

timerApi.post('/timers/:id/reset', (req, res) => {
  timerResponse(res, store.resetTimer(id(req), req.user.userId));
});

timerApi.use(apiErrorHandler);
