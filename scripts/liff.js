// Manages the LIFF (LINE Front-end Framework) app that backs
// public/liff/index.html - the dice/diet input forms opened from the rich
// menu. Uses LINE's LIFF server API (https://developers.line.biz/en/reference/liff-server/)
// with the channel access token, so no manual console step is needed.
import { config } from '../src/config.js';

const API = 'https://api.line.me/liff/v1/apps';

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${config.line.channelAccessToken}`, ...extra };
}

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : undefined;
}

// The LIFF app hosts the dice/diet forms (index.html) and the score pages
// (molkky/, golf/, scoreboard/) under the same endpoint. `profile` lets the
// score pages' server verify who is logged in (src/liff/auth.js).
const appSettings = (url) => ({
  view: { type: 'full', url },
  description: 'linebot menu (dice/diet forms, molkky/golf/score pages)',
  scope: ['profile', 'chat_message.write'],
});

function usage() {
  console.error(
    'Usage:\n' +
      '  node scripts/liff.js list                    - list LIFF apps on this channel\n' +
      '  node scripts/liff.js create <url>             - register a new LIFF app pointing at <url>\n' +
      '  node scripts/liff.js update <liffId> <url>    - re-apply scopes/endpoint to an existing app\n' +
      '  node scripts/liff.js delete <liffId>          - remove a LIFF app\n'
  );
  process.exit(1);
}

const [, , cmd, arg] = process.argv;

if (cmd === 'list') {
  const { apps } = await api('GET', '');
  if (apps.length === 0) console.log('(no LIFF apps)');
  for (const a of apps) console.log(`${a.liffId}\t${a.view.url}\thttps://liff.line.me/${a.liffId}`);
} else if (cmd === 'create') {
  if (!arg) usage();
  const { liffId } = await api('POST', '', appSettings(arg));
  console.log(`created ${liffId}`);
  console.log(`entry point: https://liff.line.me/${liffId}`);
  console.log(`Set LIFF_ID=${liffId} in .env, restart the bot, then re-run scripts/richmenu.js.`);
} else if (cmd === 'update') {
  // Re-applies the current settings (scopes, endpoint) to an existing app,
  // e.g. after the `profile` scope was added for the score pages' LINE login.
  if (!arg) usage();
  const url = process.argv[4];
  if (!url) usage();
  await api('PUT', `/${arg}`, appSettings(url));
  console.log(`updated ${arg} -> ${url}`);
} else if (cmd === 'delete') {
  if (!arg) usage();
  await api('DELETE', `/${arg}`);
  console.log(`deleted ${arg}`);
} else {
  usage();
}
