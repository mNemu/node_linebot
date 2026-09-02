import cron from 'node-cron';
import { doSchedule } from '../google/calendar.js';
import { makeLINEClient } from '../line/client.js';
import { config } from '../config.js';

const DIFF_DAYS = 5;

/** Pushes the flex-message schedule for "5 days from now" to DAILY_SCHEDULE_TARGET.
 * Ported from Calendar.gs's triger_DaySchedule(), which computed this but never
 * actually sent it (its push calls were commented out) - wired up here so the
 * feature does what its name says. */
export async function runDailySchedule() {
  if (!config.dailyScheduleTarget) return;

  const postDate = new Date();
  postDate.setDate(postDate.getDate() + DIFF_DAYS);
  const dateArg = `${postDate.getMonth() + 1}/${postDate.getDate()}`;

  const messages = await doSchedule(`sch view ${dateArg}`, config.dailyScheduleTarget);
  if (!messages || messages.length === 0) return;
  await makeLINEClient().pushFlex(config.dailyScheduleTarget, messages);
}

export function startDailyScheduleCron() {
  // Every day at 08:00 JST.
  cron.schedule('0 8 * * *', () => {
    runDailySchedule().catch((err) => console.error('[dailySchedule] failed:', err));
  }, { timezone: 'Asia/Tokyo' });
}
