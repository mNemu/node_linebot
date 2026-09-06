/* 現在時刻表示 + 共有カウントダウンタイマー。サーバ側は src/timer/api.js。
   ログインは LIFF(/liff/liffauth.js)。タイマーはログイン済みなら誰でも
   閲覧・作成・操作できる、全員共有の一覧(得点ボードの得点/ボードと同じ形)。
   種類は2つ:
     - deadline: 目標日時までの残り時間を都度計算するだけ(開始/一時停止なし)
     - duration: 決めた時間からのストップウォッチ式カウントダウン(開始/一時停止/リセット可)
   duration が running のときはサーバから返る remainingMs のスナップショットと
   取得時刻(_fetchedAt)から毎秒ローカルで再計算し、ポーリング間隔をまたいでも
   カクつかず進んで見えるようにしている。 */
'use strict';

const API = '/api/timer';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer = null;
const toast = (msg, ms = 2200) => {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
};

const api = (path, options) => LiffAuth.api(API + path, options);

/* ─── 状態 ─── */
let timers = [];
let createOpen = false;
let busy = false;
// 新規作成フォームの入力値。あえて "form" という名前は使わない:
// フォーム関連要素(input等)は組み込みの `form` プロパティ(所属する
// <form> 要素、無ければ null)を持ち、インライン on* 属性のスコープ内では
// それが最優先で見つかってしまうため、`form.x = ...` は `null.x = ...` と
// 評価されて静かに失敗する(このバグで実際に入力が効かなくなっていた)。
const draft = { name: '', kind: 'deadline', target: '', h: 0, m: 5, s: 0 };

const root = () => document.getElementById('root');

const pad2 = (n) => String(n).padStart(2, '0');
const fmtDuration = (ms) => {
  const neg = ms < 0;
  const abs = Math.round(Math.abs(ms) / 1000) * 1000;
  const totalSec = Math.floor(abs / 1000);
  const days = Math.floor(totalSec / 86400);
  const rem = totalSec % 86400;
  const h = Math.floor(rem / 3600);
  const m = Math.floor((rem % 3600) / 60);
  const s = rem % 60;
  const hh = days > 0 ? `${days}日 ${pad2(h)}` : String(h);
  return `${neg ? '-' : ''}${hh}:${pad2(m)}:${pad2(s)}`;
};
const fmtDateTime = (msValue) => {
  const d = new Date(msValue);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

const KIND_LABEL = { deadline: '日時指定', duration: '時間指定' };
const STATUS_LABEL = { idle: '待機中', running: '実行中', paused: '一時停止', finished: '終了' };

/* ─── 残り時間の表示値 ─── */
const displayMs = (t) => {
  if (t.kind === 'deadline') return t.targetAt - Date.now();
  if (t.status === 'running') return Math.max(0, t.remainingMs - (Date.now() - t._fetchedAt));
  return t.remainingMs;
};
const displayStatus = (t) => {
  if (t.kind === 'deadline') return null;
  if (t.status === 'running' && displayMs(t) <= 0) return 'finished';
  return t.status;
};

/* ─── 描画 ─── */
const clockCardHtml = () => {
  const now = new Date();
  const week = ['日', '月', '火', '水', '木', '金', '土'][now.getDay()];
  return `
    <div class="clock-card">
      <div class="clock-time" id="clock-time">${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}</div>
      <div class="clock-date" id="clock-date">${now.getFullYear()}/${pad2(now.getMonth() + 1)}/${pad2(now.getDate())}(${week})</div>
    </div>`;
};

const timerCardHtml = (t) => {
  const ms = displayMs(t);
  const status = displayStatus(t);
  const overClass = t.kind === 'deadline' && ms <= 0 ? 'over' : status === 'finished' ? 'finished' : '';
  const remainText = t.kind === 'deadline' && ms <= 0 ? `経過 ${fmtDuration(ms)}` : fmtDuration(Math.max(ms, status === 'finished' ? 0 : ms));
  const sub = t.kind === 'deadline'
    ? `目標: ${esc(fmtDateTime(t.targetAt))}`
    : `${KIND_LABEL[t.kind]}・${STATUS_LABEL[status]}`;

  let actions = `<button class="btn-sm btn-danger t-del-btn" onclick="deleteTimer(${t.id})">🗑 削除</button>`;
  if (t.kind === 'duration') {
    const pieces = [];
    if (status === 'idle' || status === 'paused') pieces.push(`<button class="btn-sm btn-accent" onclick="startTimer(${t.id})">▶ ${status === 'paused' ? '再開' : '開始'}</button>`);
    if (status === 'running') pieces.push(`<button class="btn-sm btn-light" onclick="pauseTimer(${t.id})">⏸ 一時停止</button>`);
    if (status === 'paused' || status === 'finished') pieces.push(`<button class="btn-sm btn-light" onclick="resetTimer(${t.id})">↺ リセット</button>`);
    actions = pieces.join('') + actions;
  }

  return `
    <div class="timer-card" data-id="${t.id}" data-kind="${t.kind}">
      <div class="t-top">
        <div class="t-name">${esc(t.name)}</div>
        <span class="badge">${KIND_LABEL[t.kind]}</span>
      </div>
      <div class="t-remain ${overClass}" id="t-remain-${t.id}">${esc(remainText)}</div>
      <div class="t-sub">${esc(sub)}</div>
      <div class="t-actions">${actions}</div>
    </div>`;
};

const createFormHtml = () => `
  <div class="card">
    <div class="card-title">新しいタイマー</div>
    <div class="input-row">
      <input type="text" id="name-input" placeholder="名前(例: 会議開始まで)" maxlength="40" value="${esc(draft.name)}" oninput="draft.name = this.value">
    </div>
    <div class="form-row">
      <div class="seg">
        <button class="${draft.kind === 'deadline' ? 'on' : ''}" onclick="setKind('deadline')">日時指定</button>
        <button class="${draft.kind === 'duration' ? 'on' : ''}" onclick="setKind('duration')">時間指定</button>
      </div>
    </div>
    <div class="kind-fields ${draft.kind === 'deadline' ? '' : 'hidden'}">
      <label class="hint" style="margin:0 0 4px">目標の日時</label>
      <input type="datetime-local" id="target-input" value="${esc(draft.target)}" oninput="draft.target = this.value" style="width:100%; padding:11px 13px; border:1.5px solid #e0e0e0; border-radius:9px; font-size:16px;">
    </div>
    <div class="kind-fields ${draft.kind === 'duration' ? '' : 'hidden'}">
      <label class="hint" style="margin:0 0 4px">カウントダウンする時間</label>
      <div class="dur-inputs">
        <input type="number" min="0" max="23" id="h-input" value="${draft.h}" oninput="draft.h = this.value"><span>時間</span>
        <input type="number" min="0" max="59" id="m-input" value="${draft.m}" oninput="draft.m = this.value"><span>分</span>
        <input type="number" min="0" max="59" id="s-input" value="${draft.s}" oninput="draft.s = this.value"><span>秒</span>
      </div>
    </div>
    <button class="btn-primary" onclick="submitCreate()" ${busy ? 'disabled' : ''}>作成</button>
    <button class="btn-secondary" onclick="toggleCreate()">キャンセル</button>
  </div>`;

const render = () => {
  root().innerHTML = `
    ${clockCardHtml()}
    <div class="card">
      <div class="card-title">共有タイマー(${timers.length})</div>
      ${timers.length === 0 ? '<div class="empty">まだタイマーがありません</div>' : ''}
    </div>
    ${timers.map(timerCardHtml).join('')}
    ${createOpen ? createFormHtml() : '<button class="btn-primary" onclick="toggleCreate()">＋ 新しいタイマー</button>'}
  `;
};

/* ─── フォーム操作 ─── */
const setKind = (kind) => { draft.kind = kind; render(); };
const toggleCreate = () => { createOpen = !createOpen; render(); };

const submitCreate = async () => {
  if (busy) return;
  const name = draft.name.trim();
  if (!name) { toast('名前を入力してください'); return; }
  let payload;
  if (draft.kind === 'deadline') {
    if (!draft.target) { toast('目標の日時を入力してください'); return; }
    const targetAt = new Date(draft.target).toISOString();
    payload = { name, kind: 'deadline', targetAt };
  } else {
    const h = Number(draft.h) || 0;
    const m = Number(draft.m) || 0;
    const s = Number(draft.s) || 0;
    const durationMs = (h * 3600 + m * 60 + s) * 1000;
    if (durationMs <= 0) { toast('時間を指定してください'); return; }
    payload = { name, kind: 'duration', durationMs };
  }
  busy = true;
  try {
    await api('/timers', { method: 'POST', body: JSON.stringify(payload) });
    draft.name = ''; draft.target = ''; draft.h = 0; draft.m = 5; draft.s = 0;
    createOpen = false;
    toast('タイマーを作成しました');
    await loadTimers();
  } catch (err) {
    toast(err.message);
  } finally {
    busy = false;
  }
};

/* ─── 操作 ─── */
const withBusy = async (fn) => {
  if (busy) return;
  busy = true;
  try { await fn(); } catch (err) { toast(err.message); } finally { busy = false; }
};
const startTimer = (id) => withBusy(async () => { await api(`/timers/${id}/start`, { method: 'POST' }); await loadTimers(); });
const pauseTimer = (id) => withBusy(async () => { await api(`/timers/${id}/pause`, { method: 'POST' }); await loadTimers(); });
const resetTimer = (id) => withBusy(async () => { await api(`/timers/${id}/reset`, { method: 'POST' }); await loadTimers(); });
const deleteTimer = (id) => withBusy(async () => {
  const t = timers.find((x) => x.id === id);
  if (!confirm(`「${t ? t.name : 'このタイマー'}」を削除しますか?`)) return;
  await api(`/timers/${id}`, { method: 'DELETE' });
  toast('削除しました');
  await loadTimers();
});

/* ─── サーバとの同期 ─── */
const loadTimers = async () => {
  try {
    const { timers: list } = await api('/timers');
    const fetchedAt = Date.now();
    timers = (list || []).map((t) => ({ ...t, _fetchedAt: fetchedAt }));
    render();
  } catch (err) {
    if (timers.length === 0) root().innerHTML = `<div class="empty">読み込みに失敗しました<br>${esc(err.message)}</div>`;
  }
};

/* ─── 毎秒の表示更新(全体再描画はしない) ─── */
const tickDisplay = () => {
  const clockTime = document.getElementById('clock-time');
  if (clockTime) {
    const now = new Date();
    clockTime.textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  }
  for (const t of timers) {
    const el = document.getElementById(`t-remain-${t.id}`);
    if (!el) continue;
    const ms = displayMs(t);
    const status = displayStatus(t);
    el.textContent = t.kind === 'deadline' && ms <= 0 ? `経過 ${fmtDuration(ms)}` : fmtDuration(Math.max(ms, status === 'finished' ? 0 : ms));
  }
};
setInterval(tickDisplay, 1000);

const tickPoll = () => {
  // 作成フォームを開いている間は再描画しない: 全体再描画で <input> が
  // 差し替わると、日本語IMEの変換中の入力が消えて「名前が入力できない」
  // ように見えてしまうため。
  if (document.visibilityState !== 'visible' || busy || createOpen) return;
  loadTimers();
};
setInterval(tickPoll, 5000);
document.addEventListener('visibilitychange', tickPoll);

/* ─── 初期化 ─── */
(async () => {
  try {
    await LiffAuth.init();
  } catch (err) {
    root().innerHTML = `<div class="empty">ログインできませんでした<br>${esc(err.message)}</div>`;
    return;
  }
  await loadTimers();
})();
