import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { middleware as lineMiddleware } from '@line/bot-sdk';
import { config } from './config.js';
import { selecter } from './handlers/selecter.js';
import { initScheduler } from './lib/scheduler.js';
import { startDailyScheduleCron } from './cron/dailySchedule.js';
import { scoreboardApi } from './scoreboard/api.js';
import { molkkyApi } from './molkky/api.js';
import { golfApi } from './golf/api.js';
import { meApi } from './liff/me.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

initScheduler();
startDailyScheduleCron();

const app = express();

app.get('/', (req, res) => {
  res.send('Hello, World!');
});

// Injects the registered LIFF app id into public/liff/index.html (see scripts/liff.js).
app.get('/liff/config.js', (req, res) => {
  res.type('application/javascript').send(`window.LIFF_ID = ${JSON.stringify(config.liffId ?? '')};`);
});
// JSON APIs for the LIFF score pages (public/liff/{molkky,golf,scoreboard}/).
// All require a LINE login via LIFF access token (src/liff/auth.js). Mounted
// before the LINE webhook so their express.json() never touches its raw body.
app.use('/api/me', meApi);
app.use('/api/molkky', molkkyApi);
app.use('/api/golf', golfApi);
app.use('/api/scoreboard', scoreboardApi);
app.use(express.static(path.join(__dirname, '..', 'public')));

app.post(
  '/webhook',
  lineMiddleware({ channelSecret: config.line.channelSecret }),
  async (req, res) => {
    // Ack immediately (mirrors GAS's doPost, which always replied 200 right
    // away) and process events afterwards so LINE doesn't retry on a slow
    // Sheets/Drive/Calendar call.
    res.status(200).json({ content: 'post ok' });
    for (const event of req.body.events) {
      try {
        await selecter(event);
      } catch (err) {
        console.error('[webhook] failed to handle event:', err);
      }
    }
  }
);

// Surfaces LINE signature-validation failures as 401 instead of crashing the process.
app.use((err, req, res, next) => {
  console.error('[webhook] middleware error:', err);
  res.status(401).end();
});

app.listen(config.port, () => {
  console.log(`LINE bot listening on port ${config.port}`);
});
