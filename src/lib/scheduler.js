import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';

// Replaces GAS's ScriptApp.newTrigger(...).timeBased().after(ms).create() /
// ScriptApp.deleteTrigger(id): a small file-backed delayed-job queue.
// Jobs are persisted to disk so a pending job (e.g. "send the digest mail in
// 10 minutes") survives a process restart - on boot, overdue jobs run
// immediately and future ones get a fresh setTimeout.

const FILE = path.join(config.dataDir, 'triggers.json');
const handlers = new Map();
const timers = new Map();
let jobs = {};

function load() {
  try {
    jobs = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    jobs = {};
  }
}

function persist() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(jobs, null, 2));
}

async function run(id) {
  const job = jobs[id];
  if (!job) return;
  delete jobs[id];
  timers.delete(id);
  persist();
  const handler = handlers.get(job.type);
  if (!handler) {
    console.warn(`[scheduler] no handler registered for job type "${job.type}"`);
    return;
  }
  try {
    await handler(job.payload, id);
  } catch (err) {
    console.error(`[scheduler] job ${id} (${job.type}) failed:`, err);
  }
}

function arm(id) {
  const job = jobs[id];
  const delay = Math.max(0, job.runAt - Date.now());
  const timer = setTimeout(() => run(id), delay);
  timer.unref?.();
  timers.set(id, timer);
}

/** Register the function that handles jobs of a given type. Call before init(). */
export function registerHandler(type, fn) {
  handlers.set(type, fn);
}

/** Load persisted jobs and (re)arm their timers. Call once at startup. */
export function initScheduler() {
  load();
  for (const id of Object.keys(jobs)) arm(id);
}

/** Schedule `payload` to be handled after `delayMs`. Returns the job id. */
export function schedule(type, payload, delayMs) {
  const id = crypto.randomUUID();
  jobs[id] = { type, payload, runAt: Date.now() + delayMs };
  persist();
  arm(id);
  return id;
}

/** Cancel a previously scheduled job, if still pending. */
export function cancel(id) {
  if (!id || !jobs[id]) return;
  clearTimeout(timers.get(id));
  timers.delete(id);
  delete jobs[id];
  persist();
}
