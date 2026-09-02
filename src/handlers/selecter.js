import { makeLINEPostInfo } from '../line/postInfo.js';
import { makeLINEClient } from '../line/client.js';
import { appendLog } from '../lib/db.js';
import { saveBinBlob } from '../google/drive.js';
import { makeMailMessage, addAttachmentsToMail } from '../google/mail.js';
import { config } from '../config.js';
import { dice } from './dice.js';
import { getRoute, doRoutes } from './route.js';
import { doSchedule } from '../google/calendar.js';
import { doAlbum } from '../google/drive.js';
import { doDiet } from './diet.js';
import { doCfg } from './cfg.js';
import { viewHelp } from './help.js';

const EXT_BY_TYPE = { image: 'jpg', video: 'mp4' };

/** Decides what (if anything) to reply when the bot is @-mentioned, and
 * sends the reply. Returns the sent text (or undefined) for logging -
 * mirrors LINE.gs/main.gs's sendMessage(). */
async function sendMessage(LPost) {
  const { dName, message, sname } = LPost;
  const mLength = message.toUpperCase().indexOf(config.selfName.toUpperCase());
  if (mLength < 0) return undefined;

  const arg = message.substr(mLength + config.selfName.length);
  let msg;
  const padded = ` ${arg} `;

  if (/^ *[^\d]\d{1,3}D\d{1,3}[^\d]/.test(padded)) {
    msg = dice(arg);
  } else if (/^.*から/.test(arg)) {
    msg = await getRoute(arg);
  } else if (/^ *経路/.test(arg)) {
    msg = doRoutes(arg);
  } else if (/^ *sch/.test(arg)) {
    msg = await doSchedule(arg, sname);
  } else if (/^ *alb/.test(arg)) {
    msg = await doAlbum(arg, sname);
  } else if (/^ *diet/.test(arg)) {
    msg = doDiet(arg);
  } else if (/^ *cfg/.test(arg)) {
    msg = doCfg(arg, sname);
  } else {
    msg = viewHelp();
  }

  if (msg !== undefined) {
    await LPost.replay(msg, `${dName}さん\n`);
  }
  return msg;
}

export async function selecter(jPost) {
  const LPost = await makeLINEPostInfo(jPost);
  let sendMsg;

  if (LPost.type === 'message' && LPost.mType === 'text') {
    sendMsg = await sendMessage(LPost);
  }

  const { sname, userId, dName, timestamp } = LPost;
  const nowDate = new Date();
  let logmsg = '';

  if (LPost.mType === 'text') {
    logmsg = LPost.message;
    await makeMailMessage(sname, `${dName}:\n ${LPost.message}`, timestamp);
  } else if (LPost.mType === 'sticker') {
    logmsg = JSON.stringify(LPost.keywords);
    await makeMailMessage(sname, `${dName}:\n スタンプ: ${LPost.keywords}`, timestamp);
  } else if (LPost.cType === 'line') {
    const id = LPost.mID;
    await makeMailMessage(sname, `${dName}:\n 添付(${id})`, timestamp);
    const content = await makeLINEClient().getContent(id);
    const ext = EXT_BY_TYPE[LPost.mType] ?? 'bin';
    const file = await saveBinBlob(content, `${sname.slice(0, 8)}_${id}`, ext, sname);
    logmsg = file.webViewLink;
    await addAttachmentsToMail(sname, file.id, `${id}.${ext}`);
  } else {
    logmsg = LPost.mType ?? String(LPost.type);
  }

  appendLog(sname, userId, dName, logmsg, JSON.stringify(LPost), nowDate.toISOString());
  if (sendMsg) {
    // sendMsg can be an array of Flex Message objects (e.g. from doSchedule) - stringify it for storage.
    const sendMsgText = typeof sendMsg === 'string' ? sendMsg : JSON.stringify(sendMsg);
    appendLog(sname, userId, dName, sendMsgText, 'BOT', nowDate.toISOString());
  }
}
