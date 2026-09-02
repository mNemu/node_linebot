import { getCfg, setCfg, listCfg } from '../lib/db.js';

const KEYS = ['Calendar', 'Folder', 'recipient', 'subject', 'replyTo', 'SenderName'];

/** Per-conversation config, previously hand-edited in a Google Sheet -
 * now set via LINE commands, e.g. `@BOT cfg set recipient foo@example.com`. */
export function doCfg(key, sname) {
  const padded = ` ${key} `;

  if (/^ *cfg *list/.test(padded)) {
    const rows = listCfg(sname);
    if (rows.length === 0) return '設定はまだありません。';
    return rows.map((r) => `${r.key} = ${r.value}`).join('\n');
  }

  if (/^ *cfg *get +/.test(padded)) {
    const parts = key.replace(/^\s+/, '').split(/\s+/);
    const name = parts[2];
    if (!KEYS.includes(name)) return `未対応のキーです。対応キー: ${KEYS.join(', ')}`;
    const value = getCfg(sname, name);
    return value ? `${name} = ${value}` : `${name} は未設定です。`;
  }

  if (/^ *cfg *set +/.test(padded)) {
    const parts = key.replace(/^\s+/, '').split(/\s+/);
    const name = parts[2];
    const value = parts.slice(3).join(' ');
    if (!KEYS.includes(name)) return `未対応のキーです。対応キー: ${KEYS.join(', ')}`;
    if (!value) return '値の指定は必須です。';
    setCfg(sname, name, value);
    return `${name} を設定しました。`;
  }

  return (
    'cfg list -> このトークの設定を一覧表示します。\n' +
    'cfg get キー -> 設定値を表示します。\n' +
    'cfg set キー 値 -> 設定値を変更します。\n' +
    `対応キー: ${KEYS.join(', ')}`
  );
}
