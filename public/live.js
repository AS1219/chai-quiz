// Shared client helpers for all pages
async function api(action, body = {}, token) {
  try {
    const r = await fetch('/api/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'x-admin-token': token } : {}) },
      body: JSON.stringify(body),
    });
    return await r.json();
  } catch { return { ok: false, error: 'Network problem — try again' }; }
}

// Live stream: onState(state) on every update, onConn(true/false) on connection changes.
function live(params, onState, onConn) {
  const es = new EventSource('/events?' + new URLSearchParams(params));
  es.addEventListener('state', (e) => onState(JSON.parse(e.data)));
  es.onopen = () => onConn?.(true);
  es.onerror = () => onConn?.(false); // EventSource reconnects automatically
  return es;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

function toast(msg) {
  const t = el('div', 'toast', msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 1900);
}

// Team chip: t = { team, emoji, color }
function chip(t, cls = '') {
  const s = el('span', 'chip ' + cls);
  s.style.setProperty('--tc', t.color || '#a78bfa');
  s.append(el('span', 'emo', t.emoji || '🤖'), el('span', '', t.team));
  return s;
}

// One buzz row: person name + team chip + timing (+ optional extra nodes, e.g. admin buttons)
function buzzRow(b, i, all, extra = []) {
  const li = el('li', 'r' + (i + 1) + (b.result ? ' ' + b.result : ''));
  const who = el('div', 'who');
  who.append(el('b', '', b.name), chip(b));
  const t = i === 0 ? (b.ms / 1000).toFixed(2) + 's' : '+' + ((b.ms - all[0].ms) / 1000).toFixed(2) + 's';
  li.append(el('div', 'rank', i + 1), who);
  if (b.result) li.append(el('span', 'res ' + b.result, b.result === 'correct' ? '✓ Correct' : '✗ Wrong'));
  li.append(el('div', 'ms', t), ...extra);
  return li;
}

// Team leaderboard rows
function teamRows(rows, myTeam, extraFor) {
  return rows.map(r => {
    const li = el('li', 'rk' + r.rank + (r.team === myTeam ? ' me' : ''));
    const info = el('div', 'info');
    info.append(chip(r));
    if (r.members?.length) info.append(el('span', 'mem', r.members.join(', ')));
    li.append(el('div', 'rank', r.rank), info, el('div', 'pts', r.score));
    if (extraFor) li.append(...extraFor(r));
    return li;
  });
}

// Individual leaderboard rows
function personRows(rows, me) {
  return rows.map(r => {
    const li = el('li', 'rk' + r.rank + (me && r.name === me.name && r.team === me.team ? ' me' : ''));
    const info = el('div', 'info');
    info.append(el('span', 'pname', r.name), chip(r));
    li.append(el('div', 'rank', r.rank), info, el('div', 'pts', r.score));
    return li;
  });
}

// Podium for top 3 teams (display order 2-1-3)
function podium(rows) {
  const top = rows.slice(0, 3);
  const order = [top[1], top[0], top[2]];
  return order.map((r, i) => {
    const place = [2, 1, 3][i];
    const d = el('div', 'pod p' + place);
    if (!r) { d.style.visibility = 'hidden'; d.append(el('div', 'block', place)); return d; }
    d.append(el('div', 'pemo', r.emoji), el('div', 'pteam', r.team), el('div', 'pscore', r.score + ' pts'), el('div', 'block', r.rank));
    return d;
  });
}

function levelPill(level) {
  if (!level) return null;
  const s = el('span', 'lvl lvl-' + level.toLowerCase(), level);
  return s;
}

function rankWord(n) { return n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : (n % 10 < 4 ? n % 10 : 0)] || 'th'); }
