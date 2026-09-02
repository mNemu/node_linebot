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

function usage() {
  console.error(
    'Usage:\n' +
      '  node scripts/liff.js list                    - list LIFF apps on this channel\n' +
      '  node scripts/liff.js create <url>             - register a new LIFF app pointing at <url>\n' +
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
  const { liffId } = await api('POST', '', {
    view: { type: 'full', url: arg },
    description: 'linebot menu (dice/diet input forms)',
    scope: ['chat_message.write'],
  });
  console.log(`created ${liffId}`);
  console.log(`entry point: https://liff.line.me/${liffId}`);
  console.log(`Set LIFF_ID=${liffId} in .env, restart the bot, then re-run scripts/richmenu.js.`);
} else if (cmd === 'delete') {
  if (!arg) usage();
  await api('DELETE', `/${arg}`);
  console.log(`deleted ${arg}`);
} else {
  usage();
}
