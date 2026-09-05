/* LIFF ログイン共通部品(モルック / ゴルフ / 得点ボードの各ページで読み込む)。
   - liff.init → 未ログインなら liff.login()(LINE 内なら自動、外部ブラウザは LINE ログインへ)
   - アクセストークンを Authorization: Bearer で API に付ける(サーバ側 src/liff/auth.js が検証)
   - 本人の表示名は LINE 名ではなく、/api/me に別途保存するニックネーム。未設定なら入力を促す
   - 圏外や SDK 読み込み失敗時は、前回の token / me を端末から使って表示を続ける(ゴルフ用) */
'use strict';

const LiffAuth = (() => {
  const TOKEN_KEY = 'liff.accessToken';
  const ME_KEY = 'liff.me';
  const MAX_NICK = 32;
  let token = '';
  let me = null;
  let offline = false;

  const load = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const save = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) {} };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const relogin = () => {
    save(TOKEN_KEY, null);
    if (typeof liff !== 'undefined' && navigator.onLine !== false) {
      try { liff.login({ redirectUri: location.href }); } catch (_) { location.reload(); }
    }
  };

  /* fetch ラッパー。JSON を返し、失敗は Error(message, status, offline) で投げる */
  const api = async (path, options = {}) => {
    let res;
    try {
      res = await fetch(path, {
        cache: 'no-store',
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.headers || {}),
        },
      });
    } catch (_) {
      offline = true;
      const err = new Error('通信できません(オフライン)');
      err.offline = true;
      throw err;
    }
    offline = false;
    let body = null;
    try { body = await res.json(); } catch (_) { body = null; }
    if (res.status === 401) {
      // トークン切れ。LINE ログインをやり直す(LINE 内なら一瞬で戻ってくる)
      setTimeout(relogin, 800);
      const err = new Error('ログインが切れました。ログインし直します');
      err.status = 401;
      throw err;
    }
    if (!res.ok) {
      const err = new Error((body && body.error) || `エラー (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return body;
  };

  const fetchMe = async () => {
    const { me: m } = await api('/api/me');
    me = m;
    save(ME_KEY, JSON.stringify(m));
    return m;
  };

  /** ログインを済ませて { me, offline } を返す。login にリダイレクトする場合は解決しない */
  const init = async () => {
    const cachedToken = load(TOKEN_KEY);
    let cachedMe = null;
    try { cachedMe = JSON.parse(load(ME_KEY) || 'null'); } catch (_) {}
    try {
      if (typeof liff === 'undefined') throw new Error('LIFF SDK を読み込めませんでした');
      await liff.init({ liffId: window.LIFF_ID });
      if (!liff.isLoggedIn()) {
        liff.login({ redirectUri: location.href });
        return new Promise(() => {}); // ページ遷移するのでここで止める
      }
      token = liff.getAccessToken() || '';
      save(TOKEN_KEY, token);
    } catch (err) {
      if (cachedToken && cachedMe) {
        token = cachedToken;
        me = cachedMe;
        offline = true;
        return { me, offline: true };
      }
      throw err;
    }
    try {
      await fetchMe();
    } catch (err) {
      if (err.offline && cachedMe) { me = cachedMe; return { me, offline: true }; }
      throw err;
    }
    return { me, offline: false };
  };

  const setNickname = async (name) => {
    const { me: m } = await api('/api/me', { method: 'PUT', body: JSON.stringify({ name }) });
    me = m;
    save(ME_KEY, JSON.stringify(m));
    return m;
  };

  /* ニックネーム欄。未設定なら注意書き付きで入力を促し、設定済みなら変更欄を出す。
     保存後はページの window.onNicknameChanged(me) を呼ぶ(再描画用)。 */
  const nicknameCard = () => {
    if (!me) return '';
    const has = Boolean(me.name);
    return `
      <div class="card nick-card${has ? '' : ' warn'}">
        <div class="card-title">${has ? 'ニックネーム' : 'ニックネームが未設定です'}</div>
        ${has
          ? `<div class="nick-now">現在: <span>${esc(me.name)}</span></div>`
          : '<div class="hint" style="margin-top:0;margin-bottom:8px">参加者として記録するにはニックネームが必要です。LINE の名前は使いません。</div>'}
        <div class="input-row">
          <input type="text" id="nick-input" placeholder="${has ? '変更するニックネーム' : 'ニックネームを入力'}" maxlength="${MAX_NICK}" autocomplete="off" enterkeyhint="done">
          <button class="btn-sm btn-accent" onclick="LiffAuth.saveNickname()">${has ? '変更' : '保存'}</button>
        </div>
      </div>`;
  };
  const bindNickname = () => {
    const input = document.getElementById('nick-input');
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveNickname(); } });
  };
  const saveNickname = async () => {
    const input = document.getElementById('nick-input');
    const value = (input ? input.value : '').trim();
    const notify = (msg) => (typeof toast === 'function' ? toast(msg) : alert(msg));
    if (!value) { notify('ニックネームを入力してください'); return; }
    if (value.length > MAX_NICK) { notify(`ニックネームは${MAX_NICK}文字以内にしてください`); return; }
    try {
      await setNickname(value);
      notify(`ニックネームを「${value}」にしました`);
      if (typeof window.onNicknameChanged === 'function') window.onNicknameChanged(me);
    } catch (err) {
      notify(err.message);
    }
  };

  return {
    init,
    api,
    setNickname,
    nicknameCard,
    bindNickname,
    saveNickname,
    get me() { return me; },
    get name() { return me ? me.name || '' : ''; },
    get offline() { return offline; },
    set offline(v) { offline = v; },
  };
})();
