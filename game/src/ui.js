/* ============================================================
   Hollow Bastion — interface, input and sound
   ============================================================ */
(function (global) {
  'use strict';

  var D = global.Defs, Game = global.Game, S;
  var TILE = D.TILE;
  var el = {}, canvas, scale = 1, hoverTile = { gx: -1, gy: -1 };
  var bannerTimer = 0;

  function $(id) { return document.getElementById(id); }
  function fmt(n) {
    n = Math.floor(n);
    if (n < 1000) return '' + n;
    if (n < 1e6) return (n / 1000).toFixed(n < 1e4 ? 1 : 0) + 'k';
    if (n < 1e9) return (n / 1e6).toFixed(2) + 'M';
    return (n / 1e9).toFixed(2) + 'B';
  }
  function fmt1(n) { return n >= 100 ? fmt(n) : (Math.round(n * 10) / 10).toFixed(1); }
  function dur(s) {
    s = Math.floor(s);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h) return h + 'h ' + m + 'm';
    if (m) return m + 'm ' + (s % 60) + 's';
    return s + 's';
  }

  // ------------------------------------------------------------
  //  Sound — a few synthesised blips, no assets
  // ------------------------------------------------------------
  var AC = null, master = null;
  function audio() {
    if (AC) return AC;
    var Ctor = global.AudioContext || global.webkitAudioContext;
    if (!Ctor) return null;
    AC = new Ctor();
    master = AC.createGain();
    master.gain.value = 0.35;
    master.connect(AC.destination);
    return AC;
  }
  function tone(freq, freq2, dur, type, vol) {
    var ac = audio();
    if (!ac || !Game.state.sound) return;
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, ac.currentTime);
    if (freq2) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), ac.currentTime + dur);
    g.gain.setValueAtTime(vol || 0.15, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    o.connect(g); g.connect(master);
    o.start(); o.stop(ac.currentTime + dur + 0.02);
  }
  function noise(dur, vol, filt) {
    var ac = audio();
    if (!ac || !Game.state.sound) return;
    var len = Math.floor(ac.sampleRate * dur);
    var buf = ac.createBuffer(1, len, ac.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ac.createBufferSource(); src.buffer = buf;
    var bp = ac.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = filt || 900;
    var g = ac.createGain(); g.gain.value = vol || 0.2;
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start();
  }
  var SFX = {
    shoot: function (v) { tone(760, 420, 0.06, 'square', 0.05 * (v || 1)); },
    boom: function (v) { noise(0.25, 0.22 * (v || 1), 500); },
    ice: function (v) { tone(1200, 700, 0.12, 'triangle', 0.05 * (v || 1)); },
    zap: function (v) { tone(200, 1400, 0.09, 'sawtooth', 0.05 * (v || 1)); },
    spit: function (v) { tone(300, 160, 0.1, 'sawtooth', 0.05 * (v || 1)); },
    slash: function (v) { noise(0.07, 0.1 * (v || 1), 2200); },
    die: function (v) { tone(320, 90, 0.14, 'square', 0.06 * (v || 1)); },
    bossdie: function () { tone(160, 40, 0.8, 'sawtooth', 0.22); noise(0.6, 0.25, 400); },
    thud: function (v) { noise(0.09, 0.14 * (v || 1), 260); },
    build: function () { tone(420, 720, 0.1, 'square', 0.12); },
    upgrade: function () { tone(600, 1100, 0.16, 'triangle', 0.14); },
    sell: function () { tone(700, 300, 0.12, 'triangle', 0.12); },
    deny: function () { tone(180, 120, 0.12, 'square', 0.1); },
    crumble: function () { noise(0.4, 0.2, 350); },
    wave: function () { tone(220, 330, 0.5, 'sawtooth', 0.14); },
    clear: function () { tone(520, 880, 0.3, 'triangle', 0.14); },
    overrun: function () { tone(300, 60, 1.2, 'sawtooth', 0.28); noise(1.0, 0.3, 300); }
  };

  // ------------------------------------------------------------
  //  Icons for the build palette
  // ------------------------------------------------------------
  function iconFor(type) {
    var c = global.Sprites.newCanvas(16, 16);
    var g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    switch (type) {
      case 'wall': g.drawImage(S.wall, 0, 0); break;
      case 'arrow': g.drawImage(S.plat, 0, 0); g.drawImage(S.gunArrow, 0, -2); break;
      case 'cannon': g.drawImage(S.plat, 0, 0); g.drawImage(S.gunCannon, 0, -2); break;
      case 'frost': g.drawImage(S.plat, 0, 0); g.drawImage(S.gunFrost, 0, -2); break;
      case 'tesla': g.drawImage(S.plat, 0, 0); g.drawImage(S.coil, 0, -3); break;
      case 'miner': g.drawImage(S.miner, 0, 0); break;
      case 'gen': g.drawImage(S.gen, 0, 0); break;
      case 'lab': g.drawImage(S.lab, 0, 0); break;
      case 'medic': g.drawImage(S.medic, 0, 0); break;
      case 'barracks': g.drawImage(S.barracks, 0, 0); break;
      default: g.drawImage(S.wall, 0, 0);
    }
    return c;
  }
  function spriteThumb(img, size) {
    var c = global.Sprites.newCanvas(size, size);
    var g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(img, (size - img.width) / 2 | 0, (size - img.height) / 2 | 0);
    return c;
  }

  // ------------------------------------------------------------
  //  Build palette
  // ------------------------------------------------------------
  var buildEls = {};
  function makeBuildList() {
    var host = $('build-list');
    host.innerHTML = '';
    D.BUILD_ORDER.forEach(function (type, i) {
      var def = D.BUILDINGS[type];
      var b = document.createElement('button');
      b.className = 'build-item';
      b.dataset.type = type;
      var icon = iconFor(type);
      icon.className = 'bi-icon';
      b.appendChild(icon);
      var txt = document.createElement('div');
      txt.className = 'bi-text';
      txt.innerHTML = '<div class="bi-name">' + (i < 9 ? '<span class="muted">' + (i + 1) + '</span> ' : '') + def.name +
        '</div><div class="bi-cost"><span class="c"></span>' +
        (def.power ? '<span class="pw">⚡' + def.power + '</span>' : '') +
        (def.powerGen ? '<span class="pw">+⚡' + def.powerGen + '</span>' : '') + '</div>';
      b.appendChild(txt);
      b.title = def.name + ' — ' + def.desc;
      b.addEventListener('click', function () { selectBuild(type); });
      host.appendChild(b);
      buildEls[type] = b;
    });
  }

  function selectBuild(type) {
    var G = Game.state;
    if (!Game.unlocked(type)) { SFX.deny(); return; }
    if (G.ghost && G.ghost.type === type) { G.ghost = null; }
    else G.ghost = { type: type, gx: hoverTile.gx, gy: hoverTile.gy };
    G.selected = null;
    refreshBuildList();
    refreshSelection();
  }

  function refreshBuildList() {
    var G = Game.state;
    D.BUILD_ORDER.forEach(function (type) {
      var def = D.BUILDINGS[type], b = buildEls[type];
      var lock = !Game.unlocked(type);
      b.classList.toggle('locked', lock);
      b.classList.toggle('active', !!G.ghost && G.ghost.type === type);
      var cost = Game.effCost(type);
      b.classList.toggle('poor', !lock && G.res.scrap < cost);
      b.querySelector('.bi-cost .c').textContent = lock ? ('wave ' + def.unlock) : (cost + ' scrap');
    });
  }

  // ------------------------------------------------------------
  //  Sidebar panels
  // ------------------------------------------------------------
  function refreshTop() {
    var G = Game.state;
    $('stat-scrap').querySelector('.val').textContent = fmt(G.res.scrap);
    $('stat-scrap').querySelector('.rate').textContent = '+' + fmt1(G.prod.scrap * G.power.eff) + '/s';
    $('stat-cores').querySelector('.val').textContent = fmt(G.res.cores);
    $('stat-cores').querySelector('.rate').textContent = '+' + (G.prod.cores * G.power.eff).toFixed(2) + '/s';
    $('stat-power').querySelector('.val').textContent = Math.round(G.power.use) + '/' + Math.round(G.power.gen);
    $('stat-power').querySelector('.rate').textContent = G.power.eff < 1 ? Math.round(G.power.eff * 100) + '%' : 'ok';
    $('stat-power').querySelector('.rate').style.color = G.power.eff < 1 ? '#e0574f' : '';
    $('stat-relic').querySelector('.val').textContent = G.relics;
    $('stat-relic').querySelector('.rate').textContent = '+' + Math.round(G.relics * 6) + '%';
  }

  function refreshWavePane() {
    var G = Game.state;
    $('wave-num').textContent = G.wave;
    var st = $('wave-state');
    st.textContent = G.waveState === 'prep' ? 'PREPARING' : 'COMBAT';
    st.classList.toggle('combat', G.waveState === 'combat');
    var fill = $('wave-fill'), label = $('wave-label');
    if (G.waveState === 'prep') {
      var span = Math.max(12, 30 - G.wave * 0.3);
      fill.style.width = (100 - Math.min(100, G.waveTimer / span * 100)) + '%';
      label.textContent = 'next wave in ' + Math.ceil(G.waveTimer) + 's';
    } else {
      var left = G.spawnQueue.length + G.enemies.length;
      fill.style.width = (G.waveTotal ? (G.waveKilled / G.waveTotal * 100) : 0) + '%';
      label.textContent = left + ' hostiles left';
    }
    $('btn-call').disabled = G.waveState !== 'prep';

    var core = G.core;
    if (core) {
      var f = core.hp / core.maxHp;
      var cf = $('core-fill');
      cf.style.width = (f * 100) + '%';
      cf.className = f > 0.5 ? '' : (f > 0.25 ? 'hurt' : 'crit');
      $('core-label').textContent = Math.ceil(core.hp) + ' / ' + core.maxHp;
    }
    refreshPreview();
  }

  var previewFor = -1;
  function refreshPreview() {
    var G = Game.state;
    var w = G.wave + (G.waveState === 'prep' ? 1 : 0);
    var key = w + G.waveState;
    if (key === previewFor) return;
    previewFor = key;
    var comp = D.waveComp(w);
    var host = $('wave-preview');
    host.innerHTML = '<div class="muted small" style="margin-bottom:4px">' +
      (G.waveState === 'prep' ? 'INCOMING WAVE ' + w : 'CURRENT WAVE') + '</div>';
    comp.list.forEach(function (row) {
      var e = D.ENEMIES[row.key];
      var d = document.createElement('div');
      d.className = 'prev-row';
      d.appendChild(spriteThumb(e.sprite === 'boss' ? S.boss : S[e.sprite], 20));
      var n = document.createElement('span');
      n.textContent = e.name;
      d.appendChild(n);
      var c = document.createElement('span');
      c.className = 'cnt';
      c.textContent = 'x' + row.count;
      d.appendChild(c);
      host.appendChild(d);
    });
    if (comp.eliteChance > 0) {
      var note = document.createElement('div');
      note.className = 'muted small';
      note.textContent = Math.round(comp.eliteChance * 100) + '% chance of elites';
      host.appendChild(note);
    }
  }

  function statRow(k, v, cls) {
    return '<div class="kv"><span>' + k + '</span><b class="' + (cls || '') + '">' + v + '</b></div>';
  }

  var selSig = '';
  function refreshSelection(force) {
    var G = Game.state, host = $('selection'), b = G.selected;
    if (!b || b.dead) {
      if (selSig !== 'none') { host.innerHTML = '<p class="muted small">Click a structure to inspect it.</p>'; selSig = 'none'; }
      return;
    }
    // Rebuilding the panel every frame would eat clicks, so only redraw when
    // something the panel actually shows has changed.
    var canUp = G.res.scrap >= D.upgradeCost(b.def, b.lvl);
    var canFix = G.res.scrap >= Game.repairCost(b);
    var sig = b.id + '|' + b.lvl + '|' + Math.round(b.hp) + '|' + canUp + '|' + canFix + '|' + Math.round(G.power.eff * 100);
    if (sig === selSig && !force) return;
    selSig = sig;
    var def = b.def;
    var html = '<div class="sel-head"><span id="sel-icon"></span><div>' +
      '<div class="sel-name">' + def.name + '</div>' +
      '<div class="sel-lvl">Level ' + b.lvl + '</div></div></div>';
    html += statRow('Integrity', Math.ceil(b.hp) + ' / ' + b.maxHp);
    if (def.dmg && def.range) {
      var dps = Game.dmgOf(b) * Game.rateOf(b) * (def.chain ? 1 + (def.chain - 1) * def.chainFalloff : 1);
      html += statRow('Damage', fmt1(Game.dmgOf(b)));
      html += statRow('Fire rate', Game.rateOf(b).toFixed(2) + '/s');
      html += statRow('DPS', fmt1(dps * G.power.eff));
      html += statRow('Range', Math.round(Game.rangeOf(b)));
      if (def.splash) html += statRow('Splash', Math.round(def.splash));
      if (def.slow) html += statRow('Slow', Math.round(def.slow * 100) + '% for ' + def.slowTime + 's');
      if (def.chain) html += statRow('Chains', def.chain);
    }
    if (def.produce && def.produce.scrap) html += statRow('Scrap', '+' + fmt1(Game.prodOf(b, 'scrap') * G.power.eff) + '/s');
    if (def.produce && def.produce.cores) html += statRow('Cores', '+' + (Game.prodOf(b, 'cores') * G.power.eff).toFixed(3) + '/s');
    if (def.powerGen) html += statRow('Power out', '+' + Math.round(Game.powerGen(b)));
    if (def.power) html += statRow('Power draw', Math.round(Game.powerUse(b)));
    if (def.repair) html += statRow('Repairs', Math.round(def.repair * D.statScale(b.lvl)) + ' hp/s');
    if (def.squad) html += statRow('Sentries', def.squad + Math.floor((b.lvl - 1) / 2));

    if (b.type !== 'core') {
      var up = D.upgradeCost(def, b.lvl);
      html += '<div class="row2" style="margin-top:8px">' +
        '<button class="btn" id="sel-up"' + (G.res.scrap < up ? ' disabled' : '') + '>UPGRADE<br><small>' + up + '</small></button>' +
        '<button class="btn danger" id="sel-sell">SELL<br><small>+' + Math.floor(Game.investedIn(b) * 0.5) + '</small></button>' +
        '</div>';
      var rc = Game.repairCost(b);
      if (rc > 0) html += '<button class="btn wide" id="sel-fix"' + (G.res.scrap < rc ? ' disabled' : '') + '>REPAIR <small>' + rc + ' scrap</small></button>';
    } else {
      html += '<p class="muted small" style="margin-top:8px">Protect the core. If it falls the horde razes the site and you lose ground.</p>';
    }
    html += '<p class="muted small" style="margin-top:6px">' + def.desc + '</p>';
    host.innerHTML = html;

    var icoHost = $('sel-icon');
    if (icoHost) {
      var ic = b.type === 'core' ? spriteThumb(S.core, 32) : spriteThumb(iconFor(b.type), 28);
      icoHost.appendChild(ic);
    }
    var up1 = $('sel-up'); if (up1) up1.onclick = function () { Game.upgrade(b); refreshAll(); };
    var sl = $('sel-sell'); if (sl) sl.onclick = function () { Game.sell(b); refreshAll(); };
    var fx = $('sel-fix'); if (fx) fx.onclick = function () {
      var c = Game.repairCost(b);
      if (G.res.scrap >= c) { G.res.scrap -= c; b.hp = b.maxHp; SFX.upgrade(); refreshAll(); }
    };
  }

  var techEls = {};
  function makeTechList() {
    var host = $('tech-list');
    host.innerHTML = '';
    D.TECH.forEach(function (t) {
      var d = document.createElement('div');
      d.className = 'tech';
      d.innerHTML = '<div class="tech-top"><span class="tech-name">' + t.name + '</span>' +
        '<span class="tech-lv"></span></div><div class="tech-desc"></div>';
      var btn = document.createElement('button');
      btn.className = 'btn';
      btn.onclick = function () { Game.buyTech(t.id); refreshTech(); refreshTop(); };
      d.appendChild(btn);
      host.appendChild(d);
      techEls[t.id] = { lv: d.querySelector('.tech-lv'), desc: d.querySelector('.tech-desc'), btn: btn };
    });
  }

  function refreshTech() {
    var G = Game.state;
    D.TECH.forEach(function (t) {
      var e = techEls[t.id];
      if (!e) return;
      var lvl = Game.tech(t.id);
      var maxed = lvl >= t.max;
      var cost = D.techCost(t, lvl);
      e.lv.textContent = lvl + '/' + t.max;
      e.desc.innerHTML = lvl ? t.desc(lvl) : '<span class="muted">' + t.desc(1) + ' per level</span>';
      var label = maxed ? 'MAXED' : ('RESEARCH — ' + fmt(cost) + ' cores');
      if (e.btn.textContent !== label) e.btn.textContent = label;
      e.btn.disabled = maxed || G.res.cores < cost;
    });
  }

  function refreshBase() {
    var G = Game.state, host = $('base-stats');
    var counts = {};
    G.buildings.forEach(function (b) { counts[b.type] = (counts[b.type] || 0) + 1; });
    var dps = 0;
    G.buildings.forEach(function (b) {
      if (b.def.dmg && b.def.range) {
        dps += Game.dmgOf(b) * Game.rateOf(b) * (b.def.chain ? 1 + (b.def.chain - 1) * b.def.chainFalloff : (b.def.splash ? 2 : 1));
      }
    });
    var html = statRow('Wave record', G.maxWave) +
      statRow('Kills', fmt(G.kills)) +
      statRow('Structures', G.buildings.length) +
      statRow('Theoretical DPS', fmt1(dps * G.power.eff)) +
      statRow('Power', Math.round(G.power.use) + ' / ' + Math.round(G.power.gen), G.power.eff < 1 ? 'up' : '') +
      statRow('Scrap rate', '+' + fmt1(G.prod.scrap * G.power.eff) + '/s') +
      statRow('Core rate', '+' + (G.prod.cores * G.power.eff).toFixed(3) + '/s') +
      statRow('Times overrun', G.overruns) +
      statRow('Bastion age', dur((Date.now() - G.born) / 1000));
    host.innerHTML = html;

    var total = 0;
    G.buildings.forEach(function (b) { total += Game.repairCost(b); });
    $('repair-cost').textContent = total > 0 ? total + ' scrap' : 'nothing damaged';
    $('btn-repair').disabled = total === 0 || G.res.scrap < 1;

    var gain = Game.relicGain();
    $('prestige-info').innerHTML = gain > 0
      ? 'Rebuilding now grants <b class="relic-gain">+' + gain + ' relics</b> (total ' + (G.relics + gain) + ', ' + Math.round((G.relics + gain) * 6) + '% bonus).'
      : '<span class="muted">Reach a higher wave to earn relics. Next relic at wave ' + nextRelicWave() + '.</span>';
    $('btn-prestige').disabled = gain <= 0;
  }

  function nextRelicWave() {
    for (var w = Math.max(15, Game.state.maxWave + 1); w < 500; w++) {
      if (Math.floor(Math.pow(w / 7, 1.35)) > Game.state.relics) return w;
    }
    return '—';
  }

  function refreshAll() {
    refreshTop();
    refreshBuildList();
    refreshWavePane();
    refreshSelection(true);
    refreshTech();
    refreshBase();
    Game.state.dirtyUI = false;
  }

  /** Cheap periodic refresh driven by the main loop (a few times a second). */
  function poll() {
    refreshTop();
    refreshBuildList();
    refreshWavePane();
    refreshSelection(false);
    var tab = document.querySelector('.tab.active');
    var which = tab ? tab.dataset.tab : 'wave';
    if (which === 'tech') refreshTech();
    else if (which === 'base') refreshBase();
    Game.state.dirtyUI = false;
  }

  // ------------------------------------------------------------
  //  Log & banner
  // ------------------------------------------------------------
  function pushLog(msg, cls) {
    var ul = $('log');
    var li = document.createElement('li');
    li.className = cls || '';
    li.textContent = '› ' + msg;
    ul.insertBefore(li, ul.firstChild);
    while (ul.children.length > 8) ul.removeChild(ul.lastChild);
  }

  function banner(text, cls) {
    var b = $('wave-banner');
    b.textContent = text;
    b.className = 'show ' + (cls || '');
    bannerTimer = 1.8;
  }

  // ------------------------------------------------------------
  //  Modal
  // ------------------------------------------------------------
  function modal(title, bodyHtml, actions) {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = bodyHtml;
    var host = $('modal-actions');
    host.innerHTML = '';
    (actions || [{ label: 'CLOSE' }]).forEach(function (a) {
      var btn = document.createElement('button');
      btn.className = 'btn' + (a.danger ? ' danger' : '');
      btn.textContent = a.label;
      btn.onclick = function () { closeModal(); if (a.fn) a.fn(); };
      host.appendChild(btn);
    });
    $('modal').classList.remove('hidden');
  }
  function closeModal() { $('modal').classList.add('hidden'); }

  function showMenu() {
    var G = Game.state;
    modal('BASTION MENU',
      '<p>Wave record <b>' + G.maxWave + '</b> · <b>' + fmt(G.kills) + '</b> kills · <b>' + G.relics + '</b> relics.</p>' +
      '<p class="muted small" style="margin-top:8px">Progress saves automatically to this browser. ' +
      'Closing the tab is fine — your drills keep working and waves keep falling while you are away.</p>' +
      '<div style="margin-top:10px"><b>Hotkeys</b><br>1–9 pick a structure · ESC cancel · Space pause · ' +
      'U upgrade · X sell · R repair all · C call wave</div>',
      [
        { label: 'SAVE NOW', fn: function () { Game.save(); pushLog('Game saved.', 'good'); } },
        { label: 'WIPE SAVE', danger: true, fn: confirmReset },
        { label: 'CLOSE' }
      ]);
  }

  function confirmReset() {
    modal('WIPE SAVE?',
      '<p>This erases the bastion, all research and all relics. There is no undo.</p>',
      [
        { label: 'DELETE EVERYTHING', danger: true, fn: function () { Game.hardReset(); refreshAll(); pushLog('Save wiped. A new bastion rises.', 'warn'); } },
        { label: 'CANCEL' }
      ]);
  }

  function showIntro() {
    modal('HOLLOW BASTION',
      '<p>The wilds send something new every night. You have a crystal core, a patch of ruined ground, ' +
      'and whatever you can bolt together before dark.</p>' +
      '<ul class="steps">' +
      '<li><b>Mine.</b> Scrap Drills earn scrap even while the tab is closed.</li>' +
      '<li><b>Build.</b> Towers fight for you — you never aim a shot.</li>' +
      '<li><b>Research.</b> Monsters drop Cores; spend them on permanent upgrades.</li>' +
      '<li><b>Rebuild.</b> Trade a deep run for Relics and start again stronger.</li>' +
      '</ul>' +
      '<p class="muted small" style="margin-top:10px">Pick a structure on the left (or press 1–9) and click the ground to place it. ' +
      'Wave 1 arrives in half a minute — the first one is easy.</p>',
      [{ label: 'HOLD THE LINE' }]);
  }

  function showOffline(rep) {
    if (!rep || (rep.scrap < 1 && rep.cores < 1 && !rep.waves)) return;
    modal('WHILE YOU WERE AWAY',
      '<p>' + dur(rep.seconds) + ' passed.</p>' +
      statRow('Scrap mined', '+' + fmt(rep.scrap)) +
      statRow('Cores collected', '+' + fmt1(rep.cores)) +
      statRow('Waves repelled', rep.waves) +
      (rep.stalled
        ? '<p class="muted small" style="margin-top:8px">Your defences stalled out — the line could not clear a wave on its own. Build more firepower to keep progressing offline.</p>'
        : '<p class="muted small" style="margin-top:8px">The line held the whole time.</p>'),
      [{ label: 'BACK TO WORK' }]);
  }

  // ------------------------------------------------------------
  //  Canvas input
  // ------------------------------------------------------------
  function resize() {
    var wrap = $('canvas-wrap');
    var pad = 16;
    var sx = (wrap.clientWidth - pad) / Render.W;
    var sy = (wrap.clientHeight - pad) / Render.H;
    var s = Math.min(sx, sy);
    scale = s >= 1 ? Math.max(1, Math.floor(s * 4) / 4) : s;
    canvas.style.width = (Render.W * scale) + 'px';
    canvas.style.height = (Render.H * scale) + 'px';
  }

  function toTile(ev) {
    var r = canvas.getBoundingClientRect();
    var x = (ev.clientX - r.left) / r.width * Render.W;
    var y = (ev.clientY - r.top) / r.height * Render.H;
    return { gx: Math.floor(x / TILE), gy: Math.floor(y / TILE), x: x, y: y };
  }

  function bindCanvas() {
    canvas.addEventListener('pointermove', function (ev) {
      var t = toTile(ev);
      hoverTile = t;
      var G = Game.state;
      if (G.ghost) { G.ghost.gx = t.gx; G.ghost.gy = t.gy; }
    });
    canvas.addEventListener('pointerleave', function () {
      var G = Game.state;
      if (G.ghost) { G.ghost.gx = -99; G.ghost.gy = -99; }
    });
    canvas.addEventListener('contextmenu', function (ev) {
      ev.preventDefault();
      var G = Game.state;
      var t = toTile(ev);
      var b = Game.buildingAt(t.gx, t.gy);
      if (G.ghost) { G.ghost = null; refreshBuildList(); }
      else if (b && b.type !== 'core') { Game.sell(b); }
      refreshAll();
    });
    canvas.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      ev.preventDefault();
      audio();
      var G = Game.state;
      var t = toTile(ev);
      if (G.ghost) {
        var placed = Game.tryPlace(G.ghost.type, t.gx, t.gy);
        if (placed && !ev.shiftKey && G.res.scrap < Game.effCost(G.ghost.type)) {
          // out of scrap: keep the ghost, the player will see it turn red
        }
      } else {
        var b = Game.buildingAt(t.gx, t.gy);
        G.selected = b || null;
      }
      refreshAll();
    });
    // drag-paint walls
    canvas.addEventListener('pointermove', function (ev) {
      if (ev.buttons !== 1) return;
      var G = Game.state;
      if (!G.ghost) return;
      var t = toTile(ev);
      Game.tryPlace(G.ghost.type, t.gx, t.gy);
    });
  }

  function bindKeys() {
    document.addEventListener('keydown', function (ev) {
      var G = Game.state;
      if (ev.target && /input|textarea/i.test(ev.target.tagName)) return;
      var n = parseInt(ev.key, 10);
      if (n >= 1 && n <= 9 && D.BUILD_ORDER[n - 1]) { selectBuild(D.BUILD_ORDER[n - 1]); return; }
      switch (ev.key.toLowerCase()) {
        case 'escape': G.ghost = null; G.selected = null; closeModal(); refreshAll(); break;
        case ' ': ev.preventDefault(); togglePause(); break;
        case 'u': if (G.selected) { Game.upgrade(G.selected); refreshAll(); } break;
        case 'x': if (G.selected) { Game.sell(G.selected); refreshAll(); } break;
        case 'r': Game.repairAll(); refreshAll(); break;
        case 'c': Game.callWave(); refreshAll(); break;
        case 'p': togglePause(); break;
      }
    });
  }

  function togglePause() {
    var G = Game.state;
    G.paused = !G.paused;
    $('btn-pause').textContent = G.paused ? '▶' : '❚❚';
  }

  function bindChrome() {
    $('btn-pause').onclick = togglePause;
    $('btn-speed').onclick = function () {
      var G = Game.state;
      G.speed = G.speed === 1 ? 2 : (G.speed === 2 ? 4 : 1);
      this.textContent = G.speed + 'x';
    };
    $('btn-sound').onclick = function () {
      var G = Game.state;
      G.sound = !G.sound;
      this.style.opacity = G.sound ? 1 : 0.4;
      if (G.sound) { audio(); SFX.build(); }
      Game.save();
    };
    $('btn-menu').onclick = showMenu;
    $('btn-call').onclick = function () { Game.callWave(); refreshAll(); };
    $('btn-repair').onclick = function () { Game.repairAll(); refreshAll(); };
    $('btn-prestige').onclick = function () {
      var gain = Game.relicGain();
      modal('EVACUATE THE BASTION?',
        '<p>Everything you have built and researched is lost.</p>' +
        '<p style="margin-top:6px">You keep <b class="relic-gain">' + (Game.state.relics + gain) + ' relics</b>, worth ' +
        '<b>+' + Math.round((Game.state.relics + gain) * 6) + '%</b> damage and production forever, and start with extra scrap.</p>',
        [
          { label: 'REBUILD', danger: true, fn: function () { Game.prestige(); refreshAll(); } },
          { label: 'STAY' }
        ]);
    };
    document.querySelectorAll('.tab').forEach(function (t) {
      t.onclick = function () {
        document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
        document.querySelectorAll('.tabpane').forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        $('pane-' + t.dataset.tab).classList.add('active');
        refreshAll();
      };
    });
    $('modal').addEventListener('click', function (ev) { if (ev.target === this) closeModal(); });
    global.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', function () { if (document.hidden) Game.save(); });
    global.addEventListener('beforeunload', function () { Game.save(); });
  }

  function tickUi(dt) {
    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0) $('wave-banner').className = '';
    }
  }

  function init(cv, offlineReport) {
    S = global.Sprites.table;
    canvas = cv;
    makeBuildList();
    makeTechList();
    bindCanvas();
    bindKeys();
    bindChrome();
    resize();
    $('btn-sound').style.opacity = Game.state.sound ? 1 : 0.4;
    Game.on('log', pushLog);
    Game.on('banner', banner);
    Game.on('sfx', function (name, vol) { if (SFX[name]) SFX[name](vol); });
    refreshAll();
    pushLog('Bastion online. Build drills, raise towers, hold the line.', 'good');
    if (offlineReport) showOffline(offlineReport);
    else if (Game.state.isNew) showIntro();
  }

  global.UI = { init: init, refreshAll: refreshAll, poll: poll, tick: tickUi, resize: resize, showOffline: showOffline };
})(window);
