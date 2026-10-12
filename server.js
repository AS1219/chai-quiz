// ChAI Quiz Buzzer — zero-dependency real-time quiz server (Node 18+)
// Live updates use Server-Sent Events (server -> browser) + small POST requests (browser -> server).
// Player page: /     Admin page: /admin     Projector screen: /screen
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PIN = String(process.env.ADMIN_PIN || 'chai123');
const DEFAULT_TIME = Number(process.env.DEFAULT_TIME) || 15;      // seconds to buzz
const POINTS = Number(process.env.POINTS) || 10;                  // points for a correct answer
const WRONG_PENALTY = Number(process.env.WRONG_PENALTY) || 0;     // points removed for a wrong answer
const QFILE = path.join(__dirname, 'questions.json');
const TFILE = path.join(__dirname, 'teams.json');
const PUBLIC = path.join(__dirname, 'public');

const clean = (s, n = 30) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { console.warn(`Could not read ${path.basename(f)}:`, e.message); return []; } };

// ---------------- teams ----------------
const TEAMS = (() => {
  const list = readJson(TFILE);
  const arr = (Array.isArray(list) ? list : []).map(t => (typeof t === 'string' ? { name: t } : t)).filter(t => t && t.name);
  return arr.map((t, i) => ({
    team: clean(t.name),
    emoji: t.emoji || '🤖',
    color: t.color || `hsl(${Math.round((i * 360) / arr.length)} 85% 68%)`,
  }));
})();
const meta = (team) => TEAMS.find(t => t.team === team) || { team, emoji: '🤖', color: '#a78bfa' };

// ---------------- state ----------------
let questions = readJson(QFILE).filter(x => x && x.q);
const players = new Map();   // clientId -> { team, name }
const streams = new Map();   // response -> { role, id }
const adminTokens = new Set();
const state = {
  index: -1,        // -1 = lobby; questions.length = finished
  phase: 'lobby',   // lobby | open | closed | ended
  openedAt: 0,
  deadline: 0,      // 0 = no time limit
  buzzes: [],       // { team, name, emoji, color, ms, result: null|'correct'|'wrong' }
  showAnswer: false,
  scores: {},       // team -> points
  people: {},       // "team::name" -> { team, name, score }
};
let closeTimer = null;

const current = () => questions[state.index] || null;
const qTime = (q) => Number(q?.time ?? DEFAULT_TIME);
const qPoints = () => Number(current()?.points ?? POINTS);
const remainingMs = () => (state.phase === 'open' && state.deadline ? Math.max(0, state.deadline - Date.now()) : 0);
const personKey = (team, name) => `${team}::${name.toLowerCase()}`;

function onlinePlayers() {
  const ids = new Set();
  for (const s of streams.values()) if (s.role === 'player' && players.has(s.id)) ids.add(s.id);
  return [...ids].map(id => players.get(id));
}
function teamMembers() {
  const m = {};
  for (const { team, name } of onlinePlayers()) (m[team] ||= new Set()).add(name);
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v]]));
}
function withRanks(rows) {
  return rows.map(r => ({ ...r, rank: 1 + rows.filter(o => o.score > r.score).length }));
}
function leaderboard() {
  const members = teamMembers();
  const rows = Object.keys(state.scores).map(team => ({ ...meta(team), score: state.scores[team], members: members[team] || [] }));
  rows.sort((a, b) => b.score - a.score || a.team.localeCompare(b.team));
  return withRanks(rows);
}
function topPeople() {
  const rows = Object.values(state.people).map(p => ({ ...p, ...meta(p.team), name: p.name }));
  rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return withRanks(rows);
}

function publicState() {
  const q = current();
  const online = onlinePlayers();
  const members = teamMembers();
  return {
    index: state.index,
    total: questions.length,
    phase: state.phase,
    question: q ? q.q : null,
    level: q?.level || null,
    answer: q && state.showAnswer ? q.a : null,
    points: qPoints(),
    timeLimit: q ? qTime(q) : 0,
    remainingMs: remainingMs(),
    buzzes: state.buzzes,
    leaderboard: leaderboard(),
    people: topPeople(),
    playerCount: online.length,
    teamCount: Object.keys(members).length,
    teamList: TEAMS.map(t => ({ ...t, count: (members[t.team] || []).length })),
  };
}
function adminState() {
  return { ...publicState(), answer: current() ? current().a : null, showAnswer: state.showAnswer, questions };
}

function send(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
function broadcast() {
  const pub = publicState(), adm = adminState();
  for (const [res, s] of streams) send(res, 'state', s.role === 'admin' ? adm : pub);
}

function addPoints(team, name, delta) {
  if (!delta) return;
  state.scores[team] = (state.scores[team] || 0) + delta;
  if (name) {
    const k = personKey(team, name);
    state.people[k] ||= { team, name, score: 0 };
    state.people[k].score += delta;
  }
}

function clearTimer() { if (closeTimer) clearTimeout(closeTimer); closeTimer = null; }
function openQuestion(index) {
  clearTimer();
  state.buzzes = []; state.showAnswer = false;
  if (index >= questions.length) { state.index = questions.length; state.phase = 'ended'; state.deadline = 0; return broadcast(); }
  state.index = Math.max(0, index);
  const secs = qTime(current());
  state.phase = 'open';
  state.openedAt = Date.now();
  state.deadline = secs > 0 ? state.openedAt + secs * 1000 : 0;
  if (state.deadline) closeTimer = setTimeout(() => { state.phase = 'closed'; broadcast(); }, secs * 1000 + 250);
  broadcast();
}

// ---------------- API handlers ----------------
const playerApi = {
  join({ id, team, name }) {
    id = clean(id, 64); team = clean(team); name = clean(name, 24);
    if (!id) return { ok: false, error: 'Missing id — reload the page' };
    if (!TEAMS.some(t => t.team === team)) return { ok: false, error: 'Please pick a team from the list' };
    if (!name) return { ok: false, error: 'Please enter your name' };
    players.set(id, { team, name });
    state.scores[team] ??= 0;
    state.people[personKey(team, name)] ??= { team, name, score: 0 };
    setImmediate(broadcast);
    return { ok: true, team, name };
  },
  buzz({ id }) {
    const now = Date.now();
    const me = players.get(clean(id, 64));
    if (!me) return { ok: false, error: 'Please join again' };
    if (state.phase !== 'open') return { ok: false, error: 'Buzzers are closed' };
    if (state.deadline && now > state.deadline) return { ok: false, error: "Time's up" };
    const i = state.buzzes.findIndex(b => b.team === me.team);
    if (i >= 0) return { ok: false, error: `${state.buzzes[i].name} already buzzed for your team`, rank: i + 1 };
    const { emoji, color } = meta(me.team);
    state.buzzes.push({ team: me.team, name: me.name, emoji, color, ms: now - state.openedAt, result: null });
    broadcast();
    return { ok: true, rank: state.buzzes.length };
  },
  auth({ pin }) {
    if (String(pin) !== ADMIN_PIN) return { ok: false, error: 'Wrong PIN' };
    const token = crypto.randomBytes(16).toString('hex');
    adminTokens.add(token);
    return { ok: true, token };
  },
};

const adminApi = {
  ping: () => {},
  next: () => openQuestion(state.index + 1),
  prev: () => openQuestion(Math.max(0, state.index - 1)),
  goto: ({ index }) => openQuestion(Math.max(0, Number(index) || 0)),
  reopen: () => openQuestion(state.index),               // clears buzzes, restarts timer
  lock: () => { clearTimer(); if (state.phase === 'open') state.phase = 'closed'; broadcast(); },
  reveal: () => { state.showAnswer = !state.showAnswer; broadcast(); },
  // mark a buzz correct / wrong (click again to undo). Points go to the team AND the person.
  mark: ({ i, result }) => {
    const b = state.buzzes[Number(i)];
    if (!b || !['correct', 'wrong'].includes(result)) return;
    const next = b.result === result ? null : result;
    const pts = (r) => (r === 'correct' ? qPoints() : r === 'wrong' ? -WRONG_PENALTY : 0);
    addPoints(b.team, b.name, pts(next) - pts(b.result));
    b.result = next;
    if (next === 'correct') { clearTimer(); if (state.phase === 'open') state.phase = 'closed'; }
    broadcast();
  },
  // manual team adjustment from the scoreboard
  award: ({ team, points }) => {
    team = clean(team);
    if (!team || !(team in state.scores)) return;
    addPoints(team, null, Number(points) || 0);
    broadcast();
  },
  end: () => openQuestion(questions.length),
  reset: () => {
    clearTimer();
    Object.assign(state, { index: -1, phase: 'lobby', buzzes: [], showAnswer: false, deadline: 0, scores: {}, people: {} });
    for (const { team, name } of onlinePlayers()) { state.scores[team] = 0; state.people[personKey(team, name)] = { team, name, score: 0 }; }
    broadcast();
  },
  questions: ({ list }) => {
    if (!Array.isArray(list)) return;
    questions = list.map(x => {
      const t = Number(x.time);
      const hasT = Number.isFinite(t) && String(x.time ?? '').trim() !== '';
      const lv = clean(x.level, 12);
      return { q: clean(x.q, 500), a: clean(x.a, 300), time: hasT ? Math.max(0, Math.min(600, t)) : DEFAULT_TIME, ...(lv ? { level: lv[0].toUpperCase() + lv.slice(1).toLowerCase() } : {}) };
    }).filter(x => x.q);
    try { fs.writeFileSync(QFILE, JSON.stringify(questions, null, 2)); } catch { /* read-only host: keep in memory */ }
    if (state.index >= questions.length && state.phase !== 'lobby') { state.index = questions.length; state.phase = 'ended'; }
    broadcast();
  },
};

// ---------------- HTTP ----------------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const ROUTES = { '/': 'index.html', '/admin': 'admin.html', '/screen': 'screen.html' };

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 200_000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (p === '/events' && req.method === 'GET') {
    let role = url.searchParams.get('role');
    if (role === 'admin' && !adminTokens.has(url.searchParams.get('token') || '')) return json(res, 401, { ok: false, error: 'Not authorised' });
    if (!['player', 'admin', 'screen'].includes(role)) role = 'player';
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 1000\n\n');
    streams.set(res, { role, id: clean(url.searchParams.get('id'), 64) });
    send(res, 'state', role === 'admin' ? adminState() : publicState());
    if (role === 'player') broadcast();
    req.on('close', () => { streams.delete(res); broadcast(); });
    return;
  }

  if (req.method === 'POST' && p.startsWith('/api/')) {
    const body = await readBody(req);
    const action = p.slice(5);
    if (action.startsWith('admin/')) {
      if (!adminTokens.has(req.headers['x-admin-token'] || '')) return json(res, 401, { ok: false, error: 'Not authorised — log in again' });
      const fn = adminApi[action.slice(6)];
      if (!fn) return json(res, 404, { ok: false, error: 'Unknown action' });
      fn(body);
      return json(res, 200, { ok: true });
    }
    const fn = playerApi[action];
    if (!fn) return json(res, 404, { ok: false, error: 'Unknown action' });
    return json(res, 200, fn(body));
  }

  const file = path.normalize(path.join(PUBLIC, ROUTES[p] || p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

setInterval(() => { for (const res of streams.keys()) res.write(': ping\n\n'); }, 15000);

server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(require('os').networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log('\n  ChAI Quiz is running\n');
  console.log(`  This computer:  http://localhost:${PORT}/`);
  for (const ip of ips) console.log(`  Same Wi-Fi/LAN: http://${ip}:${PORT}/`);
  console.log(`\n  Admin:  /admin   (PIN: ${process.env.ADMIN_PIN ? 'from ADMIN_PIN' : 'chai123 — set ADMIN_PIN to change'})`);
  console.log('  Screen: /screen  (for the projector)');
  console.log(`  ${questions.length} questions · ${TEAMS.length} teams · ${DEFAULT_TIME}s default timer · ${POINTS} pts per correct answer\n`);
});
