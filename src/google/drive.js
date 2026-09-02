import { google } from 'googleapis';
import { getAuthClient } from './auth.js';
import { getCfg } from '../lib/db.js';
import { makeCache, makeKeyCache } from '../lib/cache.js';
import { config } from '../config.js';
import moment from '../lib/moment.js';

let driveApi;
async function api() {
  if (!driveApi) {
    driveApi = google.drive({ version: 'v3', auth: await getAuthClient() });
  }
  return driveApi;
}

export async function getFolderid(sname) {
  return getCfg(sname, 'Folder');
}

/** Saves a binary attachment (image/video/etc) into the conversation's
 * currently-set "album" folder, falling back to its configured Drive folder,
 * then to the global DRIVE_BASE_FOLDER_ID. Mirrors common.gs's saveBinBlob.
 * `content` is a Readable stream (e.g. from the LINE client's getContent()). */
export async function saveBinBlob(content, id, ext, sname) {
  const cache = makeCache();
  let folderId = cache.get(`${sname}_Album`);
  folderId = folderId || (await getFolderid(sname));
  folderId = folderId || config.drive.baseFolderId;

  const drive = await api();
  const res = await drive.files.create({
    requestBody: { name: `${id}.${ext}`, parents: [folderId] },
    media: { body: content },
    fields: 'id, name, webViewLink',
  });
  return res.data; // { id, name, webViewLink }
}

async function findChildFolder(parentId, name) {
  const drive = await api();
  const q = `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and name='${name.replace(/'/g, "\\'")}' and trashed=false`;
  const res = await drive.files.list({ q, fields: 'files(id, name, webViewLink)' });
  return res.data.files?.[0];
}

async function createChildFolder(parentId, name) {
  const drive = await api();
  const res = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id, name, webViewLink',
  });
  return res.data;
}

export async function listAlbum(sname) {
  const folderId = await getFolderid(sname);
  const drive = await api();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(name)',
  });
  return (res.data.files ?? []).map((f) => f.name).join('\n') + (res.data.files?.length ? '\n' : '');
}

export async function setAlbum(sname, name) {
  const folderName = name || moment().format('YYYY-MM-DD');
  const folderId = await getFolderid(sname);
  const folder = (await findChildFolder(folderId, folderName)) ?? (await createChildFolder(folderId, folderName));
  makeKeyCache(`${sname}_Album`, folder.id, 30 * 60);
  return folder;
}

export async function getAlbumUrl(sname, name) {
  const folderId = await getFolderid(sname);
  const folder = await findChildFolder(folderId, name);
  return folder ? folder.webViewLink : '対象が見当たりません。';
}

export function unsetAlbum(sname) {
  makeKeyCache(`${sname}_Album`).remove();
}

export async function doAlbum(key, sname) {
  const padded = ` ${key} `;
  if (/^ *alb *list/.test(padded)) {
    const list = await listAlbum(sname);
    return `以下のアルバムがあります。\n${list}`;
  }
  if (/^ *alb *url /.test(padded)) {
    const parts = key.replace(/^\s+/, '').split(/\s+/);
    const name = parts[2];
    if (!name) return 'nameの指定は必須です。';
    return getAlbumUrl(sname, name);
  }
  if (/^ *alb *set/.test(padded)) {
    const parts = key.replace(/^\s+/, '').split(/\s+/);
    const folder = await setAlbum(sname, parts[2]);
    return (
      `${folder.name}をアルバムとしてセットしました。\n以降30分以内に送られた画像/動画は ` +
      `${folder.name}にアップされます。\n${folder.webViewLink}`
    );
  }
  if (/^ *alb *unset/.test(padded)) {
    unsetAlbum(sname);
    return 'アルバム設定を解除しました。';
  }
  return (
    'alb list  -> 一覧を表示する。\n' +
    'alb url name  -> 指定されたアルバムのRULを表示する。\n' +
    'alb set [name]  -> アップロード先をセットする。(名前を省略した場合、YYYY-MM-DD)\n' +
    'alb unset -> アルバム設定を明示的に未設定にする。\n'
  );
}
