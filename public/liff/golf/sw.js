/* ゴルフ得点記録ページ用 Service Worker(scope: /liff/golf/)。YURU の golf-sw.js の移植。
   ゴルフ場は圏外になりやすいので、ページ本体と静的ファイルを network-first、
   失敗時はキャッシュで返し、電波がなくてもページを開き直せるようにする。
   API(/api/...)はキャッシュせず常にネットワークに流す(golf.js 側で端末に溜めて同期する)。
   ※ LINE アプリ内ブラウザ(特に iOS)では Service Worker が動かないため、圏外に備えるなら
     Chrome / Safari で開く(golf.js の案内を参照)。 */
'use strict';

const CACHE = 'golf-shell-v1';
// 初回訪問でも圏外で開き直せるよう、インストール時にページ本体と静的ファイルを先読みしておく
const SHELL = [
  '/liff/golf/',
  '/liff/golf/golf.js',
  '/liff/score.css',
  '/liff/bg.svg',
  '/liff/liffauth.js',
  '/liff/config.js',
  'https://static.line-scdn.net/liff/edge/2/sdk.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.ok || res.type === 'opaque') await cache.put(url, res);
      } catch (_) { /* 先読みに失敗しても登録は続ける */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('golf-shell-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

const isShellRequest = (url) => {
  if (url.origin === self.location.origin) {
    if (url.pathname === '/liff/golf/' || url.pathname === '/liff/golf' || url.pathname === '/liff/golf/index.html') return true;
    return /^\/liff\/(golf\/golf\.js|score\.css|bg\.svg|liffauth\.js|config\.js)$/.test(url.pathname);
  }
  return url.href.startsWith('https://static.line-scdn.net/liff/');
};

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (!isShellRequest(url)) return; // API 等はそのままネットワークへ
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(event.request);
      if (res.ok || res.type === 'opaque') cache.put(event.request, res.clone());
      return res;
    } catch (_) {
      // ページは #round=… やクエリ付きで開かれることもあるので、クエリを無視して先読み分を返す
      const cached = await cache.match(event.request, { ignoreSearch: true });
      if (cached) return cached;
      return new Response('オフラインのため表示できません。電波の届く所で開き直してください。',
        { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
