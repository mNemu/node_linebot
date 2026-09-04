// Server-side CLI for the per-conversation config (Calendar/mail digest
// settings) that used to be managed via a LINE `cfg` command; now set from a
// shell on the box instead.
import { getCfg, setCfg, listCfg, listSnames } from '../src/lib/db.js';

const KEYS = ['Calendar', 'recipient', 'subject', 'replyTo', 'SenderName'];

function usage() {
  console.error(
    'Usage:\n' +
      '  node scripts/cfg.js snames                        - list known conversations (sname + last sender)\n' +
      '  node scripts/cfg.js list <sname>                   - list config for a conversation\n' +
      '  node scripts/cfg.js get <sname> <key>               - show one config value\n' +
      '  node scripts/cfg.js set <sname> <key> <value...>    - set one config value\n' +
      `Keys: ${KEYS.join(', ')}`
  );
  process.exit(1);
}

const [, , cmd, ...args] = process.argv;

if (cmd === 'snames') {
  const rows = listSnames();
  if (rows.length === 0) console.log('(no conversations logged yet)');
  for (const r of rows) console.log(`${r.sname}\t${r.display_name}\t(last: ${r.ts})`);
} else if (cmd === 'list') {
  const [sname] = args;
  if (!sname) usage();
  const rows = listCfg(sname);
  if (rows.length === 0) console.log('(no config set)');
  for (const r of rows) console.log(`${r.key} = ${r.value}`);
} else if (cmd === 'get') {
  const [sname, key] = args;
  if (!sname || !key) usage();
  const value = getCfg(sname, key);
  console.log(value !== undefined ? value : '(not set)');
} else if (cmd === 'set') {
  const [sname, key, ...valueParts] = args;
  const value = valueParts.join(' ');
  if (!sname || !key || !value) usage();
  if (!KEYS.includes(key)) {
    console.error(`Unknown key "${key}". Known keys: ${KEYS.join(', ')}`);
    process.exit(1);
  }
  setCfg(sname, key, value);
  console.log(`${key} = ${value}`);
} else {
  usage();
}
