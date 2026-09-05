/* ゴルフ得点記録ページ。YURU の static/js/golf.js の移植(招待URLの参加者限定ラウンドは省略)。
   各自が自分の打数を「+1打」「次のホール」で入力する。操作は端末の localStorage に
   追記専用ログとして保存し、画面はそのログから即座に計算して更新する(サーバ応答を待たない)。
   未送信分は電波が戻ったときにまとめて /api/golf/rounds/<id>/me/actions に送る。
   サーバは受理済みの seq を無視するので、何度再送しても二重計上されない。
   状態計算は src/golf/rules.js と同じロジック(computePlayer)。
   ログインは LIFF(/liff/liffauth.js)。圏外で開き直したときは前回の token / me を端末から使う。 */
'use strict';

/* ─── 共通 ─── */
const API = '/api/golf';
const HANDICAP_KEY = 'golf.handicap';
const roundKey = (id) => `golf.round.${id}`;
let MY_NAME = '';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer = null;
const toast = (msg, ms = 2200) => {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
};

let online = navigator.onLine !== false;
let lastFetchAt = null;

const api = async (path, options = {}) => {
  try {
    const body = await LiffAuth.api(API + path, options);
    online = true;
    lastFetchAt = Date.now();
    return body;
  } catch (err) {
    if (err.offline) online = false;
    throw err;
  }
};

const fmtDate = (ms) => {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const ago = (ms) => {
  if (!ms) return '未取得';
  const sec = Math.round((Date.now() - ms) / 1000);
  if (sec < 10) return 'たった今';
  if (sec < 60) return `${sec}秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)}分前`;
  return `${Math.floor(sec / 3600)}時間前`;
};

const showTab = (name) => {
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.add('active');
  document.getElementById(`tabbtn-${name}`).classList.add('active');
  if (name === 'history') loadHistory();
  if (name === 'stats') loadStats();
};

/* ─── LINE アプリ内ブラウザ向けの案内 ─── */
// LINE 内で開いた場合、ページを閉じなければ圏外でも入力できるが、閉じて開き直すには通信が要る
// (iOS の LINE 内ブラウザは Service Worker も使えない)。圏外に備えるなら Chrome / Safari で開くよう案内する。
const EXT_NOTICE_KEY = 'golf.extNoticeDismissed';
const isLineInAppBrowser = () => /\bLine\/[\d.]+/i.test(navigator.userAgent);
const externalUrl = () => `${location.origin}${location.pathname}`;
const externalNotice = () => {
  let dismissed = false;
  try { dismissed = localStorage.getItem(EXT_NOTICE_KEY) === '1'; } catch (_) {}
  if (!isLineInAppBrowser() || dismissed) return '';
  const url = externalUrl();
  return `
    <div class="notice ext-notice">
      <div class="ext-title">📱 圏外に備えるなら Chrome / Safari で開いてください</div>
      LINE の中でも、このページを閉じなければ圏外で入力を続けられます。ただし閉じてしまうと、開き直すのに通信が必要です。
      Chrome や Safari で開いておけば、圏外でも開き直せます(LINE ログインを一度通せば次からは不要です)。
      <div class="ext-actions">
        <a class="btn-sm btn-green" href="${esc(url)}?openExternalBrowser=1" target="_blank" rel="noopener">外部ブラウザで開く</a>
        <button class="btn-sm btn-light" onclick="copyExternalUrl(this)">URLをコピー</button>
        <button class="btn-sm btn-light" onclick="dismissExternalNotice()">閉じる</button>
      </div>
      <div class="ext-sub">開かない場合は右上のメニューから「他のブラウザで開く」を選ぶか、コピーした URL を Chrome / Safari に貼り付けてください。</div>
    </div>`;
};
const copyText = (text, btn) => {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => { btn.textContent = 'コピーしました'; })
      .catch(() => { prompt('この URL をコピーしてください', text); });
  } else {
    prompt('この URL をコピーしてください', text);
  }
};
const copyExternalUrl = (btn) => copyText(externalUrl(), btn);
const dismissExternalNotice = () => {
  try { localStorage.setItem(EXT_NOTICE_KEY, '1'); } catch (_) {}
  render();
};

/* ─── ルール(src/golf/rules.js と同じ) ─── */
const MAX_STROKES = 99;
const effectiveActions = (actions) => {
  const stack = [];
  for (const a of actions) {
    if (a.kind === 'undo') { if (stack.length) stack.pop(); } else stack.push(a);
  }
  return stack;
};
const computePlayer = (actions, holes, handicap = 0) => {
  const strokes = Array(holes).fill(0);
  let current = 1;
  let finished = false;
  for (const a of effectiveActions(actions)) {
    if (a.kind === 'stroke') {
      if (!finished) strokes[current - 1] = Math.min(strokes[current - 1] + 1, MAX_STROKES);
    } else if (a.kind === 'next_hole') {
      if (!finished) { if (current >= holes) finished = true; else current += 1; }
    } else if (a.kind === 'set') {
      if (Number.isInteger(a.hole) && a.hole >= 1 && a.hole <= holes && Number.isInteger(a.value)) {
        strokes[a.hole - 1] = Math.max(0, Math.min(a.value, MAX_STROKES));
      }
    }
  }
  const gross = strokes.reduce((s, v) => s + v, 0);
  return { strokes, currentHole: current, finished, holesPlayed: finished ? holes : current - 1, gross, net: gross - handicap };
};

/* ─── 端末側のログ ─── */
// { actions: [{seq, kind, hole?, value?}], syncedSeq: n, round }  この端末が本人の記録端末のときだけ存在する
const loadLocal = (id) => {
  try { return JSON.parse(localStorage.getItem(roundKey(id)) || 'null'); } catch (_) { return null; }
};
const saveLocal = (id, data) => {
  try { localStorage.setItem(roundKey(id), JSON.stringify(data)); } catch (_) { toast('端末に保存できませんでした'); }
};
const dropLocal = (id) => { try { localStorage.removeItem(roundKey(id)); } catch (_) {} };
const savedHandicap = () => { try { return parseInt(localStorage.getItem(HANDICAP_KEY), 10) || 0; } catch (_) { return 0; } };
const rememberHandicap = (h) => { try { localStorage.setItem(HANDICAP_KEY, String(h)); } catch (_) {} };

/* ─── 状態 ─── */
let view = 'loading';    // lobby | create | round | finished
let round = null;        // 表示中のラウンド(サーバから返る計算済み状態)
let local = null;        // 表示中のラウンドでの自分の端末ログ
let activeRounds = [];
let busy = false;
let syncing = false;

const root = () => document.getElementById('game-root');
const me = () => (round ? round.players.find((p) => p.isMe) : null);
const pending = () => (local ? local.actions.filter((a) => a.seq > local.syncedSeq) : []);
const myState = () => {
  const p = me();
  if (!p) return null;
  return local ? computePlayer(local.actions, round.holes, p.handicap) : p;
};
const roundLabel = (r) => r.title || `ラウンド ${r.id}`;

const render = () => {
  if (view === 'lobby') renderLobby();
  else if (view === 'create') renderCreate();
  else if (view === 'round') renderRound();
  else if (view === 'finished') renderFinished();
  else root().innerHTML = '<div class="empty">読み込み中…</div>';
  LiffAuth.bindNickname();
};
window.onNicknameChanged = (m) => { MY_NAME = String(m.name || '').trim(); render(); };

const syncBadge = () => {
  const n = pending().length;
  if (n > 0 && !online) return `<span class="sync offline">オフライン・未送信 ${n}件</span>`;
  if (n > 0) return `<span class="sync pending">${syncing ? '送信中…' : `未送信 ${n}件`}</span>`;
  if (!online) return '<span class="sync offline">オフライン</span>';
  return '<span class="sync">同期済み</span>';
};
const updateBadge = () => {
  const el = document.getElementById('sync-badge');
  if (el) el.outerHTML = `<span id="sync-badge">${syncBadge()}</span>`;
};

/* ─── ロビー ─── */
const renderLobby = () => {
  root().innerHTML = `
    ${externalNotice()}
    ${MY_NAME ? '' : LiffAuth.nicknameCard()}
    <div class="card">
      <div class="card-title">進行中のラウンド(${activeRounds.length})</div>
      ${activeRounds.length === 0 ? '<div class="empty">進行中のラウンドはありません</div>' : activeRounds.map((r) => `
        <div class="game-item" onclick="openRound(${r.id})">
          <div class="top"><span>${fmtDate(r.startedAt)} 開始</span><span class="badge" style="margin-left:0">${r.holes}H</span><span>${r.players.length}人${r.joined ? '・参加中' : ''}</span></div>
          <div class="win">${esc(roundLabel(r))}</div>
          <div class="sum">${r.players.map((p) => `${esc(p.name)} ${p.finished ? `${p.gross}(終)` : `H${p.currentHole}`}`).join(' ／ ')}</div>
        </div>`).join('')}
    </div>
    ${MY_NAME ? '<button class="btn-primary" onclick="view = \'create\'; render()">＋ 新しいラウンド</button>' : '<div class="hint" style="text-align:center">ニックネームを設定するとラウンドを作成・参加できます。</div>'}
    <div class="hint" style="text-align:center">ラウンドの作成・参加は電波のある所で済ませてください。<br>その後の入力は圏外でも端末に保存され、電波が戻ると自動で送信されます。</div>
    ${!online ? `<div class="offline-note" style="text-align:center">現在オフラインです。一覧は最後に取得した内容です(${ago(lastFetchAt)})。</div>` : ''}
    ${MY_NAME ? LiffAuth.nicknameCard() : ''}
  `;
};

const goHome = () => {
  round = null;
  local = null;
  view = 'lobby';
  setRoundHash(null);
  render();
  loadActive();
};
const setRoundHash = (id) => {
  try { history.replaceState(null, '', id ? `#round=${id}` : location.pathname + location.search); } catch (_) {}
};

/* ─── 作成 ─── */
const renderCreate = () => {
  root().innerHTML = `
    <div class="card">
      <div class="card-title">新しいラウンド</div>
      <div class="form-row"><label>ラウンド名(任意)</label><input type="text" id="title-input" placeholder="例: ○○ショート 9/5" maxlength="40"></div>
      <div class="form-row"><label>ホール数</label>
        <div class="seg" id="holes-seg">
          ${[9, 18].map((h) => `<button class="${h === 9 ? 'on' : ''}" data-h="${h}" onclick="pickHoles(${h})">${h}H</button>`).join('')}
          <button data-h="0" onclick="pickHoles(0)">その他</button>
        </div>
        <input type="number" id="holes-input" min="1" max="36" value="9" inputmode="numeric" style="margin-top:8px;display:none">
      </div>
      <div class="form-row"><label>あなたのハンデ(ネット = グロス − ハンデ)</label><input type="number" id="hc-input" value="${savedHandicap()}" inputmode="numeric"></div>
      <div class="hint">作成した人は自動で参加します。他の人は一覧からこのラウンドを開いて「参加」してください。</div>
    </div>
    <button class="btn-primary" onclick="createRound()">ラウンド開始</button>
    <button class="btn-secondary" onclick="goHome()">‹ 一覧へ</button>
  `;
};
const pickHoles = (h) => {
  document.querySelectorAll('#holes-seg button').forEach((b) => b.classList.toggle('on', Number(b.dataset.h) === h));
  const input = document.getElementById('holes-input');
  input.style.display = h === 0 ? '' : 'none';
  if (h !== 0) input.value = h;
  else input.focus();
};
const createRound = async () => {
  if (busy) return;
  const holes = parseInt(document.getElementById('holes-input').value, 10);
  const handicap = parseInt(document.getElementById('hc-input').value, 10) || 0;
  const title = document.getElementById('title-input').value;
  if (!Number.isInteger(holes) || holes < 1 || holes > 36) { toast('ホール数は 1〜36 で指定してください'); return; }
  busy = true;
  try {
    const { round: r } = await api('/rounds', { method: 'POST', body: JSON.stringify({ title, holes, handicap }) });
    rememberHandicap(handicap);
    startRecording(r, []);
    toast('他の人は一覧からこのラウンドを開いて「参加」できます', 3000);
  } catch (err) {
    toast(err.message);
  } finally {
    busy = false;
  }
};

/* ─── ラウンドを開く・参加する ─── */
const openRound = async (id) => {
  try {
    const { round: r } = await api(`/rounds/${id}`);
    showRound(r);
  } catch (err) {
    // オフラインでも、この端末で記録中のラウンドなら端末のログで開ける
    const cached = loadLocal(id);
    if (err.offline && cached && cached.round) {
      toast('オフラインのため端末に保存した内容で表示します');
      showRound(cached.round);
      return;
    }
    toast(err.message);
    if (view === 'loading') view = 'lobby';
    loadActive();
  }
};
const showRound = (r) => {
  if (r.status === 'aborted') { toast('このラウンドは中断されました'); goHome(); return; }
  round = r;
  local = loadLocal(r.id);
  if (local && !r.joined) local = null; // 参加者から外れていれば端末ログは使わない
  view = r.status === 'finished' ? 'finished' : 'round';
  setRoundHash(r.id);
  render();
  sync();
};
// この端末を本人の記録端末にする(サーバ側のログを取り込んでから続きの seq を振る)
const startRecording = (r, actions) => {
  const maxSeq = actions.reduce((m, a) => Math.max(m, a.seq), -1);
  local = { actions, syncedSeq: maxSeq, round: r };
  saveLocal(r.id, local);
  showRound(r);
};
const joinRound = async () => {
  if (busy || !round) return;
  const handicap = parseInt(document.getElementById('hc-input').value, 10) || 0;
  busy = true;
  try {
    const { round: r } = await api(`/rounds/${round.id}/join`, { method: 'POST', body: JSON.stringify({ handicap }) });
    rememberHandicap(handicap);
    const { actions } = await api(`/rounds/${r.id}/me/actions`);
    startRecording(r, actions || []);
    toast('参加しました');
  } catch (err) {
    toast(err.message);
  } finally {
    busy = false;
  }
};
const takeOverDevice = async () => {
  if (busy || !round) return;
  busy = true;
  try {
    const { actions } = await api(`/rounds/${round.id}/me/actions`);
    startRecording(round, actions || []);
    toast('この端末で入力します');
  } catch (err) {
    toast(err.message);
  } finally {
    busy = false;
  }
};

/* ─── 入力(端末に保存してから同期) ─── */
const addAction = (kind, extra = {}) => {
  if (!round || !local) return;
  const last = local.actions.reduce((m, a) => Math.max(m, a.seq), -1);
  local.actions.push({ seq: last + 1, kind, ...extra });
  local.round = round;
  saveLocal(round.id, local);
  render();
  sync();
};
const stroke = () => addAction('stroke');
const nextHole = () => {
  const s = myState();
  if (!s) return;
  if (s.currentHole >= round.holes && !s.finished) {
    if (!confirm(`ホール ${round.holes} を終えてホールアウトしますか?(グロス ${s.gross})`)) return;
  }
  addAction('next_hole');
};
const undo = () => {
  if (!local || effectiveActions(local.actions).length === 0) { toast('取り消す操作がありません'); return; }
  addAction('undo');
};
const setHole = (hole) => {
  const s = myState();
  if (!s) return;
  const v = prompt(`ホール ${hole} の打数`, String(s.strokes[hole - 1]));
  if (v === null) return;
  const value = parseInt(v, 10);
  if (!Number.isInteger(value) || value < 0 || value > MAX_STROKES) { toast('0〜99 の整数で入力してください'); return; }
  addAction('set', { hole, value });
};

const sync = async () => {
  if (!round || !local || syncing) return;
  const items = pending();
  if (!items.length) { updateBadge(); return; }
  syncing = true;
  updateBadge();
  try {
    const { round: r, lastSeq } = await api(`/rounds/${round.id}/me/actions`, { method: 'POST', body: JSON.stringify({ actions: items }) });
    local.syncedSeq = Math.max(local.syncedSeq, lastSeq);
    local.round = r;
    saveLocal(round.id, local);
    applyServerRound(r);
  } catch (err) {
    if (!err.offline) toast(err.message);
    if (err.status === 404) { dropLocal(round.id); goHome(); return; }
  } finally {
    syncing = false;
    updateBadge();
  }
};
// サーバの最新状態を取り込む。自分の分は端末ログが正なので表示上は端末側を優先する
const applyServerRound = (r) => {
  if (!round || r.id !== round.id) return;
  if (r.status === 'aborted') { toast('このラウンドは中断されました'); goHome(); return; }
  const changed = JSON.stringify(round) !== JSON.stringify(r);
  round = r;
  const next = r.status === 'finished' ? 'finished' : 'round';
  if (changed || next !== view) { view = next; render(); }
};
const refreshRound = async () => {
  if (!round) return;
  try {
    const { round: r } = await api(`/rounds/${round.id}`);
    applyServerRound(r);
  } catch (err) {
    if (err.status === 404) { toast('このラウンドは削除されました'); dropLocal(round.id); goHome(); return; }
    updateBadge();
  }
};

/* ─── ラウンド画面 ─── */
const holeCells = (s, holes, editable) => `
  <div class="holes ${holes > 9 ? 'wide' : ''}">
    ${s.strokes.map((v, i) => {
      const h = i + 1;
      const cls = h === s.currentHole && !s.finished ? 'cur' : h > s.holesPlayed && !(h === s.currentHole) ? 'todo' : '';
      return `<button class="${cls}" ${editable ? `onclick="setHole(${h})"` : 'disabled'}>${h}<b>${h > s.holesPlayed && h !== s.currentHole && !s.finished ? '−' : v}</b></button>`;
    }).join('')}
  </div>`;

const scoreboard = (r) => {
  const mine = myState();
  const rows = r.ranking.map((id) => r.players.find((p) => p.id === id)).filter(Boolean).map((p) => (p.isMe && mine ? { ...p, ...mine } : p));
  return `
    <div class="card">
      <div class="card-title">スコアボード <span style="font-weight:400">(順位はネット順・最終更新 ${ago(lastFetchAt)})</span></div>
      <div class="table-wrap"><table class="board">
        <thead><tr><th></th><th class="name">名前</th>${Array.from({ length: r.holes }, (_, i) => `<th>${i + 1}</th>`).join('')}<th>G</th><th>HC</th><th>N</th></tr></thead>
        <tbody>
          ${rows.map((p) => `<tr class="${p.isMe ? 'me' : ''}">
            <td class="pos">${p.rank}</td>
            <td class="name">${esc(p.name)}${p.finished ? '<div class="fin">ホールアウト</div>' : ''}</td>
            ${p.strokes.map((v, hi) => {
              const h = hi + 1;
              if (!p.finished && h === p.currentHole) return `<td class="cur">${v}</td>`;
              if (h > p.holesPlayed) return '<td class="todo">−</td>';
              return `<td>${v}</td>`;
            }).join('')}
            <td class="sum">${p.gross}</td><td>${p.handicap}</td><td class="sum">${p.net}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </div>`;
};

const manageButtons = (r) => (r.canManage ? `
  <div class="pad-actions">
    ${r.status === 'playing' ? '<button class="btn-sm btn-light" onclick="finishRound()">ラウンド終了</button><button class="btn-sm btn-light" onclick="abortRound()">中断</button>' : ''}
    <button class="btn-sm btn-danger" onclick="deleteRound()">🗑 削除</button>
  </div>` : '');

const renderRound = () => {
  const r = round;
  const p = me();
  let top = '';
  if (!p) {
    top = MY_NAME ? `
      <div class="card">
        <div class="card-title">このラウンドに参加する</div>
        <div class="form-row"><label>あなたのハンデ(ネット = グロス − ハンデ)</label><input type="number" id="hc-input" value="${savedHandicap()}" inputmode="numeric"></div>
        <button class="btn-primary" onclick="joinRound()">「${esc(MY_NAME)}」として参加</button>
        <div class="hint">参加した端末が記録用の端末になります。</div>
      </div>` : LiffAuth.nicknameCard();
  } else if (!local) {
    top = `
      <div class="card">
        <div class="card-title">参加済み(${esc(p.name)})</div>
        <div class="hint" style="margin-top:0">この端末は記録用になっていません。別の端末で入力中の場合はそのまま閲覧してください。<br>この端末で続きを入力する場合は、サーバに送信済みの内容を取り込んで切り替えます。</div>
        <button class="btn-secondary" onclick="takeOverDevice()">この端末で入力する</button>
      </div>`;
  } else {
    const s = myState();
    const isLast = s.currentHole >= r.holes;
    top = s.finished ? `
      <div class="me-card done">
        <div class="lbl">ホールアウト</div>
        <div class="hole">グロス ${s.gross} ／ ネット ${s.net}</div>
        <div class="sub">他の人の入力が終わるとラウンドが終了します。${pending().length ? '<br>未送信分は電波の届く所で自動送信されます。' : ''}</div>
        ${holeCells(s, r.holes, true)}
        <div class="me-actions"><button class="btn-sm btn-dark" onclick="undo()">↩ 取り消し</button></div>
      </div>` : `
      <div class="me-card">
        <div class="lbl">${esc(p.name)}　ホール</div>
        <div class="hole">${s.currentHole} / ${r.holes}</div>
        <div class="count">${s.strokes[s.currentHole - 1]}</div>
        <div class="sub">このホールの打数　｜　ここまでのグロス ${s.gross}</div>
        <button class="stroke-btn" onclick="stroke()">＋1打</button>
        <div class="me-actions">
          <button class="btn-sm btn-dark" onclick="undo()">↩ 取り消し</button>
          <button class="btn-sm btn-white" onclick="nextHole()">${isLast ? '⛳ ホールアウト' : '次のホール ›'}</button>
        </div>
        ${holeCells(s, r.holes, true)}
        <div class="sub" style="margin-top:6px;font-size:11px">ホールの数字をタップすると打数を直せます</div>
      </div>`;
  }
  root().innerHTML = `
    <div class="topbar">
      <button class="btn-sm btn-light" onclick="goHome()">‹ 一覧</button>
      <span class="topbar-title">${esc(roundLabel(r))}　${r.holes}H</span>
      <span id="sync-badge">${syncBadge()}</span>
    </div>
    ${externalNotice()}
    ${top}
    ${scoreboard(r)}
    ${manageButtons(r)}
  `;
};

const renderFinished = () => {
  const r = round;
  const medal = ['🥇', '🥈', '🥉'];
  const rows = r.ranking.map((id) => r.players.find((p) => p.id === id)).filter(Boolean);
  root().innerHTML = `
    <div class="topbar">
      <button class="btn-sm btn-light" onclick="goHome()">‹ 一覧</button>
      <span class="topbar-title">${esc(roundLabel(r))}　${r.holes}H</span>
      <span id="sync-badge">${syncBadge()}</span>
    </div>
    <div class="now done">
      <div class="lbl">ラウンド終了</div>
      <div class="who">🎉 ${rows.length ? esc(rows[0].name) : '−'} が1位!</div>
      <div class="sub">${fmtDate(r.startedAt)} 開始・${r.players.length}人</div>
    </div>
    <div class="card">
      <div class="card-title">順位(ネット)</div>
      ${rows.map((p) => `
        <div class="rank-row">
          <div class="pos">${medal[p.rank - 1] || `${p.rank}.`}</div>
          <div class="info"><div class="tname">${esc(p.name)}</div><div class="members">グロス ${p.gross}・ハンデ ${p.handicap}</div></div>
          <div class="pt">${p.net}</div>
        </div>`).join('')}
    </div>
    ${scoreboard(r)}
    ${local ? '<button class="btn-secondary" onclick="undo()">↩ 自分の最後の操作を取り消す</button>' : ''}
    ${MY_NAME ? '<button class="btn-primary" onclick="rematch()">同じ設定でもう一度</button>' : ''}
    ${manageButtons(r)}
  `;
};

/* ─── ラウンド操作 ─── */
const finishRound = async () => {
  if (busy || !round) return;
  if (!confirm('ラウンドを終了しますか?(入力が終わっていない人がいてもこの時点の打数で確定します)')) return;
  busy = true;
  try {
    await sync();
    const { round: r } = await api(`/rounds/${round.id}/finish`, { method: 'POST' });
    applyServerRound(r);
  } catch (err) {
    toast(err.message);
  } finally {
    busy = false;
  }
};
const abortRound = async () => {
  if (busy || !round) return;
  if (!confirm('このラウンドを中断しますか?(記録は履歴に「中断」として残ります)')) return;
  busy = true;
  try {
    await api(`/rounds/${round.id}/abort`, { method: 'POST' });
    dropLocal(round.id);
    goHome();
  } catch (err) {
    toast(err.message);
  } finally {
    busy = false;
  }
};
const deleteRound = async (id = round && round.id) => {
  if (busy || !id) return;
  if (!confirm('このラウンドを削除しますか?\n記録は残らず、履歴・成績にも含まれません。')) return;
  busy = true;
  try {
    await api(`/rounds/${id}`, { method: 'DELETE' });
    dropLocal(id);
    toast('削除しました');
    if (round && round.id === id) goHome();
    else { closeDetail(); loadHistory(); }
  } catch (err) {
    toast(err.message);
  } finally {
    busy = false;
  }
};
const rematch = async () => {
  if (busy || !round) return;
  const p = me();
  busy = true;
  try {
    const { round: r } = await api('/rounds', { method: 'POST', body: JSON.stringify({ title: round.title || '', holes: round.holes, handicap: p ? p.handicap : savedHandicap() }) });
    startRecording(r, []);
    toast('新しいラウンドを作りました。他の人は一覧から参加してください', 3000);
  } catch (err) {
    toast(err.message);
  } finally {
    busy = false;
  }
};

/* ─── サーバとの同期(定期) ─── */
const loadActive = async () => {
  try {
    const { rounds } = await api('/rounds/active');
    const changed = JSON.stringify(rounds) !== JSON.stringify(activeRounds);
    activeRounds = rounds || [];
    if (view === 'loading') { view = 'lobby'; render(); }
    else if (view === 'lobby' && changed) renderLobby();
  } catch (err) {
    if (view === 'loading') { view = 'lobby'; render(); }
    else if (view === 'lobby') renderLobby();
  }
};
const tick = () => {
  if (document.visibilityState !== 'visible' || busy) return;
  if (view === 'round' || view === 'finished') { if (pending().length) sync(); else refreshRound(); }
  else if (view === 'lobby') loadActive();
};
setInterval(tick, 5000);
document.addEventListener('visibilitychange', tick);
window.addEventListener('online', () => { online = true; updateBadge(); sync(); });
window.addEventListener('offline', () => { online = false; updateBadge(); });

/* ─── 履歴 ─── */
const loadHistory = async () => {
  const el = document.getElementById('history-root');
  try {
    const { rounds } = await api('/rounds?limit=100');
    if (!rounds.length) { el.innerHTML = '<div class="empty">まだ記録がありません</div>'; return; }
    el.innerHTML = `<div class="card">${rounds.map((r) => {
      const top = r.ranking.length ? r.players.find((p) => p.id === r.ranking[0]) : null;
      return `
        <div class="game-item" onclick="showDetail(${r.id})">
          <div class="top">
            <span>${fmtDate(r.startedAt)}</span>
            <span class="badge" style="margin-left:0">${r.holes}H</span>
            ${r.status === 'aborted' ? '<span class="badge out" style="margin-left:0">中断</span>' : ''}
          </div>
          <div class="win">${esc(roundLabel(r))}${top && r.status === 'finished' ? `　🏆 ${esc(top.name)}` : ''}</div>
          <div class="sum">${r.players.map((p) => `${esc(p.name)} ${p.gross}(${p.net})`).join(' ／ ')}</div>
        </div>`;
    }).join('')}</div>`;
  } catch (err) {
    el.innerHTML = `<div class="empty">読み込みに失敗しました<br>${esc(err.message)}</div>`;
  }
};

const showDetail = async (id) => {
  const content = document.getElementById('detail-content');
  content.innerHTML = '<div class="empty">読み込み中…</div>';
  document.getElementById('detail').classList.add('open');
  try {
    const { round: r } = await api(`/rounds/${id}`);
    const rows = r.ranking.map((pid) => r.players.find((p) => p.id === pid)).filter(Boolean);
    content.innerHTML = `
      <div class="card">
        <div class="top" style="font-size:12px;color:#999">${fmtDate(r.startedAt)}　${r.holes}H${r.status === 'aborted' ? '・中断' : ''}</div>
        <div style="font-size:18px;font-weight:800;margin:6px 0 10px">${esc(roundLabel(r))}</div>
        ${rows.map((p) => `
          <div class="rank-row">
            <div class="pos" style="font-size:14px;color:#999">${p.rank}</div>
            <div class="info"><div class="tname">${esc(p.name)}</div><div class="members">グロス ${p.gross}・ハンデ ${p.handicap}</div></div>
            <div class="pt">${p.net}</div>
          </div>`).join('')}
      </div>
      <div class="card">
        <div class="card-title">ホール別打数</div>
        <div class="table-wrap"><table class="board">
          <thead><tr><th class="name">名前</th>${Array.from({ length: r.holes }, (_, i) => `<th>${i + 1}</th>`).join('')}<th>G</th><th>N</th></tr></thead>
          <tbody>${rows.map((p) => `<tr><td class="name">${esc(p.name)}</td>${p.strokes.map((v, i) => `<td class="${i + 1 > p.holesPlayed ? 'todo' : ''}">${i + 1 > p.holesPlayed ? '−' : v}</td>`).join('')}<td class="sum">${p.gross}</td><td class="sum">${p.net}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>
      ${r.canManage ? `<button class="btn-secondary danger" onclick="deleteRound(${r.id})">この記録を削除</button>` : ''}
    `;
  } catch (err) {
    content.innerHTML = `<div class="empty">読み込みに失敗しました<br>${esc(err.message)}</div>`;
  }
};
const closeDetail = () => document.getElementById('detail').classList.remove('open');

/* ─── 成績 ─── */
const loadStats = async () => {
  const el = document.getElementById('stats-root');
  try {
    const { players } = await api('/stats');
    if (!players.length) { el.innerHTML = '<div class="empty">まだ記録がありません</div>'; return; }
    el.innerHTML = `
      <div class="card">
        <div class="card-title">個人成績(終了したラウンドのみ)</div>
        <div class="table-wrap"><table class="stats">
          <thead><tr><th>名前</th><th>R</th><th>1位</th><th>平均G</th><th>ベストG</th><th>平均N</th></tr></thead>
          <tbody>
            ${players.map((p) => `<tr>
              <td>${esc(p.name)}</td><td>${p.rounds}</td><td>${p.wins}</td>
              <td>${p.avgGross.toFixed(1)}</td><td>${p.bestGross ?? '−'}</td><td>${p.avgNet.toFixed(1)}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
        <div class="hint">G＝グロス(打数合計)、N＝ネット(グロス − ハンデ)。</div>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="empty">読み込みに失敗しました<br>${esc(err.message)}</div>`;
  }
};

/* ─── 初期化 ─── */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/liff/golf/sw.js', { scope: '/liff/golf/' }).catch(() => {});
}
(async () => {
  try {
    const { me: m, offline: off } = await LiffAuth.init();
    MY_NAME = String(m.name || '').trim();
    if (off) online = false;
  } catch (err) {
    root().innerHTML = `<div class="empty">ログインできませんでした<br>${esc(err.message)}<br><span style="font-size:12px">電波のある所で開き直してください</span></div>`;
    return;
  }
  const hashRound = (location.hash.match(/^#round=(\d+)$/) || [])[1];
  if (hashRound) {
    openRound(Number(hashRound)).then(loadActive);
  } else {
    // オフラインで開いた場合は、この端末で記録中のラウンドがあればそれを開く
    loadActive().then(() => {
      if (view === 'lobby' && !online) {
        let key = null;
        try { key = Object.keys(localStorage).find((k) => k.startsWith('golf.round.')); } catch (_) {}
        if (key) openRound(Number(key.replace('golf.round.', '')));
      }
    });
  }
})();
