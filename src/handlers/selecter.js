import { makeLINEPostInfo } from '../line/postInfo.js';
import { appendLog } from '../lib/db.js';
import { makeMailMessage, makeMailMessageWithAttachments } from '../google/mail.js';
import { config } from '../config.js';
import { dice } from './dice.js';
import { doDiet } from './diet.js';
import { viewHelp } from './help.js';

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.once('end', () => resolve(Buffer.concat(chunks)));
    stream.once('error', reject);
  });
}

function extensionFromContentType(contentType) {
  switch ((contentType || '').toLowerCase()) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    default:
      return 'bin';
  }
}

/** Decides what (if anything) to reply when the bot is @-mentioned, and
 * sends the reply. Returns the sent text (or undefined) for logging -
 * mirrors LINE.gs/main.gs's sendMessage(). */
async function sendMessage(LPost) {
  const { dName, message } = LPost;
  const mLength = message.toUpperCase().indexOf(config.selfName.toUpperCase());
  if (mLength < 0) return undefined;

  const arg = message.substr(mLength + config.selfName.length);
  let msg;
  const padded = ` ${arg} `;

  if (/^ *[^\d]\d{1,3}D\d{1,3}[^\d]/.test(padded)) {
    msg = dice(arg);
  } else if (/^ *diet/.test(arg)) {
    msg = doDiet(arg);
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
  } else if (LPost.cType === 'line' && LPost.mType === 'image') {
    const { stream, contentType } = await LPost.getContent();
    const id = LPost.mID;
    logmsg = `${LPost.mType}(${id})`;
    const content = await streamToBuffer(stream);
    const ext = extensionFromContentType(contentType);
    await makeMailMessageWithAttachments(
      sname,
      `${dName}:\n 画像を添付しました (${id})`,
      timestamp,
      [
        {
          filename: `line-image-${id}.${ext}`,
          content,
          contentType,
        },
      ]
    );
  } else if (LPost.cType === 'line') {
    const id = LPost.mID;
    logmsg = `${LPost.mType}(${id})`;
    await makeMailMessage(sname, `${dName}:\n 添付(${id})`, timestamp);
  } else {
    logmsg = LPost.mType ?? String(LPost.type);
  }

  appendLog(sname, userId, dName, logmsg, JSON.stringify(LPost), nowDate.toISOString());
  if (sendMsg) {
    // sendMsg can be an array of Flex Message objects (dice/diet reply with one) - stringify it for storage.
    const sendMsgText = typeof sendMsg === 'string' ? sendMsg : JSON.stringify(sendMsg);
    appendLog(sname, userId, dName, sendMsgText, 'BOT', nowDate.toISOString());
  }
}
