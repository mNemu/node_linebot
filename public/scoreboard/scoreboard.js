/* 得点ボード。YURU の static/js/molkky.js / golf.js の作りを参考にした、
   汎用の得点記録ページ。サーバ側は src/scoreboard/api.js。

   - ログインは無く、本人は自分で入力したニックネームだけで識別する
     (端末の localStorage に保存。新しいボードの参加者に自動で追加される)。
   - 得点にゲーム固有のルールは無い(目標点・バースト・ホール・ハンデ等は無し)。
     参加者をタップして選び、点数を加点/減点していくだけ。
   - 状態はサーバが記録ログから計算して返す。他の端末での更新は 5 秒ごとに反映。 */
'use strict';

/* ─── 共通 ─── */
const API = '/scoreboard/api';
const NICK_KEY = 'scoreboard.nickname';
const ACCESS_KEY = 'scoreboard.key';
const SETUP_KEY = 'scoreboard.setup';
const QUICK_POINTS = [1, 2, 3, 5, 10];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const attr = (s) => JSON.stringify(String(s ?? '')).replace(/"/g, '&quot;');

let toastTimer = null;
const toast = (msg, ms = 2200) => {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
};

// アクセスキー(サーバの SCOREBOARD_KEY)。?key=… で一度開けば端末に記憶する
let accessKey = '';
try { accessKey = localStorage.getItem(ACCESS_KEY) || ''; } catch (_) {}
{
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get('key');
  if (fromUrl) {
    accessKey = fromUrl;
    try { localStorage.setItem(ACCESS_KEY, fromUrl); } catch (_) {}
    params.delete('key');
    const qs = params.toString();
    try { history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`); } catch (_) {}
  }
}

const api = async (path, options = {}) => {
  let res;
  try {
    res = await fetch(API + path, {
      cache: 'no-store',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(accessKey ? { 'X-Board-Key': accessKey } : {}),
        ...(options.headers || {}),
      },
    });
  } catch (_) {
    throw new Error('通信できません');
  }
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  if (!res.ok) {
    const err = new Error((body && body.error) || `エラー (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
};

const fmtDate = (ms) => {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const fmtTime = (ms) => {
  if (!ms) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const signed = (n) => (n > 0 ? `+${n}` : String(n));

const showTab = (name) => {
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.add('active');
  document.getElementById(`tabbtn-${name}`).classList.add('active');
  if (name === 'history') loadHistory();
  if (name === 'stats') loadStats();
};

/* ─── ニックネーム ─── */
let myName = '';
try { myName = (localStorage.getItem(NICK_KEY) || '').trim(); } catch (_) {}

const saveNickname = () => {
  const input = document.getElementById('nick-input');
  const value = (input ? input.value : '').trim();
  if (!value) { toast('ニックネームを入力してください'); return; }
  if (value.length > 32) { toast('ニックネームは32文字以内にしてください'); return; }
  myName = value;
  try { localStorage.setItem(NICK_KEY, value); } catch (_) {}
  toast(`ニックネームを「${value}」にしました`);
  render();
};

// ロビー・参加者設定の上に出すニックネーム欄。未入力なら入力を促す
const nicknameCard = () => `
  <div class="card nick-card">
    <div class="card-title">あなたのニックネーム</div>
    ${myName ? `<div class="nick-now">現在: <span>${esc(myName)}</span></div>` : ''}
    <div class="input-row">
      <input type="text" id="nick-input" placeholder="${myName ? '変更するニックネーム' : 'ニックネームを入力'}" maxlength="32" autocomplete="off" enterkeyhint="done">
      <button class="btn-sm btn-accent" onclick="saveNickname()">${myName ? '変更' : '保存'}</button>
    </div>
    <div class="hint">${myName ? '新しいボードの参加者に自動で追加されます。' : 'ニックネームを入れると、ボードの参加者として自分を追加できます。'}</div>
  </div>`;
const bindNicknameInput = () => {
  const input = document.getElementById('nick-input');
  if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveNickname(); } });
};

/* ─── 状態 ─── */
let view = 'loading';   // lobby | setup | playing | finished
let board = null;       // 表示中のボード(サーバから返る計算済み状態)
let activeBoards = [];
let busy = false;
let knownPlayers = [];
let selected = null;    // 得点を入れる相手(participant index)
const setup = { names: [], title: '' };

const saveSetup = () => {
  try { localStorage.setItem(SETUP_KEY, JSON.stringify({ names: setup.names })); } catch (_) {}
};
const restoreSetup = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(SETUP_KEY) || 'null');
    if (saved && Array.isArray(saved.names)) setup.names = saved.names.filter((n) => typeof n === 'string' && n.trim());
  } catch (_) {}
};

const root = () => document.getElementById('game-root');
const boardLabel = (b) => b.title || b.players.map((p) => p.name).join('・');
const myIndex = (b) => (myName ? b.players.findIndex((p) => p.name === myName) : -1);
const leaders = (b) => b.players.filter((p) => p.rank === 1);
const medal = ['🥇', '🥈', '🥉'];
const rankMark = (rank) => medal[rank - 1] || `${rank}.`;

const render = () => {
  if (view === 'lobby') renderLobby();
  else if (view === 'setup') renderSetup();
  else if (view === 'playing') renderPlaying();
  else if (view === 'finished') renderFinished();
  else root().innerHTML = '<div class="empty">読み込み中…</div>';
};

/* ─── ロビー: 進行中ボード一覧 ─── */
const renderLobby = () => {
  root().innerHTML = `
    ${nicknameCard()}
    <div class="card">
      <div class="card-title">進行中のボード（${activeBoards.length}）</div>
      ${activeBoards.length === 0 ? '<div class="empty">進行中のボードはありません</div>' : activeBoards.map((b) => `
        <div class="game-item has-del" onclick="openBoard(${b.id})">
          <div class="top"><span>${fmtDate(b.startedAt)} 開始</span><span>${b.players.length}人</span><span>記録 ${b.turns.length}件</span></div>
          <div class="win">${esc(boardLabel(b))}</div>
          <div class="sum">${b.ranking.map((i) => b.players[i]).map((p) => `${esc(p.name)} ${p.score}`).join(' ／ ')}</div>
          <button class="game-del" title="削除" onclick="event.stopPropagation(); deleteBoard(${b.id})">🗑</button>
        </div>`).join('')}
    </div>
    <button class="btn-primary" onclick="newBoard()">＋ 新しいボード</button>
    <div class="hint" style="text-align:center">複数のボードを同時に進められます。</div>
  `;
  bindNicknameInput();
};

const newBoard = () => {
  if (myName && !setup.names.includes(myName)) setup.names.unshift(myName);
  view = 'setup';
  render();
};
const goHome = () => {
  board = null;
  selected = null;
  view = 'lobby';
  setBoardHash(null);
  render();
  loadActive();
};
// URL の #board=ID で特定のボードを直接開ける(他の端末とリンク共有用)
const setBoardHash = (id) => {
  try { history.replaceState(null, '', id ? `#board=${id}` : location.pathname + location.search); } catch (_) {}
};
const showBoard = (b) => {
  board = b;
  if (selected !== null && selected >= b.players.length) selected = null;
  view = b.status === 'playing' ? 'playing' : 'finished';
  setBoardHash(b.id);
  render();
};
const openBoard = async (id) => {
  try {
    const { board: b } = await api(`/boards/${id}`);
    showBoard(b);
  } catch (err) {
    toast(err.message);
    if (view === 'loading') view = 'lobby';
    loadActive();
  }
};

/* ─── 参加者の設定 ─── */
const renderSetup = () => {
  const chips = knownPlayers.filter((n) => !setup.names.includes(n));
  root().innerHTML = `
    ${myName ? '' : nicknameCard()}
    <div class="card">
      <div class="card-title">参加者</div>
      <div class="input-row">
        <input type="text" id="name-input" placeholder="名前を入力" maxlength="32" autocomplete="off" enterkeyhint="done">
        <button class="btn-sm btn-accent" onclick="addName()">追加</button>
      </div>
      ${chips.length ? `<div class="chips">${chips.map((n) => `<button class="chip" onclick="addName(${attr(n)})">${esc(n)}</button>`).join('')}</div>` : ''}
      <div class="name-list">
        ${setup.names.length === 0 ? '<div class="empty">まだ参加者がいません</div>' : setup.names.map((n, i) => `
          <div class="name-row">
            <span class="idx">${i + 1}</span>
            <span class="nm">${esc(n)}${n === myName ? '<span class="badge me">あなた</span>' : ''}</span>
            <button class="icon-btn" onclick="moveName(${i}, -1)" ${i === 0 ? 'disabled' : ''}>▲</button>
            <button class="icon-btn" onclick="moveName(${i}, 1)" ${i === setup.names.length - 1 ? 'disabled' : ''}>▼</button>
            <button class="icon-btn del" onclick="removeName(${i})">✕</button>
          </div>`).join('')}
      </div>
      ${myName && !setup.names.includes(myName) ? `<div class="hint">あなた「${esc(myName)}」は参加者から外れています。 <a href="#" onclick="addName(${attr(myName)}); return false;" style="color:var(--accent)">追加する</a></div>` : ''}
      <div class="hint">ボード開始後も、あとから参加者を追加できます。</div>
    </div>

    <div class="card">
      <div class="card-title">ボード名（任意）</div>
      <div class="input-row">
        <input type="text" id="title-input" placeholder="例: ボウリング 1G" maxlength="40" value="${esc(setup.title)}" oninput="setup.title = this.value">
      </div>
      <div class="hint">複数のボードを同時に進めるときの目印になります。</div>
    </div>

    <button class="btn-primary" onclick="startBoard()" ${setup.names.length < 1 ? 'disabled' : ''}>ボード開始</button>
    ${activeBoards.length ? '<button class="btn-secondary" onclick="goHome()">‹ 進行中のボード一覧へ</button>' : ''}
  `;
  const input = document.getElementById('name-input');
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addName(); } });
  bindNicknameInput();
};

const addName = (name) => {
  const input = document.getElementById('name-input');
  const value = String(name ?? (input ? input.value : '')).trim();
  if (!value) return;
  if (setup.names.includes(value)) { toast('同じ名前がすでにあります'); return; }
  if (setup.names.length >= 20) { toast('参加者は20人までです'); return; }
  setup.names.push(value);
  saveSetup();
  renderSetup();
  if (name == null) document.getElementById('name-input').focus();
};
const removeName = (i) => { setup.names.splice(i, 1); saveSetup(); renderSetup(); };
const moveName = (i, dir) => {
  const j = i + dir;
  if (j < 0 || j >= setup.names.length) return;
  [setup.names[i], setup.names[j]] = [setup.names[j], setup.names[i]];
  saveSetup(); renderSetup();
};

/* ─── ボード開始 ─── */
const createBoard = async (payload) => {
  if (busy) return;
  busy = true;
  try {
    const { board: b } = await api('/boards', { method: 'POST', body: JSON.stringify(payload) });
    selected = null;
    showBoard(b);
    loadPlayers();
    loadActive();
  } catch (err) {
    toast(err.message);
  } finally {
    busy = false;
  }
};
const startBoard = () => createBoard({ title: setup.title, players: setup.names });

/* ─── 対戦中 ─── */
const lastDelta = (b, i) => {
  for (let k = b.turns.length - 1; k >= 0; k--) {
    if (b.turns[k].playerIndex === i) return b.turns[k].points;
  }
  return null;
};

const playerCardHtml = (b, p, i) => {
  const cls = ['player-card'];
  if (i === selected) cls.push('sel');
  const delta = lastDelta(b, i);
  return `
    <div class="${cls.join(' ')}" onclick="selectPlayer(${i})">
      <div class="pos">${p.rank}</div>
      <div class="info">
        <div class="pname">${esc(p.name)}${p.name === myName ? '<span class="badge me">あなた</span>' : ''}</div>
        <div class="meta">記録 ${p.entries}件</div>
      </div>
      <div class="score">
        <div class="pt">${p.score}</div>
        <div class="delta">${delta === null ? '&nbsp;' : `最後 ${signed(delta)}`}</div>
      </div>
    </div>`;
};

const joinCard = (b) => {
  if (myIndex(b) >= 0) return '';
  if (!myName) return nicknameCard();
  return `
    <div class="card">
      <div class="card-title">このボードに参加する</div>
      <button class="btn-primary" style="margin-top:0" onclick="joinBoard()">「${esc(myName)}」を参加者に追加</button>
    </div>`;
};

const renderPlaying = () => {
  const b = board;
  const sel = selected !== null ? b.players[selected] : null;
  const last = b.turns[b.turns.length - 1];
  root().innerHTML = `
    <div class="topbar">
      <button class="btn-sm btn-light" onclick="goHome()">‹ 一覧</button>
      <span class="topbar-title">${esc(boardLabel(b))}</span>
      <span class="badge" style="margin-left:0">${b.players.length}人</span>
    </div>
    ${joinCard(b)}
    ${b.players.map((p, i) => playerCardHtml(b, p, i)).join('')}
    <div class="card" style="margin-top:12px">
      <div class="card-title">${sel ? `${esc(sel.name)} に加点・減点` : '得点を入れる参加者をタップしてください'}</div>
      <div class="pad">
        ${QUICK_POINTS.map((p) => `<button class="pad-btn" onclick="addPoints(${p})" ${sel ? '' : 'disabled'}>+${p}</button>`).join('')}
      </div>
      <div class="pad-custom">
        <input type="number" id="pt-input" inputmode="numeric" placeholder="点数" ${sel ? '' : 'disabled'}>
        <button class="btn-sm btn-accent" onclick="addCustom(1)" ${sel ? '' : 'disabled'}>＋ 加点</button>
        <button class="btn-sm btn-light" onclick="addCustom(-1)" ${sel ? '' : 'disabled'}>− 減点</button>
      </div>
      <div class="pad-actions">
        <button class="btn-sm btn-light" onclick="undo()" ${b.turns.length === 0 ? 'disabled' : ''}>↩ 取り消し</button>
        <button class="btn-sm btn-light" onclick="finishBoard()">終了</button>
        <button class="btn-sm btn-light" onclick="abortBoard()">中断</button>
        <button class="btn-sm btn-danger" onclick="deleteBoard(${b.id})" title="このボードを削除">🗑</button>
      </div>
      <div class="hint">記録 ${b.turns.length}件　${last ? `最後: ${esc(b.players[last.playerIndex].name)} ${signed(last.points)}` : ''}</div>
    </div>
  `;
  const input = document.getElementById('pt-input');
  if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(1); } });
  bindNicknameInput();
};

const selectPlayer = (i) => {
  selected = selected === i ? null : i;
  renderPlaying();
  if (selected !== null) { const input = document.getElementById('pt-input'); if (input) input.focus(); }
};

const setPadDisabled = (disabled) => {
  document.querySelectorAll('.pad-btn, .pad-custom button, .pad-actions button').forEach((el) => { el.disabled = disabled; });
};

const addPoints = async (points) => {
  if (busy || !board || selected === null) return;
  busy = true;
  setPadDisabled(true);
  try {
    const name = board.players[selected].name;
    const { board: b } = await api(`/boards/${board.id}/turns`, { method: 'POST', body: JSON.stringify({ playerIndex: selected, points }) });
    board = b;
    toast(`${name} ${signed(points)}`, 1400);
    renderPlaying();
  } catch (err) {
    toast(err.message);
    if (err.status === 409 || err.status === 404) await refreshBoard();
    else renderPlaying();
  } finally {
    busy = false;
  }
};
const addCustom = (sign) => {
  const input = document.getElementById('pt-input');
  const value = parseInt(input ? input.value : '', 10);
  if (!Number.isInteger(value) || value === 0) { toast('点数を入力してください'); return; }
  if (Math.abs(value) > 9999) { toast('点数は±9999以内にしてください'); return; }
  addPoints(sign * Math.abs(value));
};

const undo = async () => {
  if (busy || !board) return;
  busy = true;
  try {
    const { board: b } = await api(`/boards/${board.id}/turns/last`, { method: 'DELETE' });
    board = b;
    renderPlaying();
    toast('最後の記録を取り消しました');
  } catch (err) {
    toast(err.message);
    if (err.status === 404) goHome();
    else if (err.status === 409) await refreshBoard();
  } finally {
    busy = false;
  }
};

const joinBoard = async () => {
  if (busy || !board || !myName) return;
  busy = true;
  try {
    const { board: b } = await api(`/boards/${board.id}/players`, { method: 'POST', body: JSON.stringify({ name: myName }) });
    board = b;
    selected = myIndex(b);
    render();
    toast('参加しました');
    loadPlayers();
  } catch (err) {
    toast(err.message);
    if (err.status === 404) goHome();
    else if (err.status === 409) await refreshBoard();
  } finally {
    busy = false;
  }
};

const finishBoard = async () => {
  if (busy || !board) return;
  const top = leaders(board).map((p) => p.name).join('・');
  if (!confirm(`このボードを終了しますか？（現在の1位: ${top || '−'}）`)) return;
  busy = true;
  try {
    const { board: b } = await api(`/boards/${board.id}/finish`, { method: 'POST' });
    showBoard(b);
    loadActive();
  } catch (err) {
    toast(err.message);
    if (err.status === 404) goHome();
    else if (err.status === 409) await refreshBoard();
  } finally {
    busy = false;
  }
};

const abortBoard = async () => {
  if (busy || !board) return;
  if (!confirm('このボードを中断しますか？（記録は履歴に「中断」として残ります）')) return;
  busy = true;
  try {
    await api(`/boards/${board.id}/abort`, { method: 'POST' });
    goHome();
  } catch (err) {
    toast(err.message);
  } finally {
    busy = false;
  }
};

/* ─── 終了 ─── */
const renderFinished = () => {
  const b = board;
  const rows = b.ranking.map((i) => b.players[i]);
  const top = leaders(b).map((p) => esc(p.name)).join('・');
  root().innerHTML = `
    <div class="topbar">
      <button class="btn-sm btn-light" onclick="goHome()">‹ 一覧</button>
      <span class="topbar-title">${esc(boardLabel(b))}</span>
      ${b.status === 'aborted' ? '<span class="badge out" style="margin-left:0">中断</span>' : ''}
    </div>
    <div class="now done">
      <div class="lbl">${b.status === 'aborted' ? 'ボード中断' : 'ボード終了'}</div>
      <div class="who">${b.status === 'aborted' ? esc(boardLabel(b)) : `🎉 ${top || '−'} が1位！`}</div>
      <div class="sub">${fmtDate(b.startedAt)} 開始・${b.players.length}人・記録 ${b.turns.length}件</div>
    </div>
    <div class="card">
      <div class="card-title">順位</div>
      ${rows.map((p) => `
        <div class="rank-row">
          <div class="pos">${rankMark(p.rank)}</div>
          <div class="info"><div class="pname">${esc(p.name)}${p.name === myName ? '<span class="badge me">あなた</span>' : ''}</div><div class="meta">記録 ${p.entries}件</div></div>
          <div class="pt">${p.score}</div>
        </div>`).join('')}
    </div>
    <button class="btn-primary" onclick="rematch()">同じメンバーでもう一度</button>
    <button class="btn-secondary" onclick="showDetail(${b.id})">記録の一覧を見る</button>
    <button class="btn-secondary danger" onclick="deleteBoard(${b.id})">🗑 この記録を削除</button>
  `;
};

const rematch = () => createBoard({ title: board.title, players: board.players.map((p) => p.name) });

/* ─── サーバとの同期 ─── */
const loadActive = async () => {
  try {
    const { boards } = await api('/boards/active');
    const changed = JSON.stringify(boards) !== JSON.stringify(activeBoards);
    activeBoards = boards || [];
    if (view === 'loading') {
      view = activeBoards.length ? 'lobby' : 'setup';
      if (view === 'setup') newBoard(); else render();
    } else if (view === 'lobby' && changed) {
      renderLobby();
    }
  } catch (err) {
    if (view === 'loading') {
      root().innerHTML = `<div class="empty">読み込みに失敗しました<br>${esc(err.message)}${err.status === 403 ? '<br><span style="font-size:12px">アクセスキー付きのリンク(?key=…)から開き直してください</span>' : ''}</div>`;
    }
  }
};

// 表示中のボードを再取得(他の端末での更新を反映)
const refreshBoard = async () => {
  if (!board) return;
  try {
    const { board: b } = await api(`/boards/${board.id}`);
    const changed = JSON.stringify(board) !== JSON.stringify(b);
    const nextView = b.status === 'playing' ? 'playing' : 'finished';
    board = b;
    if (selected !== null && selected >= b.players.length) selected = null;
    if (changed || nextView !== view) { view = nextView; render(); }
  } catch (err) {
    if (err.status === 404) { toast('このボードは削除されました'); goHome(); }
  }
};

const loadPlayers = async () => {
  try {
    const { players } = await api('/players');
    knownPlayers = players || [];
    if (view === 'setup') renderSetup();
  } catch (_) {}
};

const tick = () => {
  if (document.visibilityState !== 'visible' || busy) return;
  if (view === 'playing') refreshBoard();
  else if (view === 'lobby') loadActive();
};
setInterval(tick, 5000);
document.addEventListener('visibilitychange', tick);

/* ─── 履歴 ─── */
const loadHistory = async () => {
  const el = document.getElementById('history-root');
  try {
    const { boards } = await api('/boards?limit=100');
    if (!boards.length) { el.innerHTML = '<div class="empty">まだ記録がありません</div>'; return; }
    el.innerHTML = `<div class="card">${boards.map((b) => {
      const top = b.status === 'finished' ? leaders(b).map((p) => p.name).join('・') : '';
      return `
        <div class="game-item" onclick="showDetail(${b.id})">
          <div class="top">
            <span>${fmtDate(b.startedAt)}</span>
            <span class="badge" style="margin-left:0">${b.players.length}人</span>
            ${b.status === 'aborted' ? '<span class="badge out" style="margin-left:0">中断</span>' : ''}
          </div>
          <div class="win">${esc(boardLabel(b))}${top ? `　🏆 ${esc(top)}` : ''}</div>
          <div class="sum">${b.ranking.map((i) => b.players[i]).map((p) => `${esc(p.name)} ${p.score}`).join(' ／ ')}</div>
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
    const { board: b } = await api(`/boards/${id}`);
    const rows = b.ranking.map((i) => b.players[i]);
    content.innerHTML = `
      <div class="card">
        <div class="top" style="font-size:12px;color:#999">${fmtDate(b.startedAt)}　${b.players.length}人${b.status === 'aborted' ? '・中断' : b.status === 'playing' ? '・進行中' : ''}</div>
        <div style="font-size:18px;font-weight:800;margin:6px 0 10px">${esc(boardLabel(b))}</div>
        ${rows.map((p) => `
          <div class="rank-row">
            <div class="pos" style="font-size:14px;color:#999">${p.rank}</div>
            <div class="info"><div class="pname">${esc(p.name)}</div><div class="meta">記録 ${p.entries}件</div></div>
            <div class="pt">${p.score}</div>
          </div>`).join('')}
      </div>
      <div class="card">
        <div class="card-title">記録（${b.turns.length}件）</div>
        ${b.turns.length === 0 ? '<div class="empty">記録なし</div>' : `
        <div class="table-wrap"><table class="turns">
          <thead><tr><th>#</th><th>名前</th><th style="text-align:right">点</th><th style="text-align:right">累計</th><th>時刻</th></tr></thead>
          <tbody>
            ${b.turns.map((t, i) => `<tr>
              <td class="num">${i + 1}</td>
              <td>${esc(b.players[t.playerIndex].name)}</td>
              <td class="num ${t.points < 0 ? 'minus' : ''}">${signed(t.points)}</td>
              <td class="num">${t.scoreAfter}</td>
              <td class="time">${fmtTime(t.createdAt)}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>`}
      </div>
      <button class="btn-secondary danger" onclick="deleteBoard(${b.id})">この記録を削除</button>
    `;
  } catch (err) {
    content.innerHTML = `<div class="empty">読み込みに失敗しました<br>${esc(err.message)}</div>`;
  }
};
const closeDetail = () => document.getElementById('detail').classList.remove('open');

// ボードを記録ごと削除する。「中断」と違い履歴・成績にも残らない
const deleteBoard = async (id) => {
  if (busy) return;
  const target = (board && board.id === id) ? board : activeBoards.find((b) => b.id === id);
  const label = target ? boardLabel(target) : 'このボード';
  if (!confirm(`「${label}」を削除しますか？\n記録は残らず、履歴・成績にも含まれません。`)) return;
  busy = true;
  try {
    await api(`/boards/${id}`, { method: 'DELETE' });
    toast('削除しました');
    closeDetail();
    if (board && board.id === id) goHome();
    else { loadActive(); if (document.getElementById('tab-history').classList.contains('active')) loadHistory(); }
  } catch (err) {
    toast(err.message);
    if (err.status === 404) loadActive();
  } finally {
    busy = false;
  }
};

/* ─── 成績 ─── */
const loadStats = async () => {
  const el = document.getElementById('stats-root');
  try {
    const { players } = await api('/stats');
    if (!players.length) { el.innerHTML = '<div class="empty">まだ記録がありません</div>'; return; }
    const pct = (v) => `${Math.round(v * 100)}%`;
    el.innerHTML = `
      <div class="card">
        <div class="card-title">個人成績（終了したボードのみ）</div>
        <div class="table-wrap"><table class="stats">
          <thead><tr><th>名前</th><th>回数</th><th>1位</th><th>1位率</th><th>平均</th><th>ベスト</th></tr></thead>
          <tbody>
            ${players.map((p) => `<tr>
              <td>${esc(p.name)}${p.name === myName ? '<span class="badge me">あなた</span>' : ''}</td>
              <td>${p.games}</td>
              <td>${p.wins}</td>
              <td>${pct(p.winRate)}</td>
              <td>${p.avgScore.toFixed(1)}</td>
              <td>${p.bestScore ?? '−'}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
        <div class="hint">1位＝同点1位を含む。平均＝1ボードあたりの合計点。</div>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="empty">読み込みに失敗しました<br>${esc(err.message)}</div>`;
  }
};

/* ─── 初期化 ─── */
restoreSetup();
const hashBoard = (location.hash.match(/^#board=(\d+)$/) || [])[1];
if (hashBoard) {
  openBoard(Number(hashBoard)).then(loadActive).then(loadPlayers);
} else {
  loadActive().then(loadPlayers);
}
