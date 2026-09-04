import nodemailer from 'nodemailer';
import { getCfg } from '../lib/db.js';
import { makeKeyCache } from '../lib/cache.js';
import { schedule, cancel, registerHandler } from '../lib/scheduler.js';
import { config } from '../config.js';

const DIGEST_DELAY_MS = 10 * 60 * 1000;
const MSGINFO_TTL_SEC = 30 * 60;

let transporter;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: { user: config.mail.user, pass: config.mail.pass },
    });
  }
  return transporter;
}

async function getRecipientConfig(sname) {
  return {
    recipient: getCfg(sname, 'recipient'),
    subject: getCfg(sname, 'subject'),
    replyTo: getCfg(sname, 'replyTo'),
    senderName: getCfg(sname, 'SenderName'),
  };
}

/** Queues a LINE text message into a per-conversation digest mail that fires
 * DIGEST_DELAY_MS after the *last* message received - re-arriving messages
 * push the timer back, same debounce behaviour as mail.gs's makeMailMessage
 * (which cancelled and recreated a GAS time trigger). */
export async function makeMailMessage(sname, message, timestamp) {
  const { recipient } = await getRecipientConfig(sname);
  if (!recipient) return 0;

  const cmsginfo = makeKeyCache(`${sname}_msginfo`);
  let msginfo = cmsginfo.get();
  if (msginfo) {
    cancel(msginfo.jobId);
    msginfo.message.push([timestamp, message]);
  } else {
    msginfo = { message: [[timestamp, message]] };
  }

  msginfo.jobId = schedule('sendDigestMail', { sname }, DIGEST_DELAY_MS);
  cmsginfo.put(msginfo, MSGINFO_TTL_SEC);
}

async function sendDigestMail({ sname }) {
  const cmsginfo = makeKeyCache(`${sname}_msginfo`);
  const msginfo = cmsginfo.get();
  cmsginfo.remove();
  if (!msginfo) return;

  const { recipient, subject, replyTo, senderName } = await getRecipientConfig(sname);
  if (!recipient) return;

  const body = msginfo.message
    .slice()
    .sort((a, b) => (a[0] > b[0] ? 1 : a[0] < b[0] ? -1 : 0))
    .map((item) => item[1])
    .join('\n');

  await sendMail({ recipient, subject, replyTo, senderName }, body);
}
registerHandler('sendDigestMail', sendDigestMail);

export async function sendLineMessageToMail(sname, dName, text) {
  const { recipient, subject, replyTo, senderName } = await getRecipientConfig(sname);
  if (!recipient) return;
  await sendMail({ recipient, subject, replyTo, senderName }, `${dName}:\n${text}`);
}

/** Sends the digest mail. Mirrors mail.gs's sendMail() minus the Drive
 * attachment handling, which was removed along with the image/video
 * auto-save feature. */
export async function sendMail({ recipient, subject, replyTo, senderName }, body) {
  await getTransporter().sendMail({
    from: senderName ? `"${senderName}" <${config.mail.from}>` : config.mail.from,
    to: recipient,
    replyTo: replyTo || undefined,
    subject: subject || '(no subject)',
    text: body,
  });
}
