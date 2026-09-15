/* ============================================================
   Hollow Bastion — renderer
   Everything is drawn at 640x480 and scaled up with nearest
   neighbour, so the pixel grid stays intact at any window size.
   ============================================================ */
(function (global) {
  'use strict';

  var D = global.Defs, S = null;
  var TILE = D.TILE, GW = D.GW, GH = D.GH;
  var W = GW * TILE, H = GH * TILE;
  var canvas, ctx, terrain, tint = 0, shake = 0, shakeX = 0, shakeY = 0;

  function init(cv) {
    canvas = cv;
    ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    S = global.Sprites.table;
    terrain = bakeTerrain();
  }

  // ---------- terrain ----------
  // Painted per pixel: worn dirt lanes converging on the core, grass
  // everywhere else, with noisy dithered borders so nothing looks tiled.
  function bakeTerrain() {
    var c = global.Sprites.newCanvas(W, H);
    var g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    var hash = global.Sprites.hash2, fbm = global.Sprites.fbm;
    var ccx = (D.CORE.gx + 1) * TILE, ccy = (D.CORE.gy + 1) * TILE;

    // --- lane skeleton: wandering tracks from the map edge to the core ---
    var pts = [];
    var mouths = [[W * 0.5, 0], [W, H * 0.45], [W * 0.45, H], [0, H * 0.55],
                  [W * 0.18, 0], [W * 0.82, H]];
    mouths.forEach(function (m, k) {
      var dx = ccx - m[0], dy = ccy - m[1];
      var nx = -dy, ny = dx, nl = Math.sqrt(nx * nx + ny * ny) || 1;
      for (var t = 0; t <= 1.0001; t += 0.01) {
        var wob = Math.sin(t * 6.2 + k * 2.1) * 30 * (1 - t) + Math.sin(t * 13 + k) * 8 * (1 - t);
        pts.push([m[0] + dx * t + nx / nl * wob, m[1] + dy * t + ny / nl * wob, k > 3 ? 8 : 13]);
      }
    });

    // coarse distance field (8px cells), bilinearly sampled per pixel
    var CS = 8, CW = Math.ceil(W / CS) + 1, CH = Math.ceil(H / CS) + 1;
    var df = new Float32Array(CW * CH);
    for (var cy = 0; cy < CH; cy++) {
      for (var cx = 0; cx < CW; cx++) {
        var px = cx * CS, py = cy * CS, best = 1e9;
        for (var i = 0; i < pts.length; i++) {
          var ddx = px - pts[i][0], ddy = py - pts[i][1];
          var d = Math.sqrt(ddx * ddx + ddy * ddy) - pts[i][2];
          if (d < best) best = d;
        }
        df[cy * CW + cx] = best;
      }
    }
    function sampleDf(x, y) {
      var fx = x / CS, fy = y / CS;
      var x0 = Math.min(CW - 2, Math.floor(fx)), y0 = Math.min(CH - 2, Math.floor(fy));
      var tx = fx - x0, ty = fy - y0;
      var a = df[y0 * CW + x0], b = df[y0 * CW + x0 + 1];
      var cc = df[(y0 + 1) * CW + x0], dd = df[(y0 + 1) * CW + x0 + 1];
      return (a + (b - a) * tx) + ((cc + (dd - cc) * tx) - (a + (b - a) * tx)) * ty;
    }

    var GRASS = [[47, 99, 55], [58, 118, 64], [69, 134, 74], [80, 148, 84]];
    var DIRT = [[86, 66, 43], [100, 78, 52], [115, 92, 63], [74, 57, 37]];
    var img = g.createImageData(W, H);
    var data = img.data;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var n = fbm(x / 34, y / 34, 7);
        var edge = sampleDf(x, y) + (n - 0.5) * 34;
        var shade = fbm(x / 11, y / 11, 3);
        var spec = hash(x, y, 19);
        var pal, lvl;
        if (edge < 0) {
          lvl = shade < 0.34 ? 3 : (shade < 0.55 ? 0 : (shade < 0.78 ? 1 : 2));
          pal = DIRT[lvl];
          if (spec > 0.985) pal = [136, 128, 112];          // pebble
        } else {
          lvl = shade < 0.3 ? 0 : (shade < 0.56 ? 1 : (shade < 0.82 ? 2 : 3));
          pal = GRASS[lvl];
          if (spec > 0.94) pal = GRASS[Math.min(3, lvl + 1)];
          else if (spec < 0.05) pal = GRASS[Math.max(0, lvl - 1)];
          if (edge < 4 && spec > 0.55) pal = DIRT[0];        // trampled fringe
        }
        var o = (y * W + x) * 4;
        data[o] = pal[0]; data[o + 1] = pal[1]; data[o + 2] = pal[2]; data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);

    // --- scenery ---
    function decorate(sp, k, gx, gy) {
      var ox = Math.floor(hash(gx, gy, 20 + k) * (TILE - sp.width));
      var oy = Math.floor(hash(gx, gy, 30 + k) * (TILE - sp.height));
      if (k < 2) {
        g.globalAlpha = 0.25; g.fillStyle = '#000';
        g.fillRect(gx * TILE + ox + 1, gy * TILE + oy + sp.height - 2, sp.width - 2, 2);
        g.globalAlpha = 1;
      }
      g.drawImage(sp, gx * TILE + ox, gy * TILE + oy);
    }
    for (var gy2 = 1; gy2 < GH - 1; gy2++) {
      for (var gx2 = 1; gx2 < GW - 1; gx2++) {
        if (sampleDf(gx2 * TILE + 8, gy2 * TILE + 8) < 10) continue;
        if (Math.abs(gx2 - (D.CORE.gx + 0.5)) < 4 && Math.abs(gy2 - (D.CORE.gy + 0.5)) < 4) continue;
        var r = hash(gx2, gy2, 11);
        if (r > 0.965) decorate(S.decor[0], 0, gx2, gy2);
        else if (r > 0.93) decorate(S.decor[1], 1, gx2, gy2);
        else if (r > 0.87) decorate(S.decor[2], 2, gx2, gy2);
        else if (r > 0.855) decorate(S.decor[3], 3, gx2, gy2);
      }
    }

    // stone pad under the core
    g.globalAlpha = 0.5;
    g.fillStyle = '#4a4f60';
    g.beginPath();
    g.ellipse(ccx, ccy + 2, 30, 20, 0, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;

    // darkened outer ring: the wilds the horde walks in from
    g.fillStyle = 'rgba(8,10,16,0.5)';
    g.fillRect(0, 0, W, TILE);
    g.fillRect(0, H - TILE, W, TILE);
    g.fillRect(0, TILE, TILE, H - TILE * 2);
    g.fillRect(W - TILE, TILE, TILE, H - TILE * 2);
    return c;
  }

  var TURRET_RIM = { arrow: '#f0b54a', cannon: '#e08a4a', frost: '#6fd8f5', tesla: '#9f7ff0' };

  // ---------- helpers ----------
  function shadow(x, y, rx, ry, a) {
    ctx.globalAlpha = a || 0.3;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function bar(x, y, w, h, frac, fg, bg) {
    ctx.fillStyle = bg || '#10121a';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = fg;
    ctx.fillRect(x, y, Math.max(0, Math.round(w * frac)), h);
  }

  function sprite(img, cx, cy, face, flash) {
    var w = img.width, h = img.height;
    if (face === -1) {
      ctx.save();
      ctx.translate(Math.round(cx), Math.round(cy));
      ctx.scale(-1, 1);
      ctx.drawImage(img, -Math.round(w / 2), -Math.round(h / 2));
      ctx.restore();
    } else {
      ctx.drawImage(img, Math.round(cx - w / 2), Math.round(cy - h / 2));
    }
    if (flash) {
      ctx.globalAlpha = Math.min(1, flash * 6);
      ctx.drawImage(flash.img, Math.round(cx - w / 2), Math.round(cy - h / 2));
      ctx.globalAlpha = 1;
    }
  }

  // ---------- buildings ----------
  function drawBuilding(b, G) {
    var x = b.cx, y = b.cy;
    var pop = b.spawnAnim > 0 ? 1 + b.spawnAnim * 0.25 : 1;
    shadow(x, y + b.h * TILE / 2 - 3, b.w * TILE * 0.38, 3.2, 0.28);

    ctx.save();
    if (pop !== 1) { ctx.translate(x, y); ctx.scale(pop, pop); ctx.translate(-x, -y); }

    switch (b.type) {
      case 'core': {
        var puls = 0.5 + Math.sin(b.anim * 2) * 0.5;
        var gr = ctx.createRadialGradient(x, y - 2, 2, x, y - 2, 26 + puls * 5);
        gr.addColorStop(0, 'rgba(146,244,232,' + (0.34 + puls * 0.16).toFixed(3) + ')');
        gr.addColorStop(0.55, 'rgba(79,209,197,0.14)');
        gr.addColorStop(1, 'rgba(79,209,197,0)');
        ctx.fillStyle = gr;
        ctx.fillRect(x - 34, y - 36, 68, 68);
        ctx.drawImage(S.core, Math.round(x - 16), Math.round(y - 18));
        break;
      }
      case 'wall':
        ctx.drawImage(S.wall, b.gx * TILE, b.gy * TILE);
        break;
      case 'arrow': case 'cannon': case 'frost': case 'tesla': {
        ctx.drawImage(S.plat, b.gx * TILE, b.gy * TILE);
        // a rim in the turret's own colour so types read apart at a glance
        ctx.fillStyle = TURRET_RIM[b.type];
        var rx = b.gx * TILE, ry = b.gy * TILE;
        ctx.fillRect(rx + 5, ry + 1, 6, 1);
        ctx.fillRect(rx + 5, ry + 14, 6, 1);
        ctx.fillRect(rx + 1, ry + 5, 1, 6);
        ctx.fillRect(rx + 14, ry + 5, 1, 6);
        if (b.type === 'tesla') {
          ctx.drawImage(S.coil, b.gx * TILE, b.gy * TILE - 4);
          var n = b.flashGun > 0 ? 6 : 2;
          ctx.strokeStyle = b.flashGun > 0 ? '#e9feff' : '#5ce1f0';
          ctx.globalAlpha = b.flashGun > 0 ? 0.9 : 0.35;
          ctx.lineWidth = 1;
          for (var i = 0; i < n; i++) {
            var a = b.anim * 5 + i * 2.2;
            ctx.beginPath();
            ctx.moveTo(x, y - 9);
            ctx.lineTo(x + Math.cos(a) * 6, y - 9 + Math.sin(a) * 4);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        } else {
          var gun = b.type === 'arrow' ? S.gunArrow : (b.type === 'cannon' ? S.gunCannon : S.gunFrost);
          var recoil = b.flashGun > 0 ? -2 : 0;
          ctx.save();
          ctx.translate(Math.round(x), Math.round(y - 3));
          ctx.rotate(b.angle);
          ctx.drawImage(gun, -8 + recoil, -8);
          ctx.restore();
          if (b.flashGun > 0) {
            ctx.globalAlpha = b.flashGun * 8;
            ctx.fillStyle = b.type === 'frost' ? '#bdf1ff' : '#ffe1a0';
            ctx.beginPath();
            ctx.arc(x + Math.cos(b.angle) * 9, y - 3 + Math.sin(b.angle) * 9, 3, 0, 6.3);
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        }
        break;
      }
      case 'miner': {
        ctx.drawImage(S.miner, b.gx * TILE, b.gy * TILE + Math.round(Math.sin(b.anim * 6) * 0.8));
        break;
      }
      case 'gen': {
        ctx.drawImage(S.gen, b.gx * TILE, b.gy * TILE);
        ctx.globalAlpha = 0.25 + Math.sin(b.anim * 4) * 0.2;
        ctx.fillStyle = '#8ff0e6';
        ctx.fillRect(b.gx * TILE + 5, b.gy * TILE + 4, 6, 5);
        ctx.globalAlpha = 1;
        break;
      }
      case 'lab': ctx.drawImage(S.lab, b.gx * TILE, b.gy * TILE); break;
      case 'medic': ctx.drawImage(S.medic, b.gx * TILE, b.gy * TILE); break;
      case 'barracks': ctx.drawImage(S.barracks, b.gx * TILE, b.gy * TILE); break;
      default: ctx.drawImage(S.wall, b.gx * TILE, b.gy * TILE);
    }
    ctx.restore();

    if (b.flash > 0) {
      ctx.globalAlpha = Math.min(0.75, b.flash * 5);
      ctx.fillStyle = '#ff9c8c';
      ctx.fillRect(b.gx * TILE, b.gy * TILE, b.w * TILE, b.h * TILE);
      ctx.globalAlpha = 1;
    }
    if (b.lvl > 1) {
      var pips = Math.min(8, b.lvl - 1);
      for (var p = 0; p < pips; p++) {
        ctx.fillStyle = b.lvl > 8 ? '#f0b54a' : '#4fd1c5';
        ctx.fillRect(b.gx * TILE + 1 + p * 2, b.gy * TILE + b.h * TILE - 2, 1, 1);
      }
    }
    if (b.hp < b.maxHp) {
      var f = b.hp / b.maxHp;
      bar(b.gx * TILE + 2, b.gy * TILE - 3, b.w * TILE - 4, 2,
        f, f > 0.5 ? '#7ec96b' : (f > 0.25 ? '#f0b54a' : '#e0574f'));
    }
    if (G.power.eff < 1 && (b.def.power || 0) > 0 && Math.sin(b.anim * 6) > 0) {
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(b.gx * TILE + b.w * TILE - 4, b.gy * TILE + 1, 2, 3);
    }
  }

  // ---------- entities ----------
  function drawEnemy(e) {
    var img = e.def.boss ? S.boss : (e.elite ? S.eliteOf[e.def.sprite] : S[e.def.sprite]);
    var bob = e.def.flying ? Math.sin(e.anim * 1.6) * 2.5 : Math.abs(Math.sin(e.anim * 0.9)) * 1.2;
    var y = e.y - bob - (e.def.flying ? 6 : 0);
    shadow(e.x, e.y + e.r * 0.5, e.r * 0.9, e.r * 0.4, e.def.flying ? 0.18 : 0.3);
    if (e.elite) {
      ctx.globalAlpha = 0.2 + Math.sin(e.anim) * 0.08;
      ctx.fillStyle = '#7fd0ff';
      ctx.beginPath(); ctx.arc(e.x, y, e.r + 4, 0, 6.3); ctx.fill();
      ctx.globalAlpha = 1;
    }
    sprite(img, e.x, y, e.face, null);
    if (e.flash > 0) {
      var fimg = S.flash[e.def.sprite] || S.flash.slime;
      ctx.globalAlpha = Math.min(0.9, e.flash * 7);
      if (e.def.boss) ctx.drawImage(fimg, Math.round(e.x - 16), Math.round(y - 16), 32, 32);
      else sprite(fimg, e.x, y, e.face, null);
      ctx.globalAlpha = 1;
    }
    if (e.slowT > 0) {
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#9fe8ff';
      ctx.fillRect(Math.round(e.x - e.r), Math.round(y - e.r), e.r * 2, e.r * 2);
      ctx.globalAlpha = 1;
    }
    if (e.hp < e.maxHp) {
      var w = e.def.boss ? 26 : 12;
      bar(Math.round(e.x - w / 2), Math.round(y - e.r - 7), w, 2, e.hp / e.maxHp,
        e.elite ? '#7fd0ff' : '#e0574f');
    }
  }

  function drawSoldier(s) {
    shadow(s.x, s.y + 5, 4, 2, 0.28);
    var bob = Math.abs(Math.sin(s.anim)) * 1.2;
    sprite(S.soldier, s.x, s.y - bob, s.face, null);
    if (s.flash > 0) {
      ctx.globalAlpha = Math.min(0.9, s.flash * 8);
      sprite(S.flash.soldier, s.x, s.y - bob, s.face, null);
      ctx.globalAlpha = 1;
    }
    if (s.hp < s.maxHp) bar(Math.round(s.x - 5), Math.round(s.y - 11), 10, 2, s.hp / s.maxHp, '#7fb2f0');
  }

  function drawProjectile(p) {
    var a = p.a || 0;
    if (p.kind === 'bolt') {
      ctx.strokeStyle = '#ffe9b0'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - Math.cos(a) * 5, p.y - Math.sin(a) * 5);
      ctx.stroke();
      ctx.fillStyle = '#fff6d8';
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    } else if (p.kind === 'shell') {
      ctx.fillStyle = '#2b2b36';
      ctx.beginPath(); ctx.arc(Math.round(p.x), Math.round(p.y), 3, 0, 6.3); ctx.fill();
      ctx.fillStyle = '#ff9c4a';
      ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2);
    } else if (p.kind === 'ice') {
      ctx.fillStyle = '#bdf1ff';
      ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y)); ctx.rotate(a);
      ctx.fillRect(-3, -1, 6, 2); ctx.fillRect(-1, -3, 2, 6);
      ctx.restore();
    } else if (p.kind === 'spit') {
      ctx.fillStyle = '#7ad4a0';
      ctx.beginPath(); ctx.arc(Math.round(p.x), Math.round(p.y), 2.5, 0, 6.3); ctx.fill();
    }
  }

  function drawBeam(o) {
    var a = Math.max(0, o.life * 5);
    ctx.globalAlpha = Math.min(1, a);
    if (o.ring) {
      ctx.strokeStyle = o.color; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r * (1.15 - o.life * 2), 0, 6.3);
      ctx.stroke();
    } else {
      ctx.strokeStyle = o.color; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(o.x1, o.y1);
      var segs = 4;
      for (var i = 1; i < segs; i++) {
        var t = i / segs;
        ctx.lineTo(o.x1 + (o.x2 - o.x1) * t + (Math.random() - 0.5) * 6,
                   o.y1 + (o.y2 - o.y1) * t + (Math.random() - 0.5) * 6);
      }
      ctx.lineTo(o.x2, o.y2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- overlays ----------
  function drawGhost(G) {
    var gh = G.ghost;
    if (!gh) return;
    var def = D.BUILDINGS[gh.type];
    var ok = global.Game.canPlace(gh.type, gh.gx, gh.gy) && G.res.scrap >= global.Game.effCost(gh.type);
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#ffffff';
    for (var gy = 1; gy < GH - 1; gy++) {
      for (var gx = 1; gx < GW - 1; gx++) {
        if ((gx + gy) % 2) continue;
        if (G.grid[gy * GW + gx]) continue;
        ctx.fillRect(gx * TILE + 7, gy * TILE + 7, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
    var px = gh.gx * TILE, py = gh.gy * TILE;
    var w = (def.w || 1) * TILE, h = (def.h || 1) * TILE;
    if (def.range) {
      var r = def.range * (1 + global.Game.tech('range') * 0.05);
      ctx.strokeStyle = ok ? 'rgba(79,209,197,0.55)' : 'rgba(224,87,79,0.5)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(px + w / 2, py + h / 2, r, 0, 6.3);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = ok ? '#4fd1c5' : '#e0574f';
    ctx.fillRect(px, py, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ok ? '#a9f2ea' : '#ff9a92';
    ctx.strokeRect(px + 0.5, py + 0.5, w - 1, h - 1);
  }

  function drawSelection(G) {
    var b = G.selected;
    if (!b || b.dead) return;
    var px = b.gx * TILE, py = b.gy * TILE, w = b.w * TILE, h = b.h * TILE;
    ctx.strokeStyle = '#f0b54a';
    ctx.setLineDash([2, 2]);
    ctx.lineDashOffset = -(performance.now() / 90) % 4;
    ctx.strokeRect(px - 1.5, py - 1.5, w + 3, h + 3);
    ctx.setLineDash([]);
    if (b.def.range) {
      ctx.strokeStyle = 'rgba(240,181,74,0.4)';
      ctx.beginPath();
      ctx.arc(b.cx, b.cy, global.Game.rangeOf(b), 0, 6.3);
      ctx.stroke();
    }
  }

  // ---------- frame ----------
  function frame(G, dt) {
    var target = G.waveState === 'combat' ? 0.34 : 0.06;
    tint += (target - tint) * Math.min(1, dt * 0.8);

    if (shake > 0) {
      shake -= dt * 3;
      shakeX = (Math.random() - 0.5) * shake * 6;
      shakeY = (Math.random() - 0.5) * shake * 6;
    } else { shakeX = shakeY = 0; }

    ctx.save();
    ctx.translate(Math.round(shakeX), Math.round(shakeY));
    ctx.drawImage(terrain, 0, 0);

    G.rubble.forEach(function (r) {
      ctx.globalAlpha = Math.min(1, r.life / 3);
      ctx.drawImage(S.rubble, Math.round(r.x - 8), Math.round(r.y - 8));
      ctx.globalAlpha = 1;
    });

    drawGhost(G);

    var order = G.buildings.slice().sort(function (a, b) { return (a.gy + a.h) - (b.gy + b.h); });
    order.forEach(function (b) { drawBuilding(b, G); });

    G.soldiers.forEach(drawSoldier);
    G.enemies.slice().sort(function (a, b) { return a.y - b.y; }).forEach(drawEnemy);
    G.projectiles.forEach(drawProjectile);
    G.beams.forEach(drawBeam);

    G.particles.forEach(function (p) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max));
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    });
    ctx.globalAlpha = 1;

    drawSelection(G);

    // night tint during a wave
    if (tint > 0.01) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(24,26,64,' + tint.toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    // torchlight around the core so the base stays readable at night
    if (tint > 0.05 && G.core) {
      var gr = ctx.createRadialGradient(G.core.cx, G.core.cy, 8, G.core.cx, G.core.cy, 150);
      gr.addColorStop(0, 'rgba(255,214,140,0.16)');
      gr.addColorStop(1, 'rgba(255,214,140,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, W, H);
    }

    G.floaters.forEach(function (f) {
      ctx.globalAlpha = Math.min(1, f.life);
      ctx.font = '8px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#000';
      ctx.fillText(f.text, Math.round(f.x) + 1, Math.round(f.y) + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, Math.round(f.x), Math.round(f.y));
      ctx.globalAlpha = 1;
    });
    ctx.textAlign = 'left';

    ctx.restore();

    if (G.paused) {
      ctx.fillStyle = 'rgba(8,8,14,0.55)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#f0b54a';
      ctx.font = '16px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('— PAUSED —', W / 2, H / 2);
      ctx.textAlign = 'left';
    }
  }

  global.Render = {
    init: init,
    frame: frame,
    kick: function (amount) { shake = Math.max(shake, amount); },
    W: W, H: H
  };
})(window);
