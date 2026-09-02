// Lists digest mails currently queued (src/lib/scheduler.js persists pending
// jobs to DATA_DIR/triggers.json, so this can be read without hitting the
// running process).
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { getCfg } from '../src/lib/db.js';

const FILE = path.join(config.dataDir, 'triggers.json');

let jobs = {};
try {
  jobs = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch {
  jobs = {};
}

const pending = Object.values(jobs).filter((job) => job.type === 'sendDigestMail');

if (pending.length === 0) {
  console.log('送信待ちのメールはありません。');
} else {
  for (const job of pending) {
    const { sname } = job.payload;
    const recipient = getCfg(sname, 'recipient') ?? '(recipient未設定)';
    const subject = getCfg(sname, 'subject') ?? '(no subject)';
    const eta = new Date(job.runAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    console.log(`${sname}\t${recipient}\t"${subject}"\t送信予定: ${eta}`);
  }
}
