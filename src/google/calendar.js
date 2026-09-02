import { google } from 'googleapis';
import { getAuthClient } from './auth.js';
import { getCfg } from '../lib/db.js';
import moment from '../lib/moment.js';
import { makeFlexSchedule } from '../line/flexSchedule.js';

const TIME_ZONE = 'Asia/Tokyo';
const UNDECIDED_MARKER_DATE = '2019-01-01';

let calendarApi;
async function api() {
  if (!calendarApi) {
    calendarApi = google.calendar({ version: 'v3', auth: await getAuthClient() });
  }
  return calendarApi;
}

/** Recognises "10月4日の12時半" / "3/1 10:00" style Japanese date phrases in
 * free text and returns the moment they refer to (year defaults to now),
 * or undefined if nothing looks like an event. Ported from Calendar.gs's
 * isEvent(); kept as a standalone utility - the original wiring of this
 * into the main message handler never actually created anything (it set
 * an undeclared global and referenced an undefined `name`), so that dead
 * branch was not carried over. See README for details.
 */
export function isEvent(description) {
  const desc = description.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0));
  const regdate = /\d{1,2}月\d{1,2}日|\d{1,2}\/\d{1,2} \d{1,2}:\d{1,2}|\d{1,2}\/\d{1,2}.[月火水木金土日祝]./;
  const madate = desc.match(regdate);
  if (madate == null) return undefined;

  const str = desc.substr(desc.indexOf(madate[0]) + madate[0].length, 10).replace('半', '30分');
  const regtime = /\d{1,2}時\d{1,2}分|\d{1,2}時半{0,1}|\d{1,2}:\d{2}/;
  const times = String(madate).match(/\d{1,2}/g);
  const matime = String(str).match(regtime);
  if (matime != null) times.push(...String(matime).match(/\d{1,2}/g));
  times.push(0, 0);

  const edate = moment();
  edate.month(Number(times[0]) - 1);
  edate.date(Number(times[1]) || 0);
  edate.hours(Number(times[2]) || 0);
  edate.minutes(Number(times[3]) || 0);
  return edate;
}

export async function createCalendar(name) {
  const calendar = await api();
  const res = await calendar.calendars.insert({
    requestBody: { summary: name, timeZone: TIME_ZONE },
  });
  return res.data; // { id, summary, ... }
}

function toDetail(ev) {
  return {
    id: ev.id,
    title: ev.summary ?? '',
    description: ev.description ?? '',
    start: moment(ev.start?.dateTime ?? ev.start?.date),
    end: moment(ev.end?.dateTime ?? ev.end?.date),
  };
}

class CalendarHandle {
  constructor(calendarId) {
    this.calendarId = calendarId;
  }

  async getEvents(startTime, endTime) {
    const calendar = await api();
    const res = await calendar.events.list({
      calendarId: this.calendarId,
      timeMin: startTime.toISOString(),
      timeMax: endTime.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });
    return (res.data.items ?? []).map(toDetail);
  }

  async getEventsForDay(date) {
    const start = moment(date).startOf('day');
    const end = start.clone().add(1, 'day');
    return this.getEvents(start.toDate(), end.toDate());
  }

  async getEventById(id) {
    const calendar = await api();
    try {
      const res = await calendar.events.get({ calendarId: this.calendarId, eventId: id });
      return toDetail(res.data);
    } catch {
      return null;
    }
  }

  async createEvent(title, startTime, endTime, options = {}) {
    const calendar = await api();
    const res = await calendar.events.insert({
      calendarId: this.calendarId,
      requestBody: {
        summary: title,
        description: options.description,
        start: { dateTime: startTime.toISOString(), timeZone: TIME_ZONE },
        end: { dateTime: endTime.toISOString(), timeZone: TIME_ZONE },
      },
    });
    return toDetail(res.data);
  }
}

export async function getCalendarById(id) {
  if (!id) return null;
  const calendar = await api();
  try {
    await calendar.calendars.get({ calendarId: id });
    return new CalendarHandle(id);
  } catch {
    return null;
  }
}

/** If `date` has already passed this year, roll it forward to next year - mirrors Calendar.gs's AdjustDate. */
export function AdjustDate(date) {
  const today = new Date();
  if (today > date) {
    return new Date(date.getFullYear() + 1, date.getMonth(), date.getDate());
  }
  return date;
}

async function getCalendarForSname(sname) {
  const calId = getCfg(sname, 'Calendar');
  return getCalendarById(calId);
}

export async function doSchedule(key, sname) {
  const padded = ` ${key} `;

  if (/^ *sch +view +\d{1,2}\/\d{1,2}[^\d]/.test(padded)) {
    const parts = key.replace(/^\s+/, '').split(/\s+/);
    return viewSchedule(sname, parts[2]);
  }
  if (/^ *sch *view +Unde/.test(padded)) {
    return viewSchedule(sname, 'Undecided');
  }
  if (/^ *sch *view +detail +/.test(padded)) {
    const parts = key.replace(/^\s+/, '').split(/\s+/);
    return viewSchedule(sname, 'detail', parts[3]);
  }
  if (/^ *sch *view/.test(padded)) {
    return viewSchedule(sname);
  }
  if (/^ *sch +set +Unde/.test(padded)) {
    const lines = key.replace(/^\s+/, '').split(/\n/);
    const head = lines[0].split(/\s+/);
    const body = `${head.slice(3).join(' ')}\n${lines.slice(1).join('\n')}`;
    return setUndecided(sname, body);
  }
  if (/^ *sch +set +\d{1,2}\/\d{1,2}[^\d]/.test(padded)) {
    const lines = key.replace(/^\s+/, '').split(/\n/);
    const head = lines[0].split(/\s+/);
    const dateArg = head[2];
    const body = `${head.slice(3).join(' ')}\n${lines.slice(1).join('\n')}`;
    return setSchedule(sname, dateArg, body);
  }

  return (
    'sch view  -> 先160日の予定を表示します。\n' +
    'sch view Unde  -> 日付未定の詳細予定を表示します。\n' +
    'sch view m/d  -> m月d日の詳細予定を表示します。\n' +
    'sch set Unde title -> 日付未定の予定を設定します。\n' +
    'sch set m/d[-HH:MM][~m/d[-HH:MM]] title -> m月d日[HH時MM分(省略可)]の予定を設定します。'
  );
}

export async function setUndecided(sname, body) {
  const calendar = await getCalendarForSname(sname);
  const startTime = new Date(`${UNDECIDED_MARKER_DATE}T00:00:00`);
  const endTime = new Date(`${UNDECIDED_MARKER_DATE}T00:00:00`);
  endTime.setDate(endTime.getDate() + 1);
  const lines = body.split('\n');
  const title = lines[0];
  await calendar.createEvent(title, startTime, endTime, { description: lines.slice(1).join('\n') });
  return viewSchedule(sname, 'Undecided');
}

export async function setSchedule(sname, date, body) {
  const calendar = await getCalendarForSname(sname);
  const dary = date.split('~');
  const year = new Date().getFullYear();
  const startTime = new Date(`${year}/${dary[0].replace('-', ' ')}`);
  const lines = body.split('\n');
  const title = lines[0];

  let endTime;
  if (!dary[1]) {
    endTime = new Date(startTime);
    endTime.setDate(endTime.getDate() + 1);
  } else if (/-/.test(dary[1])) {
    endTime = new Date(`${year}/${dary[1].replace('-', ' ')}`);
  } else if (/:/.test(dary[1])) {
    endTime = new Date(`${year}/${dary[0].split('-')[0]} ${dary[1]}`);
  } else if (/\//.test(dary[1])) {
    endTime = new Date(`${year}/${dary[1]}`);
    endTime.setDate(endTime.getDate() + 1);
  }

  await calendar.createEvent(title, AdjustDate(startTime), AdjustDate(endTime), {
    description: lines.slice(1).join('\n'),
  });
  return viewSchedule(sname, dary[0].split('-')[0]);
}

export async function viewSchedule(sname, date, schid) {
  const calendar = await getCalendarForSname(sname);
  const today = new Date();

  let events = [];
  let undecideds = [];
  if (date === undefined) {
    const startTime = today;
    const endTime = new Date(startTime.getTime() + 160 * 24 * 60 * 60 * 1000);
    undecideds = await calendar.getEventsForDay(new Date(`${UNDECIDED_MARKER_DATE}T00:00:00`));
    events = await calendar.getEvents(startTime, endTime);
  } else if (date === 'Undecided') {
    undecideds = await calendar.getEventsForDay(new Date(`${UNDECIDED_MARKER_DATE}T00:00:00`));
  } else if (date === 'detail') {
    const ev = await calendar.getEventById(schid);
    events = ev ? [ev] : [];
  } else {
    const tday = AdjustDate(new Date(`${today.getFullYear()}/${date}`));
    events = await calendar.getEventsForDay(tday);
  }

  const flexMessage = makeFlexSchedule();
  flexMessage.altText('GPSスケジュール');
  flexMessage.addLink(
    'GPSスケジュール',
    'https://calendar.google.com/calendar/embed?src=v4j7gc74ehrc4daa1b1goqh4to@group.calendar.google.com'
  );
  flexMessage.addSeparator();

  for (const ev of events) {
    const diffHours = ev.end.diff(ev.start, 'm') / 60;
    const tStart = diffHours % 24 === 0 ? ev.start.format('MM/DD(ddd)') : ev.start.format('MM/DD(ddd) HH:mm');
    flexMessage.addSchedule(tStart, `${diffHours}h`, ev.title, `@BOT sch view detail ${ev.id}`);
    if (date === 'detail' && ev.description !== '') {
      flexMessage.addMemo(ev.description);
    }
  }
  flexMessage.addSeparator();

  undecideds.forEach((ev, i) => {
    if (i === 0) flexMessage.addMemo('日程未定:');
    flexMessage.addActMessage(ev.title, `@BOT sch view detail ${ev.id}`);
  });

  return flexMessage.messages();
}
