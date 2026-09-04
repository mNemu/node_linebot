import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { middleware as lineMiddleware } from '@line/bot-sdk';
import { config } from './config.js';
import { selecter } from './handlers/selecter.js';
import { initScheduler } from './lib/scheduler.js';
import { startDailyScheduleCron } from './cron/dailySchedule.js';
import { scoreboardApi } from './scoreboard/api.js';

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
// Score board JSON API (page itself is static under public/scoreboard/).
// Mounted before the LINE webhook so its express.json() never touches the
// webhook's raw body.
app.use('/scoreboard/api', scoreboardApi);
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
