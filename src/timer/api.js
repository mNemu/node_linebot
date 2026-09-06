/** Shared timer JSON API, mounted at /api/timer. Same shape as the scoreboard
 * API: every mutation responds with the full recomputed timer, errors are
 * { error } with the matching status. LINE login (LIFF) required, and every
 * logged-in user can see and operate every timer (no per-group scoping). */
import express from 'express';
import { requireUser } from '../liff/auth.js';
import { apiErrorHandler, notFound, toInt } from '../liff/errors.js';
import * as store from './store.js';

export const timerApi = express.Router();
timerApi.use(express.json());
timerApi.use(requireUser);

const timerResponse = (res, view, status = 200) => (view === null ? notFound(res) : res.status(status).json({ timer: view }));
const id = (req) => toInt(req.params.id, -1);

timerApi.get('/timers', (req, res) => {
  res.json({ timers: store.listTimers() });
});

timerApi.post('/timers', (req, res) => {
  const body = req.body ?? {};
  timerResponse(res, store.createTimer(body, req.user.userId), 201);
});

timerApi.get('/timers/:id', (req, res) => {
  timerResponse(res, store.getTimer(id(req)));
});

timerApi.delete('/timers/:id', (req, res) => {
  if (!store.deleteTimer(id(req))) return notFound(res);
  return res.json({ ok: true });
});

timerApi.post('/timers/:id/start', (req, res) => {
  timerResponse(res, store.startTimer(id(req)));
});

timerApi.post('/timers/:id/pause', (req, res) => {
  timerResponse(res, store.pauseTimer(id(req)));
});

timerApi.post('/timers/:id/reset', (req, res) => {
  timerResponse(res, store.resetTimer(id(req)));
});

timerApi.use(apiErrorHandler);
