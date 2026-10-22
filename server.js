// Apocalisse a Domicilio — server autoritativo (Node + ws)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const W = 1600, H = 1000, TICK = 30, DT = 1 / TICK, MAXP = 6;

// Scaffali del supermercato (ostacoli)
const SHELVES = [
  { x: 300, y: 200, w: 260, h: 40 }, { x: 300, y: 420, w: 260, h: 40 }, { x: 300, y: 640, w: 260, h: 40 },
  { x: 1040, y: 200, w: 260, h: 40 }, { x: 1040, y: 420, w: 260, h: 40 }, { x: 1040, y: 640, w: 260, h: 40 },
  { x: 700, y: 340, w: 200, h: 40 }, { x: 700, y: 620, w: 200, h: 40 },
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = (v) => Math.round(v * 10) / 10;

// ---------- HTTP statico ----------
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url !== '/' && url !== '/index.html') { res.writeHead(404); return res.end('404'); }
  fs.readFile(path.join(__dirname, 'public', 'index.html'), (err, data) => {
    if (err) { res.writeHead(500); return res.end('errore'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map();

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = ''; for (let i = 0; i < 4; i++) c += A[(Math.random() * A.length) | 0]; } while (rooms.has(c));
  return c;
}
function newRoom() {
  return {
    code: makeCode(), players: new Map(), zombies: [], bullets: [], st: 'lobby',
    wave: 0, spawnLeft: 0, spawnT: 0, brk: false, breakT: 0, host: null, nid: 1, tick: 0,
  };
}
function cleanName(n) {
  return String(n || '').replace(/[<>&"]/g, '').trim().slice(0, 12) || 'Anonimo';
}
function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function addPlayer(room, ws, name) {
  const used = new Set([...room.players.values()].map((p) => p.e));
  let e = 0; while (used.has(e)) e++;
  const p = {
    id: room.nid++, ws, n: name, e,
    x: W / 2 + (Math.random() * 120 - 60), y: H / 2 + (Math.random() * 120 - 60),
    a: 0, hp: 100, d: false, rv: 0, cd: 0, sc: 0, sy: -1, syT: 0,
    in: { dx: 0, dy: 0, a: 0, s: false },
  };
  room.players.set(p.id, p);
  ws.room = room; ws.pid = p.id;
  if (!room.host) room.host = p.id;
  return p;
}

// ---------- Fisica semplice ----------
function pushOut(e, rad) {
  for (const s of SHELVES) {
    const cx = clamp(e.x, s.x, s.x + s.w), cy = clamp(e.y, s.y, s.y + s.h);
    const dx = e.x - cx, dy = e.y - cy, d2 = dx * dx + dy * dy;
    if (d2 < rad * rad) {
      if (d2 > 0.0001) { const d = Math.sqrt(d2); e.x += (dx / d) * (rad - d); e.y += (dy / d) * (rad - d); }
      else e.y -= rad;
    }
  }
  e.x = clamp(e.x, rad, W - rad); e.y = clamp(e.y, rad, H - rad);
}

// ---------- Zombie e ondate ----------
// tipo: 0 base, 1 cono in testa, 2 sposo veloce, 3 boss
function spawnZombie(r, forceBoss) {
  let x, y; const side = (Math.random() * 4) | 0;
  if (side === 0) { x = Math.random() * W; y = 10; }
  else if (side === 1) { x = Math.random() * W; y = H - 10; }
  else if (side === 2) { x = 10; y = Math.random() * H; }
  else { x = W - 10; y = Math.random() * H; }
  const w = r.wave; let type = 0; const roll = Math.random();
  if (forceBoss) type = 3;
  else if (w >= 3 && roll < 0.2) type = 2;
  else if (w >= 2 && roll < 0.4) type = 1;
  const defs = {
    0: { hp: 30 + w * 2, sp: Math.min(90, 55 + w * 2), r: 16, dmg: 8 },
    1: { hp: 80 + w * 3, sp: 48, r: 18, dmg: 10 },
    2: { hp: 22, sp: 120, r: 15, dmg: 6 },
    3: { hp: 500 + w * 40, sp: 42, r: 40, dmg: 25 },
  }[type];
  r.zombies.push({ id: r.nid++, x, y, type, hp: defs.hp, mhp: defs.hp, sp: defs.sp, r: defs.r, dmg: defs.dmg, cd: 0 });
}
function nextWave(r) {
  r.wave++;
  const count = r.players.size;
  r.spawnLeft = Math.round((4 + r.wave * 3) * (0.6 + 0.25 * count));
  r.spawnT = 0.5;
  if (r.wave % 5 === 0) spawnZombie(r, true);
}
function startGame(r) {
  r.st = 'play'; r.wave = 0; r.zombies = []; r.bullets = []; r.brk = false;
  for (const p of r.players.values()) { p.hp = 100; p.d = false; p.rv = 0; p.sc = 0; }
  nextWave(r);
}

function step(r) {
  const dt = DT;
  const players = [...r.players.values()];
  const alive = players.filter((p) => !p.d);

  for (const p of players) {
    if (p.syT > 0) { p.syT -= dt; if (p.syT <= 0) p.sy = -1; }
    p.cd -= dt;
    if (p.d) continue;
    let { dx, dy } = p.in; const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    p.x += dx * 230 * dt; p.y += dy * 230 * dt; pushOut(p, 16);
    p.a = p.in.a;
    if (p.in.s && p.cd <= 0) {
      p.cd = 0.2;
      const a = p.a + (Math.random() - 0.5) * 0.08;
      r.bullets.push({ x: p.x + Math.cos(a) * 22, y: p.y + Math.sin(a) * 22, vx: Math.cos(a) * 750, vy: Math.sin(a) * 750, life: 0.8, o: p.id });
    }
  }

  // Rianimazione: un amico vivo vicino per ~2.5 secondi
  for (const p of players) {
    if (!p.d) continue;
    const near = alive.some((q) => q !== p && Math.hypot(q.x - p.x, q.y - p.y) < 60);
    p.rv = near ? p.rv + dt / 2.5 : Math.max(0, p.rv - dt * 0.5);
    if (p.rv >= 1) { p.d = false; p.rv = 0; p.hp = 50; }
  }

  if (r.st === 'play') {
    if (r.spawnLeft > 0) {
      r.spawnT -= dt;
      if (r.spawnT <= 0) { spawnZombie(r, false); r.spawnLeft--; r.spawnT = Math.max(0.25, 0.8 - r.wave * 0.03); }
    }
    const zs = r.zombies;
    for (const z of zs) {
      z.cd -= dt;
      let t = null, bd = 1e9;
      for (const p of alive) { const d = Math.hypot(p.x - z.x, p.y - z.y); if (d < bd) { bd = d; t = p; } }
      if (t) {
        const a = Math.atan2(t.y - z.y, t.x - z.x);
        z.x += Math.cos(a) * z.sp * dt; z.y += Math.sin(a) * z.sp * dt;
        if (bd < z.r + 16 && z.cd <= 0 && !t.d) {
          t.hp -= z.dmg; z.cd = 0.7;
          if (t.hp <= 0) { t.hp = 0; t.d = true; t.rv = 0; }
        }
      }
    }
    for (let i = 0; i < zs.length; i++) for (let j = i + 1; j < zs.length; j++) {
      const a = zs[i], b = zs[j]; const dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy), m = a.r + b.r;
      if (d < m && d > 0.01) { const k = (m - d) / 2 / d; a.x -= dx * k; a.y -= dy * k; b.x += dx * k; b.y += dy * k; }
    }
    for (const z of zs) pushOut(z, z.r);
  }

  // Proiettili
  const nb = [];
  for (const b of r.bullets) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (b.life <= 0 || b.x < 0 || b.y < 0 || b.x > W || b.y > H) continue;
    if (SHELVES.some((s) => b.x > s.x && b.x < s.x + s.w && b.y > s.y && b.y < s.y + s.h)) continue;
    let hit = false;
    for (const z of r.zombies) {
      if (z.hp > 0 && Math.hypot(z.x - b.x, z.y - b.y) < z.r) {
        z.hp -= 14;
        const l = Math.hypot(b.vx, b.vy); z.x += (b.vx / l) * 5; z.y += (b.vy / l) * 5;
        if (z.hp <= 0) { const o = r.players.get(b.o); if (o) o.sc += z.type === 3 ? 100 : 10; }
        hit = true; break;
      }
    }
    if (!hit) nb.push(b);
  }
  r.bullets = nb;
  r.zombies = r.zombies.filter((z) => z.hp > 0);

  if (r.st === 'play') {
    // Fine ondata / respiro
    if (r.spawnLeft === 0 && r.zombies.length === 0) {
      if (!r.brk) {
        r.brk = true; r.breakT = 6;
        for (const p of players) { if (p.d) { p.d = false; p.rv = 0; p.hp = 60; } else p.hp = Math.min(100, p.hp + 30); }
      }
      r.breakT -= dt;
      if (r.breakT <= 0) { r.brk = false; nextWave(r); }
    } else r.brk = false;
    // Game over
    if (players.length > 0 && players.every((p) => p.d)) r.st = 'over';
  }
}

function snapshot(r) {
  return {
    t: 's', st: r.st, c: r.code, h: r.host, w: r.wave,
    bk: r.brk ? Math.max(0, Math.ceil(r.breakT)) : 0,
    zl: r.zombies.length + r.spawnLeft,
    p: [...r.players.values()].map((p) => ({
      i: p.id, n: p.n, e: p.e, x: r1(p.x), y: r1(p.y), a: Math.round(p.a * 100) / 100,
      hp: Math.round(p.hp), d: p.d ? 1 : 0, rv: Math.round(p.rv * 100) / 100, sy: p.sy, sc: p.sc,
    })),
    z: r.zombies.map((z) => [z.id, r1(z.x), r1(z.y), z.type, Math.round((z.hp / z.mhp) * 100)]),
    b: r.bullets.map((b) => [Math.round(b.x), Math.round(b.y)]),
  };
}

// ---------- WebSocket ----------
wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!ws.room) {
      if (m.t === 'create') {
        const r = newRoom(); rooms.set(r.code, r);
        const p = addPlayer(r, ws, cleanName(m.name));
        send(ws, { t: 'joined', id: p.id, code: r.code, W, H, shelves: SHELVES });
      } else if (m.t === 'join') {
        const r = rooms.get(String(m.code || '').toUpperCase().trim());
        if (!r) return send(ws, { t: 'err', m: 'Stanza non trovata' });
        if (r.players.size >= MAXP) return send(ws, { t: 'err', m: 'Stanza piena (max 6 giocatori)' });
        const p = addPlayer(r, ws, cleanName(m.name));
        send(ws, { t: 'joined', id: p.id, code: r.code, W, H, shelves: SHELVES });
      }
      return;
    }
    const r = ws.room, p = r.players.get(ws.pid);
    if (!p) return;
    if (m.t === 'in') {
      p.in.dx = clamp(+m.dx || 0, -1, 1); p.in.dy = clamp(+m.dy || 0, -1, 1);
      p.in.a = +m.a || 0; p.in.s = !!m.s;
    } else if (m.t === 'start' && r.host === p.id && r.st !== 'play') {
      startGame(r);
    } else if (m.t === 'say') {
      const k = m.k | 0;
      if (k >= 0 && k < 4) { p.sy = k; p.syT = 2.5; }
    }
  });
  ws.on('close', () => {
    const r = ws.room; if (!r) return;
    r.players.delete(ws.pid);
    if (r.players.size === 0) { rooms.delete(r.code); return; }
    if (r.host === ws.pid) r.host = [...r.players.keys()][0];
  });
  ws.on('error', () => {});
});

setInterval(() => {
  for (const r of rooms.values()) {
    step(r); r.tick++;
    if (r.tick % 2 === 0) {
      const msg = JSON.stringify(snapshot(r));
      for (const p of r.players.values()) if (p.ws.readyState === 1) p.ws.send(msg);
    }
  }
}, 1000 / TICK);

server.listen(PORT, () => console.log('Apocalisse a Domicilio in ascolto su http://localhost:' + PORT));
