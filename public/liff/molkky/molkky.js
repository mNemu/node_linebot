/* モルック得点記録ページ。YURU の static/js/molkky.js(元は gpsbot の public/molkky.html)の移植。
   サーバ側は src/molkky/api.js で、API のパスとレスポンス形式は元と同じ。
   ログインは LIFF(/liff/liffauth.js)。本人の表示名は LINE 名ではなく /api/me のニックネーム。 */
'use strict';

/* ─── 共通 ─── */
const API = '/api/molkky';
const TARGET = 50;
const TEAM_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const STORAGE_KEY = 'molkky.setup';

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

const api = (path, options) => LiffAuth.api(API + path, options);

const fmtDate = (ms) => {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const showTab = (name) => {
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.add('active');
  document.getElementById(`tabbtn-${name}`).classList.add('active');
  if (name === 'history') loadHistory();
  if (name === 'stats') loadStats();
};

/* ─── 状態 ─── */
let view = 'loading';   // lobby | setup1 | setup2 | playing | finished
let game = null;        // 表示中のゲーム(サーバから返る計算済み状態)
let activeGames = [];   // 進行中ゲーム一覧(複数同時進行可)
let busy = false;
let knownPlayers = [];
const setup = { names: [], mode: 'solo', missRule: 'reset', teamCount: 2, teams: [], title: '' };

const saveSetup = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      names: setup.names, mode: setup.mode, missRule: setup.missRule, teamCount: setup.teamCount,
    }));
  } catch (_) {}
};
const restoreSetup = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved) return;
    if (Array.isArray(saved.names)) setup.names = saved.names.filter((n) => typeof n === 'string' && n.trim());
    if (saved.mode === 'solo' || saved.mode === 'team') setup.mode = saved.mode;
    if (saved.missRule === 'reset' || saved.missRule === 'eliminate') setup.missRule = saved.missRule;
    if (Number.isInteger(saved.teamCount) && saved.teamCount >= 2) setup.teamCount = saved.teamCount;
  } catch (_) {}
};

/* ─── 開いた本人を参加者に自動追加 ─── */
// 表示名(ニックネーム)は /api/me から。一度自動追加した名前は記録し、本人がリストから消した後に勝手に戻さない。
const AUTO_ADD_KEY = 'molkky.autoAddedName';
let myName = null;

const autoAddSelf = () => {
  if (!myName) return;
  let already = null;
  try { already = localStorage.getItem(AUTO_ADD_KEY); } catch (_) {}
  if (already === myName || setup.names.includes(myName)) return;
  setup.names.unshift(myName);
  saveSetup();
  try { localStorage.setItem(AUTO_ADD_KEY, myName); } catch (_) {}
  if (view === 'setup1') renderSetup1();
  toast(`${myName} を参加者に追加しました`);
};
window.onNicknameChanged = (me) => {
  myName = String(me.name || '').trim() || null;
  autoAddSelf();
  render();
};

const root = () => document.getElementById('game-root');

const render = () => {
  if (view === 'lobby') renderLobby();
  else if (view === 'setup1') renderSetup1();
  else if (view === 'setup2') renderSetup2();
  else if (view === 'playing') renderPlaying();
  else if (view === 'finished') renderFinished();
  else root().innerHTML = '<div class="empty">読み込み中…</div>';
  LiffAuth.bindNickname();
};

// ゲームの表示名(タイトル未設定ならチーム名を並べる)
const gameLabel = (g) => g.title || g.teams.map((t) => t.name).join(' vs ');
// ニックネーム未設定のときだけ入力欄を出す(設定済みならロビーの下部に小さく)
const nickBlock = () => (myName ? '' : LiffAuth.nicknameCard());

/* ─── ロビー: 進行中ゲーム一覧 ─── */
const renderLobby = () => {
  root().innerHTML = `
    ${nickBlock()}
    <div class="card">
      <div class="card-title">進行中のゲーム(${activeGames.length})</div>
      ${activeGames.length === 0 ? '<div class="empty">進行中のゲームはありません</div>' : activeGames.map((g) => {
        const cur = g.teams[g.currentTeamIndex];
        return `
          <div class="game-item has-del" onclick="openGame(${g.id})">
            <div class="top"><span>${fmtDate(g.startedAt)} 開始</span><span class="badge" style="margin-left:0">${modeLabel(g)}</span><span>投擲 ${g.turns.length}</span></div>
            <div class="win">${esc(gameLabel(g))}</div>
            <div class="sum">次: ${esc(cur.name)}${g.mode === 'team' ? ` ／ ${esc(g.currentThrower)}` : ''}　｜　${g.teams.map((t) => `${esc(t.name)} ${t.score}${t.eliminated ? '(失格)' : t.done ? `(${t.rank}位)` : ''}`).join(' ／ ')}</div>
            <button class="game-del" title="削除" onclick="event.stopPropagation(); deleteActiveGame(${g.id})">🗑</button>
          </div>`;
      }).join('')}
    </div>
    <button class="btn-primary" onclick="newGame()">＋ 新しいゲーム</button>
    <div class="hint" style="text-align:center">複数のゲーム(コート)を同時に進められます。</div>
    ${myName ? LiffAuth.nicknameCard() : ''}
  `;
};

const newGame = () => { view = 'setup1'; render(); };
const goHome = () => {
  game = null;
  view = 'lobby';
  setGameHash(null);
  render();
  loadActive();
};
// URL の #game=ID で特定のゲームを直接開ける(他の端末とリンク共有用)
const setGameHash = (id) => {
  try { history.replaceState(null, '', id ? `#game=${id}` : location.pathname + location.search); } catch (_) {}
};
const openGame = async (id) => {
  try {
    const { game: g } = await api(`/games/${id}`);
    if (g.status === 'aborted') { toast('このゲームは中断されました'); goHome(); return; }
    game = g;
    view = g.status === 'finished' ? 'finished' : 'playing';
    setGameHash(g.id);
    render();
  } catch (err) {
    toast(err.message);
    if (view === 'loading') { view = 'lobby'; }
    loadActive();
  }
};

/* ─── セットアップ 1: 参加者 ─── */
const renderSetup1 = () => {
  const chips = knownPlayers.filter((n) => !setup.names.includes(n));
  root().innerHTML = `
    ${nickBlock()}
    <div class="card">
      <div class="card-title">参加者</div>
      <div class="input-row">
        <input type="text" id="name-input" placeholder="名前を入力" autocomplete="off" enterkeyhint="done">
        <button class="btn-sm btn-green" onclick="addName()">追加</button>
      </div>
      ${chips.length ? `<div class="chips">${chips.map((n) => `<button class="chip" onclick="addName(${attr(n)})">${esc(n)}</button>`).join('')}</div>` : ''}
      <div class="name-list">
        ${setup.names.length === 0 ? '<div class="empty">まだ参加者がいません</div>' : setup.names.map((n, i) => `
          <div class="name-row">
            <span class="idx">${i + 1}</span>
            <span class="nm">${esc(n)}</span>
            <button class="icon-btn" onclick="moveName(${i}, -1)" ${i === 0 ? 'disabled' : ''}>▲</button>
            <button class="icon-btn" onclick="moveName(${i}, 1)" ${i === setup.names.length - 1 ? 'disabled' : ''}>▼</button>
            <button class="icon-btn del" onclick="removeName(${i})">✕</button>
          </div>`).join('')}
      </div>
      ${setup.mode === 'solo' ? '<div class="hint">個人戦では上の順番で投げます。</div>' : ''}
      ${myName ? `<div class="hint">あなた「${esc(myName)}」${setup.names.includes(myName) ? 'を参加者に追加済みです。' : 'は参加者から外れています。'}${!setup.names.includes(myName) ? ` <a href="#" onclick="addName(${attr(myName)}); return false;" style="color:var(--accent)">追加する</a>` : ''}</div>` : ''}
    </div>

    <div class="card">
      <div class="card-title">対戦形式</div>
      <div class="seg">
        <button class="${setup.mode === 'solo' ? 'on' : ''}" onclick="setMode('solo')">個人戦</button>
        <button class="${setup.mode === 'team' ? 'on' : ''}" onclick="setMode('team')">チーム戦</button>
      </div>
      <div class="card-title" style="margin-top:16px">3回連続ミスのとき</div>
      <div class="seg">
        <button class="${setup.missRule === 'reset' ? 'on' : ''}" onclick="setMissRule('reset')">0点に戻す</button>
        <button class="${setup.missRule === 'eliminate' ? 'on' : ''}" onclick="setMissRule('eliminate')">失格</button>
      </div>
      <div class="hint">50点ちょうどで勝ち。50点を超えると25点に戻ります。</div>
      <div class="card-title" style="margin-top:16px">ゲーム名(任意)</div>
      <div class="input-row">
        <input type="text" id="title-input" placeholder="例: コート1" maxlength="40" value="${esc(setup.title)}" oninput="setup.title = this.value">
      </div>
      <div class="hint">複数のゲームを同時に進めるときの目印になります。</div>
    </div>

    ${setup.mode === 'team'
      ? `<button class="btn-primary" onclick="goSetup2()" ${setup.names.length < 2 ? 'disabled' : ''}>次へ:チーム分け</button>`
      : `<button class="btn-primary" onclick="startSolo()" ${setup.names.length < 2 ? 'disabled' : ''}>ゲーム開始</button>`}
    ${activeGames.length ? '<button class="btn-secondary" onclick="goHome()">‹ 進行中のゲーム一覧へ</button>' : ''}
  `;
  const input = document.getElementById('name-input');
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addName(); } });
};

const addName = (name) => {
  const input = document.getElementById('name-input');
  const value = String(name ?? (input ? input.value : '')).trim();
  if (!value) return;
  if (setup.names.includes(value)) { toast('同じ名前がすでにあります'); return; }
  setup.names.push(value);
  saveSetup();
  renderSetup1();
  if (name == null) document.getElementById('name-input').focus();
};
const removeName = (i) => { setup.names.splice(i, 1); saveSetup(); renderSetup1(); };
const moveName = (i, dir) => {
  const j = i + dir;
  if (j < 0 || j >= setup.names.length) return;
  [setup.names[i], setup.names[j]] = [setup.names[j], setup.names[i]];
  saveSetup(); renderSetup1();
};
const setMode = (mode) => { setup.mode = mode; saveSetup(); renderSetup1(); };
const setMissRule = (rule) => { setup.missRule = rule; saveSetup(); renderSetup1(); };

/* ─── セットアップ 2: チーム分け ─── */
const defaultTeamName = (i) => `チーム ${TEAM_LETTERS[i] || i + 1}`;

const shuffleTeams = () => {
  const count = Math.min(Math.max(setup.teamCount, 2), setup.names.length);
  setup.teamCount = count;
  const pool = [...setup.names];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const prevNames = setup.teams.map((t) => t.name);
  setup.teams = Array.from({ length: count }, (_, i) => ({
    name: prevNames.length === count && prevNames[i] ? prevNames[i] : defaultTeamName(i),
    members: [],
  }));
  pool.forEach((n, i) => setup.teams[i % count].members.push(n));
  saveSetup();
};

const goSetup2 = () => {
  if (setup.names.length < 2) return;
  // 参加者が変わっていればチームを作り直す
  const inTeams = setup.teams.flatMap((t) => t.members);
  const same = inTeams.length === setup.names.length && setup.names.every((n) => inTeams.includes(n));
  if (!same || setup.teams.length < 2) shuffleTeams();
  view = 'setup2';
  render();
};

const renderSetup2 = () => {
  const maxTeams = setup.names.length;
  root().innerHTML = `
    <div class="card">
      <div class="card-title">チーム数</div>
      <div class="input-row">
        <input type="number" id="team-count" min="2" max="${maxTeams}" value="${setup.teamCount}" inputmode="numeric">
        <button class="btn-sm btn-green" onclick="applyTeamCount()">🔀 シャッフル</button>
      </div>
      <div class="hint">参加者 ${setup.names.length} 人をランダムに均等配分します。名前をタップすると次のチームへ移動できます。チーム名は編集できます。</div>
    </div>
    ${setup.teams.map((t, ti) => `
      <div class="team-box">
        <input type="text" value="${esc(t.name)}" placeholder="${esc(defaultTeamName(ti))}" oninput="setTeamName(${ti}, this.value)">
        <div class="chips">
          ${t.members.length === 0 ? '<span class="hint" style="margin-top:0">(メンバーなし)</span>' : t.members.map((m, mi) => `<button class="chip member" onclick="moveMember(${ti}, ${mi})">${esc(m)} ›</button>`).join('')}
        </div>
      </div>`).join('')}
    <button class="btn-primary" onclick="startTeam()" ${setup.teams.some((t) => t.members.length === 0) ? 'disabled' : ''}>ゲーム開始</button>
    <button class="btn-secondary" onclick="view = 'setup1'; render()">‹ 参加者の編集に戻る</button>
  `;
};

const applyTeamCount = () => {
  const v = parseInt(document.getElementById('team-count').value, 10);
  if (!Number.isInteger(v) || v < 2 || v > setup.names.length) {
    toast(`チーム数は 2〜${setup.names.length} で指定してください`);
    return;
  }
  if (v !== setup.teamCount) setup.teams = []; // 数が変わればチーム名もリセット
  setup.teamCount = v;
  shuffleTeams();
  renderSetup2();
};
const setTeamName = (ti, value) => { setup.teams[ti].name = value; };
const moveMember = (ti, mi) => {
  const [m] = setup.teams[ti].members.splice(mi, 1);
  setup.teams[(ti + 1) % setup.teams.length].members.push(m);
  renderSetup2();
};

/* ─── ゲーム開始 ─── */
const startGame = async (payload) => {
  if (busy) return;
  busy = true;
  try {
    const { game: g } = await api('/games', { method: 'POST', body: JSON.stringify(payload) });
    game = g;
    view = 'playing';
    setGameHash(g.id);
    render();
    loadPlayers();
    loadActive();
  } catch (err) {
    toast(err.message);
  } finally {
    busy = false;
  }
};
const startSolo = () => startGame({
  mode: 'solo', missRule: setup.missRule, title: setup.title,
  teams: setup.names.map((n) => ({ name: n, members: [n] })),
});
const startTeam = () => startGame({
  mode: 'team', missRule: setup.missRule, title: setup.title,
  teams: setup.teams.map((t, i) => ({ name: (t.name || '').trim() || defaultTeamName(i), members: t.members })),
});

/* ─── 対戦中 ─── */
const missDots = (n) => `<span class="miss">${[0, 1, 2].map((i) => `<span class="${i < n ? 'on' : ''}">●</span>`).join('')}</span>`;

const teamBadge = (t) => {
  if (t.done && t.rank) return `<span class="badge win">${t.rank === 1 ? '🏆 ' : ''}${t.rank}位</span>`;
  if (t.eliminated) return '<span class="badge out">失格</span>';
  return '';
};

const teamCardHtml = (t, i, opts = {}) => {
  const cls = ['team-card'];
  if (opts.turn) cls.push('turn');
  if (t.eliminated) cls.push('out');
  if (t.done) cls.push('done');
  const members = t.members.length > 1 || t.members[0] !== t.name
    ? `<div class="members">${t.members.map((m) => (opts.turn && m === game.currentThrower ? `<b>${esc(m)}</b>` : esc(m))).join('・')}</div>`
    : '';
  return `
    <div class="${cls.join(' ')}">
      <div class="info">
        <div class="tname">${esc(t.name)}${teamBadge(t)}</div>
        ${members}
        ${t.eliminated || t.done ? '' : missDots(t.consecutiveMisses)}
      </div>
      <div class="score">
        <div class="pt">${t.score}</div>
        <div class="left">${t.eliminated || t.done ? '&nbsp;' : `あと ${TARGET - t.score}`}</div>
      </div>
    </div>`;
};

const renderPlaying = () => {
  const cur = game.teams[game.currentTeamIndex];
  const isTeam = game.mode === 'team';
  const doneTeams = game.teams.filter((t) => t.done);
  root().innerHTML = `
    <div class="topbar">
      <button class="btn-sm btn-light" onclick="goHome()">‹ 一覧</button>
      <span class="topbar-title">${esc(gameLabel(game))}</span>
    </div>
    <div class="now">
      <div class="lbl">次の投擲${game.playOn && doneTeams.length ? `　｜　${doneTeams.map((t) => `${t.rank}位 ${esc(t.name)}`).join('・')} 確定、残り ${game.activeCount} チームで順位決め中` : ''}</div>
      <div class="who">${isTeam ? `${esc(cur.name)} ／ ${esc(game.currentThrower)}` : esc(game.currentThrower)}</div>
      <div class="sub">${cur.score} 点 → あと ${TARGET - cur.score} 点${game.missRule === 'eliminate' ? '　※3連続ミスで失格' : '　※3連続ミスで0点'}</div>
    </div>
    ${game.teams.map((t, i) => teamCardHtml(t, i, { turn: i === game.currentTeamIndex })).join('')}
    <div class="card" style="margin-top:12px">
      <div class="card-title">倒れた本数 → 点数を入力(1本なら番号、2本以上なら本数)</div>
      <div class="pad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((p) => `<button class="pad-btn" onclick="addPoints(${p})">${p}</button>`).join('')}
        <button class="pad-btn zero" onclick="addPoints(0)">0(ミス)</button>
      </div>
      <div class="pad-actions">
        <button class="btn-sm btn-light" onclick="undo()" ${game.turns.length === 0 ? 'disabled' : ''}>↩ 取り消し</button>
        <button class="btn-sm btn-light" onclick="abortGame()">中断</button>
        <button class="btn-sm btn-danger" onclick="deleteActiveGame(game.id)" title="このゲームを削除">🗑 削除</button>
      </div>
      <div class="hint">投擲数 ${game.turns.length}　${game.turns.length ? `最後: ${esc(game.turns[game.turns.length - 1].thrower)} ${game.turns[game.turns.length - 1].points}点` : ''}</div>
    </div>
  `;
};

const eventMessage = (g) => {
  const last = g.turns[g.turns.length - 1];
  if (!last) return null;
  const team = g.teams[last.teamIndex];
  switch (last.event) {
    case 'bust': return `${team.name}:50点を超えたので25点に戻ります`;
    case 'resetZero': return `${team.name}:3回連続ミス!0点に戻ります`;
    case 'eliminated': return `${team.name}:3回連続ミスで失格`;
    case 'win': return `🎉 ${team.name} の勝利!`;
    case 'goal': return `🏁 ${team.name} が50点到達!(${team.rank}位)`;
    default: return null;
  }
};

const setPadDisabled = (disabled) => {
  document.querySelectorAll('.pad-btn, .pad-actions button').forEach((b) => { b.disabled = disabled; });
};

const addPoints = async (points) => {
  if (busy || !game) return;
  busy = true;
  setPadDisabled(true);
  try {
    const { game: g } = await api(`/games/${game.id}/turns`, { method: 'POST', body: JSON.stringify({ points }) });
    game = g;
    const msg = eventMessage(g);
    if (msg) toast(msg, 2600);
    view = g.finished ? 'finished' : 'playing';
    render();
  } catch (err) {
    toast(err.message);
    if (err.status === 409 || err.status === 404) await refreshGame();
    else render();
  } finally {
    busy = false;
  }
};

const undo = async () => {
  if (busy || !game) return;
  busy = true;
  try {
    const { game: g } = await api(`/games/${game.id}/turns/last`, { method: 'DELETE' });
    game = g;
    view = 'playing';
    render();
    toast('1投を取り消しました');
  } catch (err) {
    toast(err.message);
    if (err.status === 404) goHome();
  } finally {
    busy = false;
  }
};

// 最初の50点到達後、残りチームで続行(2位以下を決める)
const continueGame = async () => {
  if (busy || !game) return;
  busy = true;
  try {
    const { game: g } = await api(`/games/${game.id}/continue`, { method: 'POST' });
    game = g;
    view = 'playing';
    render();
    toast(`残り ${g.activeCount} チームで続行します`);
  } catch (err) {
    toast(err.message);
    if (err.status === 404) goHome();
  } finally {
    busy = false;
  }
};

const abortGame = async () => {
  if (busy || !game) return;
  if (!confirm('このゲームを中断しますか?(記録は履歴に「中断」として残ります)')) return;
  busy = true;
  try {
    await api(`/games/${game.id}/abort`, { method: 'POST' });
    goHome();
  } catch (err) {
    toast(err.message);
  } finally {
    busy = false;
  }
};

/* ─── 終了 ─── */
// 順位順に並べる。終了時はサーバが全チームに rank を付ける。未終了なら到達順 → 得点順 → 失格
const rankTeams = (g) => g.teams
  .map((t, i) => ({ ...t, index: i }))
  .sort((a, b) => {
    if (a.rank && b.rank) return a.rank - b.rank;
    if (a.rank || b.rank) return a.rank ? -1 : 1;
    if (a.index === g.winnerIndex) return -1;
    if (b.index === g.winnerIndex) return 1;
    if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
    return b.score - a.score || a.index - b.index;
  });

const renderFinished = () => {
  const ranked = rankTeams(game);
  const medal = ['🥇', '🥈', '🥉'];
  root().innerHTML = `
    <div class="topbar">
      <button class="btn-sm btn-light" onclick="goHome()">‹ 一覧</button>
      <span class="topbar-title">${esc(gameLabel(game))}</span>
    </div>
    <div class="now done">
      <div class="lbl">ゲーム終了</div>
      <div class="who">🎉 ${esc(game.teams[game.winnerIndex].name)} の勝利!</div>
      <div class="sub">投擲数 ${game.turns.length}</div>
    </div>
    ${game.canContinue ? `
    <div class="card" style="border:2px solid var(--accent)">
      <div class="card-title">まだ ${game.activeCount} チーム残っています</div>
      <div class="hint" style="margin-top:0">続けると残りのチームで 2 位以下を決められます。1 位はそのまま確定します。</div>
      <button class="btn-primary" style="margin-top:10px" onclick="continueGame()">🏁 残りのチームで続ける</button>
    </div>` : ''}
    <div class="card">
      <div class="card-title">順位</div>
      ${ranked.map((t, pos) => `
        <div class="rank-row">
          <div class="pos">${medal[pos] || `${pos + 1}.`}</div>
          <div class="info">
            <div class="tname">${esc(t.name)}${t.eliminated ? '<span class="badge out">失格</span>' : ''}</div>
            ${t.members.length > 1 || t.members[0] !== t.name ? `<div class="members">${t.members.map(esc).join('・')}</div>` : ''}
          </div>
          <div class="pt">${t.score}</div>
        </div>`).join('')}
      ${game.canContinue ? '<div class="hint">※ 2 位以下は現時点の得点順です。</div>' : ''}
    </div>
    <button class="btn-primary" onclick="rematch()">同じ${game.mode === 'team' ? 'チーム' : 'メンバー'}でもう一度</button>
    ${game.mode === 'team' ? '<button class="btn-secondary" onclick="reteam()">🔀 チームを組み直す</button>' : ''}
    <button class="btn-secondary" onclick="undo()">↩ 最後の1投を取り消す</button>
    <button class="btn-secondary" onclick="finishToSetup()">終了</button>
    <button class="btn-secondary danger" onclick="deleteActiveGame(game.id)">🗑 この記録を削除</button>
  `;
};

const rematch = () => startGame({
  mode: game.mode, missRule: game.missRule, title: game.title,
  teams: game.teams.map((t) => ({ name: t.name, members: t.members })),
});
const reteam = () => {
  setup.names = game.teams.flatMap((t) => t.members);
  setup.mode = 'team';
  setup.missRule = game.missRule;
  setup.title = game.title || '';
  setup.teamCount = game.teams.length;
  setup.teams = [];
  shuffleTeams();
  game = null;
  view = 'setup2';
  render();
};
const finishToSetup = () => {
  setup.names = game.teams.flatMap((t) => t.members);
  setup.mode = game.mode;
  setup.missRule = game.missRule;
  setup.title = game.title || '';
  saveSetup();
  goHome();
};

/* ─── サーバとの同期 ─── */
// 進行中ゲーム一覧を取得。初回は一覧の有無で表示先を決める
const loadActive = async () => {
  try {
    const { games } = await api('/games/active');
    const changed = JSON.stringify(games) !== JSON.stringify(activeGames);
    activeGames = games || [];
    if (view === 'loading') {
      view = activeGames.length ? 'lobby' : 'setup1';
      render();
    } else if (view === 'lobby' && changed) {
      renderLobby();
    }
  } catch (err) {
    if (view === 'loading') { root().innerHTML = `<div class="empty">読み込みに失敗しました<br>${esc(err.message)}</div>`; }
  }
};

// 表示中のゲームを再取得(他の端末での更新を反映)
const refreshGame = async () => {
  if (!game) return;
  try {
    const { game: g } = await api(`/games/${game.id}`);
    if (g.status === 'aborted') { toast('このゲームは中断されました'); goHome(); return; }
    const changed = JSON.stringify(game) !== JSON.stringify(g);
    game = g;
    const nextView = g.status === 'finished' ? 'finished' : 'playing';
    if (changed || nextView !== view) { view = nextView; render(); }
  } catch (err) {
    if (err.status === 404) { toast('このゲームは削除されました'); goHome(); }
  }
};

const loadPlayers = async () => {
  try {
    const { players } = await api('/players');
    knownPlayers = players || [];
    if (view === 'setup1') renderSetup1();
  } catch (_) {}
};

setInterval(() => {
  if (document.visibilityState !== 'visible' || busy) return;
  if (view === 'playing') refreshGame();
  else if (view === 'lobby') loadActive();
}, 5000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || busy) return;
  if (view === 'playing') refreshGame();
  else if (view === 'lobby') loadActive();
});

/* ─── 履歴 ─── */
const modeLabel = (g) => (g.mode === 'team' ? 'チーム戦' : '個人戦');
const ruleLabel = (g) => (g.missRule === 'eliminate' ? '失格' : '0点戻し');

const loadHistory = async () => {
  const el = document.getElementById('history-root');
  try {
    const { games } = await api('/games?limit=100');
    if (!games.length) { el.innerHTML = '<div class="empty">まだ記録がありません</div>'; return; }
    el.innerHTML = `<div class="card">${games.map((g) => {
      const winner = g.status === 'finished' && g.winnerIndex != null ? g.teams[g.winnerIndex] : null;
      return `
        <div class="game-item" onclick="showDetail(${g.id})">
          <div class="top">
            <span>${fmtDate(g.startedAt)}</span>
            <span class="badge" style="margin-left:0">${modeLabel(g)}</span>
            <span class="badge" style="margin-left:0">${ruleLabel(g)}</span>
            ${g.status === 'aborted' ? '<span class="badge out" style="margin-left:0">中断</span>' : ''}
          </div>
          <div class="win">${winner ? `🏆 ${esc(winner.name)}` : '(勝者なし)'}</div>
          <div class="sum">${g.teams.map((t) => `${esc(t.name)} ${t.score}${t.eliminated ? '(失格)' : ''}`).join(' ／ ')}</div>
        </div>`;
    }).join('')}</div>`;
  } catch (err) {
    el.innerHTML = `<div class="empty">読み込みに失敗しました<br>${esc(err.message)}</div>`;
  }
};

const eventLabel = (ev) => ({ bust: '→25', resetZero: '→0', eliminated: '失格', win: '勝利', goal: '到達' }[ev] || '');

const showDetail = async (id) => {
  const content = document.getElementById('detail-content');
  content.innerHTML = '<div class="empty">読み込み中…</div>';
  document.getElementById('detail').classList.add('open');
  try {
    const { game: g } = await api(`/games/${id}`);
    const ranked = rankTeams(g);
    const winner = g.winnerIndex != null ? g.teams[g.winnerIndex] : null;
    content.innerHTML = `
      <div class="card">
        <div class="top" style="font-size:12px;color:#999">${fmtDate(g.startedAt)}　${modeLabel(g)}・${ruleLabel(g)}${g.status === 'aborted' ? '・中断' : ''}</div>
        <div style="font-size:18px;font-weight:800;margin:6px 0 10px">${winner ? `🏆 ${esc(winner.name)} の勝利` : '(勝者なし)'}</div>
        ${ranked.map((t, pos) => `
          <div class="rank-row">
            <div class="pos" style="font-size:14px;color:#999">${pos + 1}</div>
            <div class="info">
              <div class="tname">${esc(t.name)}${t.eliminated ? '<span class="badge out">失格</span>' : ''}</div>
              ${t.members.length > 1 || t.members[0] !== t.name ? `<div class="members">${t.members.map(esc).join('・')}</div>` : ''}
            </div>
            <div class="pt">${t.score}</div>
          </div>`).join('')}
      </div>
      <div class="card">
        <div class="card-title">投擲ログ(${g.turns.length} 投)</div>
        ${g.turns.length === 0 ? '<div class="empty">投擲なし</div>' : `
        <div class="table-wrap"><table class="turns">
          <thead><tr><th>#</th><th>チーム</th><th>投擲者</th><th style="text-align:right">点</th><th style="text-align:right">累計</th><th></th></tr></thead>
          <tbody>
            ${g.turns.map((t, i) => `<tr>
              <td class="num">${i + 1}</td>
              <td>${esc(g.teams[t.teamIndex].name)}</td>
              <td>${esc(t.thrower)}</td>
              <td class="num">${t.points}</td>
              <td class="num">${t.scoreAfter}</td>
              <td class="ev">${eventLabel(t.event)}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>`}
      </div>
      <button class="btn-secondary danger" onclick="deleteGame(${g.id})">この記録を削除</button>
    `;
  } catch (err) {
    content.innerHTML = `<div class="empty">読み込みに失敗しました<br>${esc(err.message)}</div>`;
  }
};
const closeDetail = () => document.getElementById('detail').classList.remove('open');

// 進行中(または表示中)のゲームを記録ごと削除する。「中断」と違い履歴にも残らない
const deleteActiveGame = async (id) => {
  if (busy) return;
  const target = (game && game.id === id) ? game : activeGames.find((g) => g.id === id);
  const label = target ? gameLabel(target) : 'このゲーム';
  if (!confirm(`「${label}」を削除しますか?\n記録は残らず、履歴・成績にも含まれません。`)) return;
  busy = true;
  try {
    await api(`/games/${id}`, { method: 'DELETE' });
    toast('削除しました');
    if (game && game.id === id) goHome();
    else loadActive();
  } catch (err) {
    toast(err.message);
    if (err.status === 404) loadActive();
  } finally {
    busy = false;
  }
};

const deleteGame = async (id) => {
  if (!confirm('この記録を削除しますか?(成績からも除外されます)')) return;
  try {
    await api(`/games/${id}`, { method: 'DELETE' });
    closeDetail();
    toast('削除しました');
    loadHistory();
  } catch (err) {
    toast(err.message);
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
        <div class="card-title">個人成績(終了した試合のみ)</div>
        <div class="table-wrap"><table class="stats">
          <thead><tr><th>名前</th><th>試合</th><th>勝</th><th>勝率</th><th>投</th><th>平均</th><th>12点</th><th>0点率</th></tr></thead>
          <tbody>
            ${players.map((p) => `<tr>
              <td>${esc(p.name)}</td>
              <td>${p.games}</td>
              <td>${p.wins}</td>
              <td>${pct(p.winRate)}</td>
              <td>${p.throws}</td>
              <td>${p.avgPoints.toFixed(1)}</td>
              <td>${p.twelves}</td>
              <td>${pct(p.zeroRate)}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
        <div class="hint">勝＝所属チームが勝った試合数。平均＝1投あたりの得点。</div>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="empty">読み込みに失敗しました<br>${esc(err.message)}</div>`;
  }
};

/* ─── 初期化 ─── */
(async () => {
  try {
    const { me } = await LiffAuth.init();
    myName = String(me.name || '').trim() || null;
  } catch (err) {
    root().innerHTML = `<div class="empty">ログインできませんでした<br>${esc(err.message)}</div>`;
    return;
  }
  restoreSetup();
  autoAddSelf();
  const hashGame = (location.hash.match(/^#game=(\d+)$/) || [])[1];
  if (hashGame) {
    openGame(Number(hashGame)).then(() => loadActive()).then(loadPlayers);
  } else {
    loadActive().then(loadPlayers);
  }
})();
