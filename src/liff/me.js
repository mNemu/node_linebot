/** /api/me - who the LINE-logged-in viewer is, and their nickname on the score pages. */
import express from 'express';
import { requireUser, setNickname } from './auth.js';
import { apiErrorHandler } from './errors.js';

export const meApi = express.Router();
meApi.use(express.json());
meApi.use(requireUser);

const view = (user) => ({ userId: user.userId, lineName: user.displayName, name: user.name });

meApi.get('/', (req, res) => {
  res.json({ me: view(req.user) });
});

/** PUT { name } - set the nickname shown on the score pages (empty clears it). */
meApi.put('/', (req, res) => {
  const name = setNickname(req.user.userId, req.body?.name);
  res.json({ me: view({ ...req.user, name }) });
});

meApi.use(apiErrorHandler);
