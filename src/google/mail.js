import nodemailer from 'nodemailer';
import { getCfg } from '../lib/db.js';
import { makeKeyCache } from '../lib/cache.js';
import { schedule, cancel, registerHandler } from '../lib/scheduler.js';
import { config } from '../config.js';
import { google } from 'googleapis';
import { getAuthClient } from './auth.js';

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

let driveApi;
async function drive() {
  if (!driveApi) driveApi = google.drive({ version: 'v3', auth: await getAuthClient() });
  return driveApi;
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
    msginfo = { message: [[timestamp, message]], fileids: [] };
  }

  msginfo.jobId = schedule('sendDigestMail', { sname }, DIGEST_DELAY_MS);
  cmsginfo.put(msginfo, MSGINFO_TTL_SEC);
}

/** Attaches a Drive file id to the pending digest mail for this conversation. */
export async function addAttachmentsToMail(sname, fileId, filename) {
  const { recipient } = await getRecipientConfig(sname);
  if (!recipient) return 0;

  const cmsginfo = makeKeyCache(`${sname}_msginfo`);
  const msginfo = cmsginfo.get();
  if (!msginfo) return 0;
  msginfo.fileids.push([fileId, filename]);
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

  await sendMail({ recipient, subject, replyTo, senderName, fileids: msginfo.fileids }, body);
}
registerHandler('sendDigestMail', sendDigestMail);

export async function sendLineMessageToMail(sname, dName, text) {
  const { recipient, subject, replyTo, senderName } = await getRecipientConfig(sname);
  if (!recipient) return;
  await sendMail({ recipient, subject, replyTo, senderName }, `${dName}:\n${text}`);
}

/** Sends the digest, inlining small attachments (<=2MB total) and otherwise
 * falling back to a shared Drive link, mirroring mail.gs's sendMail(). */
export async function sendMail({ recipient, subject, replyTo, senderName, fileids }, body) {
  const attachments = [];
  let finalBody = body;

  if (fileids && fileids.length > 0) {
    const driveClient = await drive();
    let totalSize = 0;
    const sizes = await Promise.all(
      fileids.map(async ([fileId]) => {
        const res = await driveClient.files.get({ fileId, fields: 'size' });
        return Number(res.data.size ?? 0);
      })
    );
    totalSize = sizes.reduce((a, b) => a + b, 0);

    for (const [fileId, filename] of fileids) {
      if (totalSize <= 2_000_000) {
        const res = await driveClient.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
        attachments.push({ filename, content: Buffer.from(res.data) });
      } else {
        await driveClient.permissions.create({
          fileId,
          requestBody: { role: 'reader', type: 'anyone' },
        });
        const meta = await driveClient.files.get({ fileId, fields: 'webContentLink' });
        finalBody += `\n添付:${filename}\n ${meta.data.webContentLink}`;
      }
    }
  }

  await getTransporter().sendMail({
    from: senderName ? `"${senderName}" <${config.mail.from}>` : config.mail.from,
    to: recipient,
    replyTo: replyTo || undefined,
    subject: subject || '(no subject)',
    text: finalBody,
    attachments,
  });
}
