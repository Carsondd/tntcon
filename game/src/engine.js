/* ============================================================
   Hollow Bastion — simulation
   State, grid, flow-field pathing, combat, economy, persistence.
   ============================================================ */
(function (global) {
  'use strict';

  var D = global.Defs;
  var TILE = D.TILE, GW = D.GW, GH = D.GH;
  var W = GW * TILE, H = GH * TILE;
  var SAVE_KEY = 'hollowBastion.save.v1';
  var uid = 0;

  var G = null;              // live state
  var dist = new Float32Array(GW * GH);
  var fieldDirty = true, fieldCooldown = 0;
  var listeners = { log: [], banner: [], modal: [], sfx: [] };

  // ---------- small helpers ----------
  function idx(gx, gy) { return gy * GW + gx; }
  function inGrid(gx, gy) { return gx >= 0 && gy >= 0 && gx < GW && gy < GH; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function dist2(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
  function emit(kind, a, b) { listeners[kind].forEach(function (f) { f(a, b); }); }
  function log(msg, cls) { emit('log', msg, cls); }
  function sfx(name, vol) { emit('sfx', name, vol); }

  function fresh() {
    return {
      time: 0, speed: 1, paused: false, sound: true,
      res: { scrap: 150, cores: 0 },
      wave: 0, maxWave: 0, waveState: 'prep', waveTimer: 30, waveTotal: 0, waveKilled: 0,
      spawnQueue: [], spawnTimer: 0,
      buildings: [], grid: new Array(GW * GH).fill(null),
      enemies: [], projectiles: [], particles: [], floaters: [], beams: [], soldiers: [], rubble: [],
      tech: {}, relics: 0, kills: 0, overruns: 0,
      power: { gen: 0, use: 0, eff: 1 },
      prod: { scrap: 0, cores: 0 },
      core: null, selected: null, ghost: null,
      lastSaved: Date.now(), born: Date.now(), dirtyUI: true
    };
  }

  // ---------- modifiers ----------
  function tech(id) { return G.tech[id] || 0; }
  function relicMult() { return 1 + G.relics * 0.06; }
  function techMult(id, step) { return 1 + tech(id) * step; }

  function maxHpOf(b) {
    return Math.round(b.def.hp * D.hpScale(b.lvl) * techMult('hp', 0.15));
  }
  function dmgOf(b) { return b.def.dmg * D.statScale(b.lvl) * techMult('dmg', 0.12) * relicMult(); }
  function rateOf(b) { return b.def.rate * techMult('rate', 0.08); }
  function rangeOf(b) { return (b.def.range || 0) * techMult('range', 0.05); }
  function powerUse(b) { return (b.def.power || 0) * D.powerScale(b.lvl); }
  function powerGen(b) { return (b.def.powerGen || 0) * D.statScale(b.lvl); }
  function prodOf(b, key) {
    if (!b.def.produce || !b.def.produce[key]) return 0;
    var v = b.def.produce[key] * D.statScale(b.lvl) * relicMult();
    if (key === 'scrap') v *= techMult('mine', 0.16);
    return v;
  }
  function effCost(type) {
    var def = D.BUILDINGS[type];
    var disc = clamp(1 - tech('thrift') * 0.025, 0.5, 1);
    return Math.ceil(def.cost * disc);
  }
  function unlocked(type) {
    var def = D.BUILDINGS[type];
    return G.maxWave >= (def.unlock || 0);
  }

  // ============================================================
  //  Structures
  // ============================================================
  function occupy(b, ref) {
    for (var y = 0; y < b.h; y++) {
      for (var x = 0; x < b.w; x++) {
        if (inGrid(b.gx + x, b.gy + y)) G.grid[idx(b.gx + x, b.gy + y)] = ref;
      }
    }
  }

  function makeBuilding(type, gx, gy, lvl, hp) {
    var def = D.BUILDINGS[type];
    var b = {
      id: ++uid, type: type, def: def, gx: gx, gy: gy,
      w: def.w || 1, h: def.h || 1, lvl: lvl || 1,
      cd: Math.random() * 0.5, angle: -Math.PI / 2, flash: 0, anim: Math.random() * 6.28,
      dead: false, spawnAnim: 1, drones: []
    };
    b.cx = gx * TILE + b.w * TILE / 2;
    b.cy = gy * TILE + b.h * TILE / 2;
    b.maxHp = maxHpOf(b);
    b.hp = hp != null ? Math.min(hp, b.maxHp) : b.maxHp;
    G.buildings.push(b);
    occupy(b, b);
    fieldDirty = true;
    return b;
  }

  function canPlace(type, gx, gy) {
    var def = D.BUILDINGS[type];
    if (!def || def.hidden) return false;
    var bw = def.w || 1, bh = def.h || 1;
    for (var y = 0; y < bh; y++) {
      for (var x = 0; x < bw; x++) {
        var tx = gx + x, ty = gy + y;
        if (!inGrid(tx, ty)) return false;
        if (tx < D.BORDER || ty < D.BORDER || tx >= GW - D.BORDER || ty >= GH - D.BORDER) return false;
        if (G.grid[idx(tx, ty)]) return false;
      }
    }
    return true;
  }

  function tryPlace(type, gx, gy) {
    if (!unlocked(type)) { log('Locked until wave ' + D.BUILDINGS[type].unlock + '.', 'warn'); sfx('deny'); return false; }
    if (!canPlace(type, gx, gy)) { sfx('deny'); return false; }
    var cost = effCost(type);
    if (G.res.scrap < cost) { log('Not enough scrap for ' + D.BUILDINGS[type].name + '.', 'warn'); sfx('deny'); return false; }
    G.res.scrap -= cost;
    var b = makeBuilding(type, gx, gy);
    burst(b.cx, b.cy, 8, '#c8cede', 40);
    sfx('build');
    G.dirtyUI = true;
    return b;
  }

  function investedIn(b) {
    var total = D.BUILDINGS[b.type].cost;
    for (var l = 1; l < b.lvl; l++) total += D.upgradeCost(b.def, l);
    return total;
  }

  function sell(b) {
    if (!b || b.type === 'core') return;
    var refund = Math.floor(investedIn(b) * 0.5 * (b.hp / b.maxHp * 0.5 + 0.5));
    G.res.scrap += refund;
    destroy(b, false);
    floater(b.cx, b.cy, '+' + refund, '#f0b54a');
    sfx('sell');
    G.dirtyUI = true;
  }

  function upgrade(b) {
    if (!b || b.type === 'core') return false;
    var cost = D.upgradeCost(b.def, b.lvl);
    if (G.res.scrap < cost) { sfx('deny'); return false; }
    G.res.scrap -= cost;
    var frac = b.hp / b.maxHp;
    b.lvl++;
    b.maxHp = maxHpOf(b);
    b.hp = Math.min(b.maxHp, b.maxHp * frac + b.maxHp * 0.15);
    b.spawnAnim = 1;
    burst(b.cx, b.cy, 10, '#4fd1c5', 50);
    floater(b.cx, b.cy - 6, 'LV ' + b.lvl, '#4fd1c5');
    sfx('upgrade');
    G.dirtyUI = true;
    return true;
  }

  function repairCost(b) {
    if (b.hp >= b.maxHp) return 0;
    var base = D.BUILDINGS[b.type].repairBase || D.BUILDINGS[b.type].cost;
    return Math.ceil((1 - b.hp / b.maxHp) * (base * 0.45 * b.lvl + 4));
  }

  function repairAll() {
    var spent = 0;
    G.buildings.forEach(function (b) {
      if (b.dead || b.hp >= b.maxHp) return;
      var c = repairCost(b);
      if (G.res.scrap - spent < c) return;
      spent += c;
      b.hp = b.maxHp;
    });
    if (spent > 0) {
      G.res.scrap -= spent;
      log('Repairs complete (-' + spent + ' scrap).', 'good');
      sfx('upgrade');
    } else sfx('deny');
    G.dirtyUI = true;
  }

  function destroy(b, violent) {
    if (b.dead) return;
    b.dead = true;
    occupy(b, null);
    var i = G.buildings.indexOf(b);
    if (i >= 0) G.buildings.splice(i, 1);
    if (G.selected === b) G.selected = null;
    fieldDirty = true;
    if (violent) {
      burst(b.cx, b.cy, 18, '#8d94aa', 70);
      burst(b.cx, b.cy, 8, '#e0574f', 50);
      G.rubble.push({ x: b.cx, y: b.cy, life: 26 });
      sfx('crumble');
    }
    G.dirtyUI = true;
  }

  function buildingAt(gx, gy) { return inGrid(gx, gy) ? G.grid[idx(gx, gy)] : null; }

  // ============================================================
  //  Flow field (Dijkstra out from the core, walls cost extra)
  // ============================================================
  function tileCost(i) {
    var b = G.grid[i];
    if (!b) return 1;
    if (b.type === 'core') return 1;
    return 6 + b.hp / 55;          // going around is cheaper than digging through
  }

  var heapV = new Float32Array(GW * GH + 1), heapI = new Int32Array(GW * GH + 1), heapN = 0;
  function hpush(v, i) {
    var n = ++heapN; heapV[n] = v; heapI[n] = i;
    while (n > 1) {
      var p = n >> 1;
      if (heapV[p] <= heapV[n]) break;
      var tv = heapV[p], ti = heapI[p];
      heapV[p] = heapV[n]; heapI[p] = heapI[n]; heapV[n] = tv; heapI[n] = ti;
      n = p;
    }
  }
  function hpop() {
    var top = heapI[1];
    heapV[1] = heapV[heapN]; heapI[1] = heapI[heapN]; heapN--;
    var n = 1;
    for (;;) {
      var l = n << 1, r = l + 1, s = n;
      if (l <= heapN && heapV[l] < heapV[s]) s = l;
      if (r <= heapN && heapV[r] < heapV[s]) s = r;
      if (s === n) break;
      var tv = heapV[s], ti = heapI[s];
      heapV[s] = heapV[n]; heapI[s] = heapI[n]; heapV[n] = tv; heapI[n] = ti;
      n = s;
    }
    return top;
  }

  var NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  function rebuildField() {
    dist.fill(Infinity);
    heapN = 0;
    var c = G.core;
    if (!c) return;
    for (var y = 0; y < c.h; y++) {
      for (var x = 0; x < c.w; x++) {
        var i = idx(c.gx + x, c.gy + y);
        dist[i] = 0; hpush(0, i);
      }
    }
    while (heapN > 0) {
      var cur = hpop();
      var cd = dist[cur];
      var cx = cur % GW, cy = (cur / GW) | 0;
      for (var n = 0; n < 8; n++) {
        var nx = cx + NB[n][0], ny = cy + NB[n][1];
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        var ni = idx(nx, ny);
        var diag = n >= 4;
        if (diag) {
          // no cutting corners through solid tiles
          if (G.grid[idx(cx, ny)] && G.grid[idx(nx, cy)]) continue;
        }
        var nd = cd + tileCost(ni) * (diag ? 1.414 : 1);
        if (nd < dist[ni]) { dist[ni] = nd; hpush(nd, ni); }
      }
    }
  }

  /** Best neighbouring tile for an enemy standing on (gx,gy). */
  function stepFrom(gx, gy) {
    var best = -1, bestD = dist[idx(gx, gy)];
    for (var n = 0; n < 8; n++) {
      var nx = gx + NB[n][0], ny = gy + NB[n][1];
      if (!inGrid(nx, ny)) continue;
      var ni = idx(nx, ny);
      if (n >= 4 && G.grid[idx(gx, ny)] && G.grid[idx(nx, gy)]) continue;
      if (dist[ni] < bestD) { bestD = dist[ni]; best = ni; }
    }
    return best;
  }

  // ============================================================
  //  Effects
  // ============================================================
  function burst(x, y, n, color, speed) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      G.particles.push({
        x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.35 + Math.random() * 0.4, max: 0.75, color: color, size: Math.random() < 0.4 ? 2 : 1
      });
    }
  }
  function floater(x, y, text, color) {
    G.floaters.push({ x: x, y: y, text: text, color: color, life: 1.1 });
  }

  // ============================================================
  //  Monsters
  // ============================================================
  function spawnEnemy(key, elite) {
    var def = D.ENEMIES[key];
    var w = G.wave;
    var side = Math.floor(Math.random() * 4), x, y;
    var m = 10;
    if (side === 0) { x = Math.random() * W; y = -m; }
    else if (side === 1) { x = W + m; y = Math.random() * H; }
    else if (side === 2) { x = Math.random() * W; y = H + m; }
    else { x = -m; y = Math.random() * H; }
    var hp = def.hp * D.waveHpMul(w) * (elite ? D.ELITE.hp : 1);
    var e = {
      id: ++uid, key: key, def: def, elite: !!elite,
      x: x, y: y, hp: hp, maxHp: hp,
      speed: def.speed * (elite ? D.ELITE.speed : 1) * (0.9 + Math.random() * 0.2),
      dmg: def.dmg * D.waveDmgMul(w) * (elite ? D.ELITE.dmg : 1),
      r: def.r * (def.boss ? 1 : 1), cd: 0, slow: 0, slowT: 0, flash: 0,
      face: 1, anim: Math.random() * 6.28, target: null, dead: false
    };
    G.enemies.push(e);
    return e;
  }

  function damageEnemy(e, dmg, color) {
    var armor = (e.def.armor || 0) * (1 + G.wave * 0.05);
    var d = Math.max(dmg * 0.15, dmg - armor);
    e.hp -= d;
    e.flash = 0.12;
    if (e.hp <= 0 && !e.dead) killEnemy(e);
    else if (Math.random() < 0.5) burst(e.x, e.y, 2, color || '#ffd9a0', 30);
  }

  function killEnemy(e) {
    e.dead = true;
    var mul = D.waveRewardMul(G.wave) * (e.elite ? D.ELITE.cores : 1);
    var cores = e.def.cores * mul * techMult('salvage', 0.12) * relicMult();
    var scrap = e.def.scrap * mul * techMult('mine', 0.08) * relicMult();
    G.res.cores += cores;
    G.res.scrap += scrap;
    G.kills++;
    G.waveKilled++;
    burst(e.x, e.y, e.def.boss ? 30 : 9, e.elite ? '#a6d8ff' : '#b0e08a', e.def.boss ? 90 : 55);
    if (e.def.boss || e.elite || Math.random() < 0.25) {
      floater(e.x, e.y, '+' + (cores >= 10 ? Math.round(cores) : cores.toFixed(1)), '#c7a8ff');
    }
    sfx(e.def.boss ? 'bossdie' : 'die', e.def.boss ? 0.5 : 0.18);
  }

  function enemyAttack(e, b, dt) {
    e.cd -= dt;
    if (e.cd > 0) return;
    e.cd = 1 / e.def.atkRate;
    b.hp -= e.dmg;
    b.flash = 0.12;
    burst(b.cx, b.cy, 4, '#e0574f', 40);
    sfx('thud', 0.12);
    if (b.hp <= 0) {
      if (b.type === 'core') { overrun(); }
      else {
        log(b.def.name + ' destroyed.', 'bad');
        destroy(b, true);
      }
    }
  }

  function updateEnemies(dt) {
    var core = G.core;
    for (var i = G.enemies.length - 1; i >= 0; i--) {
      var e = G.enemies[i];
      if (!e) continue;                      // list can be cleared mid-loop by an overrun
      if (e.dead) { G.enemies.splice(i, 1); continue; }
      if (e.flash > 0) e.flash -= dt;
      e.anim += dt * 6;
      var speed = e.speed * (e.slowT > 0 ? (1 - e.slow) : 1);
      if (e.slowT > 0) e.slowT -= dt;

      var tx, ty, target = null;

      if (e.def.flying) {
        target = core;
        tx = core.cx; ty = core.cy;
      } else {
        var gx = clamp(Math.floor(e.x / TILE), 0, GW - 1);
        var gy = clamp(Math.floor(e.y / TILE), 0, GH - 1);
        var here = G.grid[idx(gx, gy)];
        if (here && here !== core) target = here;      // standing inside a structure footprint
        var ni = stepFrom(gx, gy);
        if (ni < 0) {
          tx = core.cx; ty = core.cy;
        } else {
          var nx = ni % GW, ny = (ni / GW) | 0;
          var blocker = G.grid[ni];
          if (blocker) target = blocker;
          tx = nx * TILE + TILE / 2;
          ty = ny * TILE + TILE / 2;
        }
      }

      // ranged attackers stop short
      if (e.def.ranged && target) {
        var dd = Math.sqrt(dist2(e.x, e.y, target.cx, target.cy));
        if (dd <= e.def.ranged) {
          e.cd -= dt;
          if (e.cd <= 0) {
            e.cd = 1 / e.def.atkRate;
            G.projectiles.push({
              x: e.x, y: e.y, kind: 'spit', hostile: true, target: target,
              dmg: e.dmg, speed: 90, life: 3, r: 3
            });
            sfx('spit', 0.1);
          }
          continue;
        }
      }

      var dx = tx - e.x, dy = ty - e.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      if (dx < -0.4) e.face = -1; else if (dx > 0.4) e.face = 1;

      // contact with the thing we want dead
      var touching = null;
      if (target) {
        var hw = target.w * TILE / 2 + e.r, hh = target.h * TILE / 2 + e.r;
        if (Math.abs(e.x - target.cx) < hw && Math.abs(e.y - target.cy) < hh) touching = target;
      }
      if (!touching && core) {
        var chw = core.w * TILE / 2 + e.r, chh = core.h * TILE / 2 + e.r;
        if (Math.abs(e.x - core.cx) < chw && Math.abs(e.y - core.cy) < chh) touching = core;
      }
      if (touching) { enemyAttack(e, touching, dt); continue; }

      e.x += dx / len * speed * dt;
      e.y += dy / len * speed * dt;
    }

    // gentle crowd separation
    var list = G.enemies, n = list.length;
    for (var a = 0; a < n; a++) {
      var A = list[a];
      for (var b2 = a + 1; b2 < n; b2++) {
        var B = list[b2];
        if (A.def.flying !== B.def.flying) continue;
        var ddx = B.x - A.x, ddy = B.y - A.y;
        var rr = (A.r + B.r) * 0.8;
        var d2 = ddx * ddx + ddy * ddy;
        if (d2 > rr * rr || d2 < 0.0001) continue;
        var d = Math.sqrt(d2), push = (rr - d) * 0.5;
        ddx /= d; ddy /= d;
        A.x -= ddx * push; A.y -= ddy * push;
        B.x += ddx * push; B.y += ddy * push;
      }
    }
  }

  // ============================================================
  //  Turrets, drones, sentries
  // ============================================================
  function pickTarget(b, range) {
    var best = null, bestScore = Infinity, r2 = range * range;
    for (var i = 0; i < G.enemies.length; i++) {
      var e = G.enemies[i];
      if (e.dead) continue;
      var d2 = dist2(b.cx, b.cy, e.x, e.y);
      if (d2 > r2) continue;
      var score = dist[idx(clamp(Math.floor(e.x / TILE), 0, GW - 1), clamp(Math.floor(e.y / TILE), 0, GH - 1))];
      if (!isFinite(score)) score = d2 * 0.01;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  function fireTurret(b, dt) {
    var def = b.def;
    if (!def.range) return;
    var range = rangeOf(b);
    b.cd -= dt * G.power.eff;
    var t = pickTarget(b, range);
    if (t) {
      var want = Math.atan2(t.y - b.cy, t.x - b.cx);
      var diff = ((want - b.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      b.angle += diff * Math.min(1, dt * 10);
      b.target = t;
    } else { b.target = null; }
    if (b.cd > 0 || !t) return;
    b.cd = 1 / rateOf(b);
    var dmg = dmgOf(b);

    if (def.chain) {
      var hit = [t], last = t;
      for (var c = 1; c < def.chain; c++) {
        var nxt = null, nd = Infinity;
        for (var i = 0; i < G.enemies.length; i++) {
          var e = G.enemies[i];
          if (e.dead || hit.indexOf(e) >= 0) continue;
          var d2 = dist2(last.x, last.y, e.x, e.y);
          if (d2 < 60 * 60 && d2 < nd) { nd = d2; nxt = e; }
        }
        if (!nxt) break;
        hit.push(nxt); last = nxt;
      }
      var prev = { x: b.cx, y: b.cy - 4 };
      hit.forEach(function (e, i) {
        G.beams.push({ x1: prev.x, y1: prev.y, x2: e.x, y2: e.y, life: 0.16, color: '#9ff0ff' });
        damageEnemy(e, dmg * Math.pow(def.chainFalloff, i), '#9ff0ff');
        prev = e;
      });
      b.flashGun = 0.12;
      sfx('zap', 0.12);
      return;
    }

    // predictive lead
    var pspeed = def.proj === 'shell' ? 130 : (def.proj === 'ice' ? 150 : 210);
    var tt = Math.sqrt(dist2(b.cx, b.cy, t.x, t.y)) / pspeed;
    var px = t.x, py = t.y;
    G.projectiles.push({
      x: b.cx, y: b.cy - 3, tx: px, ty: py, target: t, kind: def.proj,
      dmg: dmg, speed: pspeed, splash: def.splash || 0, slow: def.slow || 0,
      slowTime: def.slowTime || 0, life: 2.5, r: def.proj === 'shell' ? 3 : 2,
      arc: def.proj === 'shell' ? Math.sqrt(dist2(b.cx, b.cy, t.x, t.y)) * 0.16 : 0, t0: tt
    });
    b.flashGun = 0.08;
    sfx(def.proj === 'shell' ? 'boom' : (def.proj === 'ice' ? 'ice' : 'shoot'), 0.1);
  }

  function updateBuildings(dt) {
    var gen = 0, use = 0, prodS = 0, prodC = 0;
    var i, b;
    for (i = 0; i < G.buildings.length; i++) {
      b = G.buildings[i];
      gen += powerGen(b);
      use += powerUse(b);
    }
    gen += tech('grid') * 8;
    G.power.gen = gen; G.power.use = use;
    G.power.eff = use <= gen ? 1 : Math.max(0.25, gen / Math.max(1, use));
    var eff = G.power.eff;

    for (i = 0; i < G.buildings.length; i++) {
      b = G.buildings[i];
      if (b.flash > 0) b.flash -= dt;
      if (b.flashGun > 0) b.flashGun -= dt;
      if (b.spawnAnim > 0) b.spawnAnim -= dt * 2.5;
      b.anim += dt;

      if (b.def.produce) {
        var s = prodOf(b, 'scrap') * eff, c = prodOf(b, 'cores') * eff;
        prodS += s; prodC += c;
        G.res.scrap += s * dt;
        G.res.cores += c * dt;
      }
      if (b.def.range && b.def.dmg) fireTurret(b, dt);
      if (b.def.repair) {
        b.cd -= dt * eff;
        if (b.cd <= 0) {
          b.cd = 1;
          var healed = 0;
          for (var j = 0; j < G.buildings.length; j++) {
            var o = G.buildings[j];
            if (o === b || o.hp >= o.maxHp) continue;
            if (dist2(b.cx, b.cy, o.cx, o.cy) > rangeOf(b) * rangeOf(b)) continue;
            o.hp = Math.min(o.maxHp, o.hp + b.def.repair * D.statScale(b.lvl));
            G.beams.push({ x1: b.cx, y1: b.cy - 4, x2: o.cx, y2: o.cy - 4, life: 0.5, color: '#9ff0a8' });
            if (++healed >= 3) break;
          }
        }
      }
      if (b.def.squad) updateBarracks(b, dt, eff);
      if (b.type === 'core') {
        // the core knits itself back together between waves, plus research
        var regen = tech('regen') * 0.6 + (G.waveState === 'prep' ? b.maxHp * 0.004 : 0);
        if (regen) b.hp = Math.min(b.maxHp, b.hp + regen * dt);
      }
    }
    G.prod.scrap = prodS; G.prod.cores = prodC;
  }

  function updateBarracks(b, dt, eff) {
    var want = b.def.squad + Math.floor((b.lvl - 1) / 2);
    b.drones = b.drones.filter(function (s) { return !s.dead; });
    b.respawnT = (b.respawnT || 0) - dt * eff;
    if (b.drones.length < want && b.respawnT <= 0) {
      b.respawnT = b.def.respawn;
      var s = {
        x: b.cx + (Math.random() - 0.5) * 12, y: b.cy + (Math.random() - 0.5) * 12,
        home: b, hp: b.def.soldierHp * D.statScale(b.lvl) * techMult('hp', 0.15),
        dmg: b.def.soldierDmg * D.statScale(b.lvl) * techMult('dmg', 0.12) * relicMult(),
        cd: 0, face: 1, anim: Math.random() * 6, dead: false, flash: 0
      };
      s.maxHp = s.hp;
      b.drones.push(s);
      G.soldiers.push(s);
    }
  }

  function updateSoldiers(dt) {
    for (var i = G.soldiers.length - 1; i >= 0; i--) {
      var s = G.soldiers[i];
      if (s.dead) { G.soldiers.splice(i, 1); continue; }
      if (s.flash > 0) s.flash -= dt;
      s.anim += dt * 5;
      var best = null, bd = Infinity;
      for (var j = 0; j < G.enemies.length; j++) {
        var e = G.enemies[j];
        if (e.dead || e.def.flying) continue;
        var d2 = dist2(s.home.cx, s.home.cy, e.x, e.y);
        if (d2 > s.home.def.range * s.home.def.range) continue;
        var pd = dist2(s.x, s.y, e.x, e.y);
        if (pd < bd) { bd = pd; best = e; }
      }
      var tx, ty;
      if (best) { tx = best.x; ty = best.y; } else { tx = s.home.cx; ty = s.home.cy + 14; }
      var dx = tx - s.x, dy = ty - s.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
      if (dx < -0.3) s.face = -1; else if (dx > 0.3) s.face = 1;
      if (len > 11) {
        s.x += dx / len * 42 * dt;
        s.y += dy / len * 42 * dt;
      } else if (best) {
        s.cd -= dt;
        if (s.cd <= 0) {
          s.cd = 0.8;
          damageEnemy(best, s.dmg, '#cfe4ff');
          sfx('slash', 0.08);
        }
        // enemies fight back
        best.cd2 = (best.cd2 || 0) - dt;
        if (best.cd2 <= 0) {
          best.cd2 = 1 / best.def.atkRate;
          s.hp -= best.dmg * 0.55;
          s.flash = 0.1;
          if (s.hp <= 0) { s.dead = true; burst(s.x, s.y, 8, '#7fb2f0', 45); }
        }
      }
    }
  }

  function updateProjectiles(dt) {
    for (var i = G.projectiles.length - 1; i >= 0; i--) {
      var p = G.projectiles[i];
      p.life -= dt;
      var tgt = p.target;
      if (p.hostile) {
        if (!tgt || tgt.dead || p.life <= 0) { G.projectiles.splice(i, 1); continue; }
        var dxh = tgt.cx - p.x, dyh = tgt.cy - p.y, lh = Math.sqrt(dxh * dxh + dyh * dyh) || 1;
        p.x += dxh / lh * p.speed * dt; p.y += dyh / lh * p.speed * dt;
        if (lh < 8) {
          tgt.hp -= p.dmg; tgt.flash = 0.12;
          burst(p.x, p.y, 5, '#8ce0b0', 40);
          if (tgt.hp <= 0) { if (tgt.type === 'core') overrun(); else { log(tgt.def.name + ' destroyed.', 'bad'); destroy(tgt, true); } }
          G.projectiles.splice(i, 1);
        }
        continue;
      }
      // friendly shot: home on the live target, else fly to its last position
      if (tgt && !tgt.dead) { p.tx = tgt.x; p.ty = tgt.y; }
      var dx = p.tx - p.x, dy = p.ty - p.y, l = Math.sqrt(dx * dx + dy * dy) || 1;
      var step = p.speed * dt;
      p.a = Math.atan2(dy, dx);
      if (l <= step || p.life <= 0) {
        impact(p);
        G.projectiles.splice(i, 1);
        continue;
      }
      p.x += dx / l * step;
      p.y += dy / l * step;
      if (p.kind === 'ice' && Math.random() < 0.35) {
        G.particles.push({ x: p.x, y: p.y, vx: 0, vy: 0, life: 0.25, max: 0.25, color: '#9fe8ff', size: 1 });
      }
    }
  }

  function impact(p) {
    if (p.splash) {
      burst(p.x, p.y, 12, '#ffb35c', 70);
      G.beams.push({ ring: true, x: p.x, y: p.y, r: p.splash, life: 0.22, color: '#ffb35c' });
      for (var i = 0; i < G.enemies.length; i++) {
        var e = G.enemies[i];
        if (e.dead) continue;
        var d2 = dist2(p.x, p.y, e.x, e.y);
        if (d2 <= p.splash * p.splash) {
          var falloff = 1 - Math.sqrt(d2) / p.splash * 0.5;
          damageEnemy(e, p.dmg * falloff, '#ffb35c');
        }
      }
      sfx('boom', 0.12);
      return;
    }
    var t = p.target;
    if (t && !t.dead) {
      damageEnemy(t, p.dmg, p.kind === 'ice' ? '#9fe8ff' : '#ffd9a0');
      if (p.slow) { t.slow = Math.max(t.slow, p.slow); t.slowT = Math.max(t.slowT, p.slowTime); }
    } else {
      burst(p.x, p.y, 3, '#cfd6e6', 30);
    }
  }

  function updateEffects(dt) {
    var i, o;
    for (i = G.particles.length - 1; i >= 0; i--) {
      o = G.particles[i];
      o.life -= dt;
      if (o.life <= 0) { G.particles.splice(i, 1); continue; }
      o.x += o.vx * dt; o.y += o.vy * dt;
      o.vx *= 0.92; o.vy *= 0.92;
    }
    for (i = G.floaters.length - 1; i >= 0; i--) {
      o = G.floaters[i];
      o.life -= dt; o.y -= 14 * dt;
      if (o.life <= 0) G.floaters.splice(i, 1);
    }
    for (i = G.beams.length - 1; i >= 0; i--) {
      o = G.beams[i];
      o.life -= dt;
      if (o.life <= 0) G.beams.splice(i, 1);
    }
    for (i = G.rubble.length - 1; i >= 0; i--) {
      G.rubble[i].life -= dt;
      if (G.rubble[i].life <= 0) G.rubble.splice(i, 1);
    }
  }

  // ============================================================
  //  Waves
  // ============================================================
  function buildQueue(w) {
    var comp = D.waveComp(w);
    var q = [];
    comp.list.forEach(function (row) {
      for (var i = 0; i < row.count; i++) {
        q.push({ key: row.key, elite: row.key !== 'boss' && Math.random() < comp.eliteChance });
      }
    });
    for (var i = q.length - 1; i > 0; i--) {     // shuffle
      var j = Math.floor(Math.random() * (i + 1));
      var t = q[i]; q[i] = q[j]; q[j] = t;
    }
    return { queue: q, interval: comp.interval };
  }

  function startWave() {
    G.wave++;
    G.maxWave = Math.max(G.maxWave, G.wave);
    var built = buildQueue(G.wave);
    G.spawnQueue = built.queue;
    G.spawnInterval = built.interval;
    G.spawnTimer = 0;
    G.waveTotal = built.queue.length;
    G.waveKilled = 0;
    G.waveState = 'combat';
    emit('banner', 'WAVE ' + G.wave, G.wave % 10 === 0 ? 'bad' : '');
    log('Wave ' + G.wave + ' incoming — ' + built.queue.length + ' hostiles.', G.wave % 10 === 0 ? 'bad' : 'warn');
    sfx('wave');
    G.dirtyUI = true;
  }

  function endWave() {
    var bonus = Math.round((25 + G.wave * 10) * relicMult() * techMult('mine', 0.16));
    var coreBonus = (2 + G.wave * 0.6) * relicMult() * techMult('salvage', 0.12);
    G.res.scrap += bonus;
    G.res.cores += coreBonus;
    G.waveState = 'prep';
    G.waveTimer = Math.max(12, 30 - G.wave * 0.3);
    log('Wave ' + G.wave + ' cleared. +' + bonus + ' scrap, +' + coreBonus.toFixed(1) + ' cores.', 'good');
    emit('banner', 'WAVE CLEARED', '');
    sfx('clear');
    if (D.BUILD_ORDER.some(function (k) { return D.BUILDINGS[k].unlock === G.maxWave; })) {
      D.BUILD_ORDER.forEach(function (k) {
        if (D.BUILDINGS[k].unlock === G.maxWave) log('Unlocked: ' + D.BUILDINGS[k].name + '.', 'good');
      });
    }
    save();
    G.dirtyUI = true;
  }

  function callWave() {
    if (G.waveState !== 'prep') return;
    var bonus = Math.round(G.waveTimer * (3 + G.wave * 0.7) * relicMult());
    G.res.scrap += bonus;
    floater(G.core.cx, G.core.cy - 22, '+' + bonus, '#f0b54a');
    log('Wave called early. +' + bonus + ' scrap.', 'good');
    G.waveTimer = 0;
    startWave();
  }

  function overrun() {
    G.overruns++;
    G.enemies.length = 0;
    G.projectiles.length = 0;
    G.core.hp = G.core.maxHp * 0.6;
    var lost = Math.floor(G.res.scrap * 0.25);
    G.res.scrap -= lost;
    G.wave = Math.max(0, G.wave - 2);
    G.waveState = 'prep';
    G.waveTimer = 40;
    G.spawnQueue.length = 0;
    burst(G.core.cx, G.core.cy, 60, '#e0574f', 120);
    emit('banner', 'BASTION OVERRUN', 'bad');
    log('The core fell! Lost ' + lost + ' scrap; falling back to wave ' + G.wave + '.', 'bad');
    sfx('overrun');
    G.dirtyUI = true;
  }

  function updateWave(dt) {
    if (G.waveState === 'prep') {
      G.waveTimer -= dt;
      if (G.waveTimer <= 0) startWave();
      return;
    }
    if (G.spawnQueue.length) {
      G.spawnTimer -= dt;
      while (G.spawnTimer <= 0 && G.spawnQueue.length) {
        var s = G.spawnQueue.shift();
        spawnEnemy(s.key, s.elite);
        G.spawnTimer += G.spawnInterval;
      }
    } else if (!G.enemies.length) {
      endWave();
    }
  }

  // ============================================================
  //  Main tick
  // ============================================================
  function update(dt) {
    if (G.paused) return;
    G.time += dt;
    if (fieldDirty && (fieldCooldown -= dt) <= 0) {
      rebuildField();
      fieldDirty = false;
      fieldCooldown = 0.15;
    }
    updateWave(dt);
    updateBuildings(dt);
    updateEnemies(dt);
    updateSoldiers(dt);
    updateProjectiles(dt);
    updateEffects(dt);
    if (Date.now() - G.lastSaved > 15000) save();
  }

  // ============================================================
  //  Research & prestige
  // ============================================================
  function buyTech(id) {
    var t = D.TECH_BY_ID[id];
    var lvl = tech(id);
    if (!t || lvl >= t.max) return false;
    var cost = D.techCost(t, lvl);
    if (G.res.cores < cost) { sfx('deny'); return false; }
    G.res.cores -= cost;
    G.tech[id] = lvl + 1;
    if (id === 'hp') {
      G.buildings.forEach(function (b) {
        var f = b.hp / b.maxHp; b.maxHp = maxHpOf(b); b.hp = b.maxHp * f;
      });
    }
    log('Researched ' + t.name + ' ' + (lvl + 1) + '.', 'good');
    sfx('upgrade');
    G.dirtyUI = true;
    return true;
  }

  function relicGain() {
    if (G.maxWave < 15) return 0;
    var total = Math.floor(Math.pow(G.maxWave / 7, 1.35));
    return Math.max(0, total - G.relics);
  }

  function prestige() {
    var gain = relicGain();
    if (gain <= 0) return false;
    var relics = G.relics + gain;
    var kills = G.kills, overruns = G.overruns, born = G.born, sound = G.sound;
    G = fresh();
    G.rubble = [];
    G.relics = relics;
    G.kills = kills;
    G.overruns = overruns;
    G.born = born;
    G.sound = sound;
    G.res.scrap = 150 + relics * 40;
    seedBase();
    log('Bastion rebuilt. +' + gain + ' relics (now ' + relics + ').', 'good');
    emit('banner', 'REBUILT', '');
    save();
    G.dirtyUI = true;
    return true;
  }

  // ============================================================
  //  Setup, save / load, offline catch-up
  // ============================================================
  function seedBase() {
    G.core = makeBuilding('core', D.CORE.gx, D.CORE.gy);
    makeBuilding('arrow', D.CORE.gx - 2, D.CORE.gy);
    makeBuilding('arrow', D.CORE.gx + 3, D.CORE.gy + 1);
    makeBuilding('miner', D.CORE.gx, D.CORE.gy - 2);
    makeBuilding('gen', D.CORE.gx + 1, D.CORE.gy + 3);
    rebuildField();
  }

  function serialize() {
    return {
      v: 1,
      res: { scrap: Math.round(G.res.scrap * 100) / 100, cores: Math.round(G.res.cores * 100) / 100 },
      wave: G.wave, maxWave: G.maxWave, waveTimer: Math.max(6, G.waveTimer),
      tech: G.tech, relics: G.relics, kills: G.kills, overruns: G.overruns,
      sound: G.sound, born: G.born, saved: Date.now(),
      buildings: G.buildings.map(function (b) {
        return { t: b.type, x: b.gx, y: b.gy, l: b.lvl, h: Math.round(b.hp) };
      })
    };
  }

  function save() {
    G.lastSaved = Date.now();
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(serialize()));
    } catch (err) { /* storage disabled — play on, just no persistence */ }
  }

  function wipe() {
    try { localStorage.removeItem(SAVE_KEY); } catch (err) {}
  }

  /** Simulate what the automated base earned while the tab was closed. */
  function offline(elapsedSec) {
    var report = { seconds: elapsedSec, scrap: 0, cores: 0, waves: 0, stalled: false };
    var RATE = 0.6;
    updateBuildings(0.0001);                   // refresh power/production figures
    report.scrap = G.prod.scrap * elapsedSec * RATE;
    report.cores = G.prod.cores * elapsedSec * RATE;

    // Offline defence: compare sustained turret dps with each wave's health pool.
    var dps = 0;
    G.buildings.forEach(function (b) {
      if (!b.def.dmg || !b.def.range) return;
      var mult = b.def.chain ? (1 + (b.def.chain - 1) * b.def.chainFalloff) : (b.def.splash ? 2.2 : 1);
      dps += dmgOf(b) * rateOf(b) * mult * G.power.eff;
    });
    G.buildings.forEach(function (b) {
      if (b.def.squad) dps += b.def.soldierDmg * D.statScale(b.lvl) * (b.def.squad + Math.floor((b.lvl - 1) / 2)) * 1.1;
    });
    var budget = elapsedSec, waveSecs = 42;
    while (budget >= waveSecs) {
      var w = G.wave + 1;
      var comp = D.waveComp(w);
      var pool = 0;
      comp.list.forEach(function (row) {
        var e = D.ENEMIES[row.key];
        pool += e.hp * D.waveHpMul(w) * row.count * (1 + comp.eliteChance * 2.2);
      });
      var need = pool / 26;                     // must clear the wave in ~26s
      if (dps < need) { report.stalled = true; break; }
      budget -= waveSecs;
      G.wave = w;
      G.maxWave = Math.max(G.maxWave, w);
      report.waves++;
      report.scrap += (25 + w * 10) * relicMult() * techMult('mine', 0.16);
      var mul = D.waveRewardMul(w);
      comp.list.forEach(function (row) {
        var e = D.ENEMIES[row.key];
        report.cores += e.cores * mul * row.count * techMult('salvage', 0.12) * relicMult() * RATE;
        report.scrap += e.scrap * mul * row.count * techMult('mine', 0.08) * relicMult() * RATE;
      });
    }
    G.res.scrap += report.scrap;
    G.res.cores += report.cores;
    G.waveState = 'prep';
    G.waveTimer = 20;
    return report;
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (err) { raw = null; }
    G = fresh();
    G.rubble = [];
    if (!raw) { G.isNew = true; seedBase(); return null; }
    var s;
    try { s = JSON.parse(raw); } catch (err) { seedBase(); return null; }
    G.res.scrap = s.res.scrap; G.res.cores = s.res.cores;
    G.wave = s.wave || 0; G.maxWave = s.maxWave || 0;
    G.tech = s.tech || {}; G.relics = s.relics || 0;
    G.kills = s.kills || 0; G.overruns = s.overruns || 0;
    G.sound = s.sound !== false; G.born = s.born || Date.now();
    (s.buildings || []).forEach(function (b) {
      if (!D.BUILDINGS[b.t]) return;
      if (!canPlace(b.t, b.x, b.y) && b.t !== 'core') return;
      var nb = makeBuilding(b.t, b.x, b.y, b.l, b.h);
      if (b.t === 'core') G.core = nb;
    });
    if (!G.core) G.core = makeBuilding('core', D.CORE.gx, D.CORE.gy);
    rebuildField();
    var elapsed = Math.max(0, Math.min(12 * 3600, (Date.now() - (s.saved || Date.now())) / 1000));
    var report = elapsed > 60 ? offline(elapsed) : null;
    G.waveState = 'prep';
    G.waveTimer = Math.max(10, s.waveTimer || 20);
    return report;
  }

  function hardReset() {
    wipe();
    G = fresh();
    G.rubble = [];
    seedBase();
    G.dirtyUI = true;
  }

  global.Game = {
    get state() { return G; },
    D: D, W: W, H: H,
    on: function (kind, fn) { listeners[kind].push(fn); },
    init: load, update: update, save: save, hardReset: hardReset, catchUp: offline,
    tryPlace: tryPlace, canPlace: canPlace, sell: sell, upgrade: upgrade,
    repairAll: repairAll, repairCost: repairCost, buildingAt: buildingAt,
    buyTech: buyTech, prestige: prestige, relicGain: relicGain, callWave: callWave,
    effCost: effCost, unlocked: unlocked, investedIn: investedIn,
    dmgOf: dmgOf, rateOf: rateOf, rangeOf: rangeOf, prodOf: prodOf,
    powerUse: powerUse, powerGen: powerGen, maxHpOf: maxHpOf,
    tech: tech, relicMult: relicMult, upgradeCost: D.upgradeCost,
    log: log, field: dist, idx: idx
  };
})(window);
