// Manages the LINE Rich Menu (the tappable button grid shown above the chat
// keyboard). Each button just sends a preset "@BOT ..." text message, so it
// reuses all the existing command handling in src/handlers/ - no webhook
// changes needed. Run with a real CHANNEL_ACCESS_TOKEN in .env.
import fs from 'node:fs';
import { config } from '../src/config.js';

const API = 'https://api.line.me/v2/bot/richmenu';
const API_DATA = 'https://api-data.line.me/v2/bot/richmenu';

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${config.line.channelAccessToken}`, ...extra };
}

async function api(method, path, { headers, body } = {}) {
  const res = await fetch(`${API}${path}`, { method, headers: authHeaders(headers), body });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : undefined;
}

// Matches assets/richmenu.png (source: assets/richmenu.svg): a 2500x1124,
// 3x2 grid of buttons.
//   row 1: サイコロ / ダイエット (LIFF input forms, public/liff/index.html), メニュー (help)
//   row 2: モルック / ゴルフ / 得点ボード (LIFF score pages, LINE login)
// No more fixed dice-roll shortcut buttons (2D6/1D100/1D20) - サイコロ opens
// the input form instead. The score pages are sub-paths of the LIFF
// endpoint, opened as https://liff.line.me/<liffId>/<page>/ so LIFF login
// is available.
function layout() {
  if (!config.liffId) {
    throw new Error('LIFF_ID is not set - run `node scripts/liff.js create <url>` first, then set it in .env.');
  }
  const liffUrl = (view) => `https://liff.line.me/${config.liffId}?view=${view}`;
  const liffPage = (page) => `https://liff.line.me/${config.liffId}/${page}/`;
  const W = 833;
  const H = 562;
  const cell = (col, row, action) => ({
    bounds: { x: col * W, y: row * H, width: col === 2 ? 834 : W, height: H },
    action,
  });

  return {
    size: { width: 2500, height: 1124 },
    selected: true,
    name: 'main-menu',
    chatBarText: 'メニュー',
    areas: [
      cell(0, 0, { type: 'uri', uri: liffUrl('dice') }),
      cell(1, 0, { type: 'uri', uri: liffUrl('diet') }),
      cell(2, 0, { type: 'message', text: '@BOT' }),
      cell(0, 1, { type: 'uri', uri: liffPage('molkky') }),
      cell(1, 1, { type: 'uri', uri: liffPage('golf') }),
      cell(2, 1, { type: 'uri', uri: liffPage('scoreboard') }),
    ],
  };
}

function usage() {
  console.error(
    'Usage:\n' +
      '  node scripts/richmenu.js list                         - list existing rich menus\n' +
      '  node scripts/richmenu.js create-and-set <image.png>    - create LAYOUT, upload image, set as default for all users\n' +
      '  node scripts/richmenu.js delete <richMenuId>            - delete a rich menu\n'
  );
  process.exit(1);
}

const [, , cmd, arg] = process.argv;

if (cmd === 'list') {
  const { richmenus } = await api('GET', '/list');
  if (richmenus.length === 0) console.log('(no rich menus)');
  for (const m of richmenus) console.log(`${m.richMenuId}\t${m.name}\t${m.size.width}x${m.size.height}`);
} else if (cmd === 'create-and-set') {
  if (!arg) usage();
  const image = fs.readFileSync(arg);
  const { richMenuId } = await api('POST', '', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(layout()),
  });
  console.log(`created ${richMenuId}, uploading image...`);
  await fetch(`${API_DATA}/${richMenuId}/content`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'image/png' }),
    body: image,
  }).then(async (res) => {
    if (!res.ok) throw new Error(`upload image -> ${res.status} ${await res.text()}`);
  });
  await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, {
    method: 'POST',
    headers: authHeaders(),
  }).then(async (res) => {
    if (!res.ok) throw new Error(`set default -> ${res.status} ${await res.text()}`);
  });
  console.log(`${richMenuId} is now the default rich menu for all users.`);
} else if (cmd === 'delete') {
  if (!arg) usage();
  await api('DELETE', `/${arg}`);
  console.log(`deleted ${arg}`);
} else {
  usage();
}
