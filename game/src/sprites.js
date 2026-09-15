/* ============================================================
   Hollow Bastion — sprite system
   Every graphic in the game is generated at runtime from either
   hand-authored pixel maps (strings + palette) or small procedural
   painters. No external image assets.
   ============================================================ */
(function (global) {
  'use strict';

  // ---------- low level pixel canvas helpers ----------
  function newCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    return c;
  }

  function hex(c) {
    if (c.length === 4) {
      c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    }
    return [parseInt(c.substr(1, 2), 16), parseInt(c.substr(3, 2), 16), parseInt(c.substr(5, 2), 16)];
  }

  /**
   * Build a canvas from an array of equal-length strings.
   * opts.mirror mirrors the map horizontally (authored half -> symmetric whole).
   * opts.scale draws each source pixel as a scale x scale block.
   */
  function fromMap(name, rows, palette, opts) {
    opts = opts || {};
    var sw = 0, i;
    for (i = 0; i < rows.length; i++) sw = Math.max(sw, rows[i].length);
    for (i = 0; i < rows.length; i++) {
      if (rows[i].length !== sw) {
        console.warn('[sprite ' + name + '] row ' + i + ' is ' + rows[i].length + ' wide, expected ' + sw);
        while (rows[i].length < sw) rows[i] += '.';
      }
    }
    var sh = rows.length;
    var w = opts.mirror ? sw * 2 : sw;
    var buf = newCanvas(w, sh);
    var g = buf.getContext('2d');
    var img = g.createImageData(w, sh);
    var cache = {};
    function put(x, y, rgb) {
      var o = (y * w + x) * 4;
      img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
    }
    for (var y = 0; y < sh; y++) {
      for (var x = 0; x < sw; x++) {
        var ch = rows[y][x];
        if (ch === '.' || ch === ' ') continue;
        var col = palette[ch];
        if (!col) { console.warn('[sprite ' + name + '] unknown palette key "' + ch + '"'); continue; }
        var rgb = cache[ch] || (cache[ch] = hex(col));
        put(x, y, rgb);
        if (opts.mirror) put(w - 1 - x, y, rgb);
      }
    }
    g.putImageData(img, 0, 0);
    if (!opts.scale || opts.scale === 1) return buf;
    var out = newCanvas(w * opts.scale, sh * opts.scale);
    var og = out.getContext('2d');
    og.imageSmoothingEnabled = false;
    og.drawImage(buf, 0, 0, out.width, out.height);
    return out;
  }

  /** Per-pixel painter: cb(x, y) -> '#rrggbb' or null. */
  function paint(w, h, cb) {
    var c = newCanvas(w, h);
    var g = c.getContext('2d');
    var img = g.createImageData(w, h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var col = cb(x, y);
        if (!col) continue;
        var rgb = hex(col);
        var o = (y * w + x) * 4;
        img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  /** Hue/brightness swap of an existing sprite (used for elite / boss variants). */
  function recolor(src, fn, scale) {
    scale = scale || 1;
    var w = src.width, h = src.height;
    var tmp = newCanvas(w, h);
    var tg = tmp.getContext('2d');
    tg.drawImage(src, 0, 0);
    var img = tg.getImageData(0, 0, w, h);
    for (var i = 0; i < img.data.length; i += 4) {
      if (img.data[i + 3] === 0) continue;
      var o = fn(img.data[i], img.data[i + 1], img.data[i + 2]);
      img.data[i] = o[0]; img.data[i + 1] = o[1]; img.data[i + 2] = o[2];
    }
    tg.putImageData(img, 0, 0);
    if (scale === 1) return tmp;
    var out = newCanvas(w * scale, h * scale);
    var og = out.getContext('2d');
    og.imageSmoothingEnabled = false;
    og.drawImage(tmp, 0, 0, out.width, out.height);
    return out;
  }

  /** White silhouette flash used for hit feedback. */
  function flashOf(src) {
    var c = newCanvas(src.width, src.height);
    var g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  // ---------- deterministic noise ----------
  function hash2(x, y, seed) {
    var n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  }

  /** Smoothed value noise, grid cell = 1 unit. */
  function vnoise(x, y, seed) {
    var x0 = Math.floor(x), y0 = Math.floor(y);
    var fx = x - x0, fy = y - y0;
    var sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    var a = hash2(x0, y0, seed), b = hash2(x0 + 1, y0, seed);
    var c = hash2(x0, y0 + 1, seed), d = hash2(x0 + 1, y0 + 1, seed);
    var top = a + (b - a) * sx, bot = c + (d - c) * sx;
    return top + (bot - top) * sy;
  }

  function fbm(x, y, seed) {
    return vnoise(x, y, seed) * 0.6 + vnoise(x * 2.1, y * 2.1, seed + 31) * 0.28 +
           vnoise(x * 4.3, y * 4.3, seed + 71) * 0.12;
  }

  // ============================================================
  //  Palettes
  // ============================================================
  var P = {
    stone: { D: '#191822', S: '#454a5b', L: '#767d92', H: '#575d70', M: '#565c6f' },
    wall:  { D: '#1b1a24', L: '#8b93a8', S: '#6a7186', M: '#565c70' },
    arrow: { D: '#15141c', w: '#7d4f2c', W: '#c98d51', m: '#dbe2f2' },
    cannon:{ D: '#15141c', m: '#cbd3e6', M: '#77809a' },
    frost: { D: '#16222e', c: '#8fe3ff', C: '#3fa9d8', g: '#e8fbff' },
    tesla: { D: '#1b1a24', g: '#d6fbff', c: '#5ce1f0', m: '#9aa3ba', M: '#5b6175' },
    miner: { D: '#1b1a24', M: '#6d7488', m: '#9aa3ba', a: '#f0b54a', r: '#b06a3a', k: '#343a4b' },
    gen:   { D: '#1b1a24', M: '#6d7488', m: '#9aa3ba', t: '#2f9d95', T: '#8ff0e6', k: '#343a4b' },
    lab:   { D: '#1b1a24', w: '#dfe4f0', W: '#98a1b8', v: '#8a63d6', V: '#dcc8ff', k: '#343a4b' },
    medic: { D: '#1b1a24', m: '#aab3c8', M: '#6d7488', g: '#7ec96b', G: '#bff0a8', k: '#343a4b' },
    barr:  { D: '#1b1a24', r: '#8e4a38', R: '#b5674c', s: '#a2926f', S: '#6e6249', k: '#3a3324', a: '#f0b54a' },
    rubble:{ D: '#14131b', S: '#4b5062', s: '#767d92' },
    slime: { D: '#14210d', g: '#5aa83c', G: '#8bd85f', d: '#2f6b22', e: '#eaffdd', p: '#16240f' },
    hound: { D: '#1a1020', f: '#6b4494', F: '#9464c9', d: '#41265c', e: '#ff6b5c', t: '#f2e8ff' },
    bat:   { D: '#1b1024', b: '#5c3f75', B: '#8a66ad', e: '#ffd166' },
    brute: { D: '#200f14', s: '#9c5142', S: '#c47259', d: '#63302a', e: '#ffe066', m: '#8a93a8' },
    spit:  { D: '#0f2019', g: '#3f9077', G: '#6fcaa6', d: '#255a4a', e: '#ffe066', p: '#e85f96' },
    sold:  { D: '#12131c', u: '#3f6fae', U: '#78acea', s: '#e8b58c', m: '#9aa3ba' }
  };

  // ============================================================
  //  Hand-authored pixel maps
  // ============================================================
  var MAPS = {
    // Tower platform (all turrets sit on this)
    plat: ['.....DDDDDD.....',
           '...DDSSSSSSDD...',
           '..DSLLLLLLLLSD..',
           '.DSLLLLLLLLLLSD.',
           'DSLLLLLLLLLLLLSD',
           'DSLLLLHHHHLLLLSD',
           'DSLLLHHHHHHLLLSD',
           'DSLLLHHHHHHLLLSD',
           'DSLLLHHHHHHLLLSD',
           'DSLLLHHHHHHLLLSD',
           'DSLLLLHHHHLLLLSD',
           'DSMMMMMMMMMMMMSD',
           '.DSMMMMMMMMMMSD.',
           '..DSMMMMMMMMSD..',
           '...DDSSSSSSDD...',
           '.....DDDDDD.....'],

    wall: ['DDDDDDDDDDDDDDDD',
           'DLLLLLLDLLLLLLLD',
           'DSSSSSSDSSSSSSSD',
           'DMSSSSSDMSSSSSSD',
           'DDDDDDDDDDDDDDDD',
           'DLLLDLLLLLLLDLLD',
           'DSSSDSSSSSSSDSSD',
           'DMSSDMSSSSSSDMSD',
           'DDDDDDDDDDDDDDDD',
           'DLLLLLLDLLLLLLLD',
           'DSSSSSSDSSSSSSSD',
           'DMSSSSSDMSSSSSSD',
           'DDDDDDDDDDDDDDDD',
           'DLLLDLLLLLLLDLLD',
           'DSSSDSSSSSSSDSSD',
           'DDDDDDDDDDDDDDDD'],

    // Turret heads, all drawn pointing right, pivot = centre of canvas
    gunArrow: ['................',
               '................',
               '..........D.....',
               '.........DmD....',
               '.........DmD....',
               '...DDDDDDDmmD...',
               '..DwWWWWWWmmmD..',
               '..DwWWWWWWWmmmD.',
               '..DwWWWWWWmmmD..',
               '...DDDDDDDmmD...',
               '.........DmD....',
               '.........DmD....',
               '..........D.....',
               '................',
               '................',
               '................'],

    gunCannon: ['................',
                '................',
                '................',
                '................',
                '....DDDDDD......',
                '...DmmmmmmDDDD..',
                '..DmMMMMMMmmmmD.',
                '..DmMMMMMMmmmmmD',
                '..DmMMMMMMmmmmD.',
                '...DmmmmmmDDDD..',
                '....DDDDDD......',
                '................',
                '................',
                '................',
                '................',
                '................'],

    gunFrost: ['................',
               '................',
               '................',
               '.......D........',
               '......DcD.......',
               '.....DcccD......',
               '....DcCCcDD.....',
               '....DcCCccgD....',
               '....DcCCcDD.....',
               '.....DcccD......',
               '......DcD.......',
               '.......D........',
               '................',
               '................',
               '................',
               '................'],

    coil: ['................',
           '................',
           '......DDDD......',
           '.....DggggD.....',
           '.....DgccgD.....',
           '......DccD......',
           '.......DD.......',
           '......DmmD......',
           '.....DmmmmD.....',
           '......DmmD......',
           '.....DmmmmD.....',
           '......DmmD......',
           '.....DMMMMD.....',
           '....DMMMMMMD....',
           '....DDDDDDDD....',
           '................'],

    miner: ['................',
            '.....DDDD.......',
            '....DaaaaD......',
            '....DaMMaD......',
            '...DDaaaaDD.....',
            '...DmMMMMmD.....',
            '...DmMkkMmDDD...',
            '...DmMkkMmDrD...',
            '...DmMMMMmDrD...',
            '..DDmmmmmmDrD...',
            '..DMMMMMMMDrD...',
            '..DMkkkkkMDrD...',
            '..DMMMMMMMDDD...',
            '..DDDDDDDDD.....',
            '................',
            '................'],

    gen: ['................',
          '....DDDDDDDD....',
          '...DmmmmmmmmD...',
          '...DmMMMMMMmD...',
          '..DDmMttttMmDD..',
          '..DkmMtTTtMmkD..',
          '..DkmMtTTtMmkD..',
          '..DkmMttttMmkD..',
          '..DDmMMMMMMmDD..',
          '...DmmmmmmmmD...',
          '...DMkMkMkMkD...',
          '...DMMMMMMMMD...',
          '...DDDDDDDDDD...',
          '................',
          '................',
          '................'],

    lab: ['................',
          '.......v........',
          '......DVD.......',
          '.....DVVVD......',
          '....DwWWWwD.....',
          '...DwWWWWWwD....',
          '...DwWvvvWwD....',
          '...DwWvVvWwD....',
          '..DDwWvvvWwDD...',
          '..DkwWWWWWwkD...',
          '..DkwwwwwwwkD...',
          '..DkkkkkkkkkD...',
          '..DDDDDDDDDDD...',
          '................',
          '................',
          '................'],

    medic: ['.......G........',
            '.......D........',
            '..DDDDDDDDDDDD..',
            '..DmmmmmmmmmmD..',
            '..DmMMMggMMMmD..',
            '..DmMMggggMMmD..',
            '..DmMMggggMMmD..',
            '..DmMMMggMMMmD..',
            '..DmmmmmmmmmmD..',
            '..DMkMkMkMkMkD..',
            '..DDDDDDDDDDDD..',
            '................',
            '................',
            '................',
            '................',
            '................'],

    barracks: ['.......Da.......',
               '.......Da.......',
               '.......DD.......',
               '....DDDDDDDD....',
               '...DRRRRRRRRD...',
               '..DRRrrrrrrRRD..',
               '.DRRrrrrrrrrRRD.',
               'DDDDDDDDDDDDDDDD',
               'DsssDDDDDDDDsssD',
               'DsSsDkkkkkkDsSsD',
               'DsssDkkkkkkDsssD',
               'DsSsDkkkkkkDsSsD',
               'DsssDDDDDDDDsssD',
               'DDDDDDDDDDDDDDDD',
               '................',
               '................'],

    rubble: ['................',
             '................',
             '................',
             '................',
             '.....DD.........',
             '....DSSD...DD...',
             '....DSsSD.DSSD..',
             '..DDDSsSDDSsSD..',
             '..DSsSSsSSSsSD..',
             '.DSsssSssSsssSD.',
             '.DDDDDDDDDDDDDD.',
             '................',
             '................',
             '................',
             '................',
             '................'],

    // ---- monsters ----
    slime: ['................',
            '................',
            '................',
            '.....DDDDDD.....',
            '...DDGGGGGGDD...',
            '..DGGGGGGGGGGD..',
            '..DGGeGGGGeGGD..',
            '..DGGpGGGGpGGD..',
            '.DGggggggggggGD.',
            '.DggggggggggggD.',
            '.DggggddddggggD.',
            '.DddddddddddddD.',
            '..DDDDDDDDDDDD..',
            '................',
            '................',
            '................'],

    hound: ['................',
            '................',
            '..........DD.DD.',
            '.........DFFDFFD',
            '..DDDDDDDFFFFFFD',
            '.DFFFFFFFFFeFFtD',
            '.DffffffffFFFFFD',
            '.DffffffffffffD.',
            '..DdddddddddddD.',
            '..DdD.DdD.DdD...',
            '..DDD.DDD.DDD...',
            '................',
            '................',
            '................',
            '................',
            '................'],

    bat: ['................',
          '................',
          '................',
          '................',
          '.DD..........DD.',
          'DBBD...DD...DBBD',
          'DBbbDDDbbDDDbbBD',
          '.DbbbbDbbDbbbbD.',
          '...DDbbDeeDbbDD.',
          '......DbeebD....',
          '.......DbbD.....',
          '........DD......',
          '................',
          '................',
          '................',
          '................'],

    brute: ['................',
            '....DDDDDD......',
            '...DSSSSSSD.....',
            '...DSeSSeSD.....',
            '...DSSssSSD..DD.',
            '....DssssD..DmD.',
            '..DDDDssDDDDDmD.',
            '.DSSssssssSSDmD.',
            '.DSssssssssSDDD.',
            '.DdssssssssdD...',
            '..DdddddddD.....',
            '..DdD..DdD......',
            '..DdD..DdD......',
            '..DDD..DDD......',
            '................',
            '................'],

    spitter: ['................',
              '................',
              '................',
              '......DDDD......',
              '.....DGGGGD.....',
              '....DGeGGeGD....',
              '....DGGppGGD....',
              '...DGGGGGGGGD...',
              '..DGgggppgggGD..',
              '..DGggggggggGD..',
              '..DdggggggggdD..',
              '...DddddddddD...',
              '...DDDDDDDDDD...',
              '....D.DD.D......',
              '................',
              '................'],

    soldier: ['................',
              '................',
              '................',
              '......DDD.......',
              '.....DmmmD......',
              '.....DsssD......',
              '....DDuuuDD.....',
              '....DUuuuUD.....',
              '....DUuuuUDmD...',
              '....DDuuuDDmD...',
              '.....DuDuD..D...',
              '.....DDDDD......',
              '................',
              '................',
              '................',
              '................']
  };

  // ============================================================
  //  Procedural sprites
  // ============================================================

  // The Core: a 32x32 crystal reactor on a stepped plinth.
  function makeCore() {
    var S = 32, cx = 15.5;
    return paint(S, S, function (x, y) {
      var dx = Math.abs(x - cx);
      // plinth
      if (y >= 20) {
        var half = y < 23 ? 8 : (y < 26 ? 10 : 12);
        if (dx > half + 0.5) return null;
        if (dx > half - 0.5 || y === 20 || y === 31) return '#16151d';
        var band = (y - 20) % 3;
        if (y >= 29) return band === 0 ? '#4b5062' : '#3c4052';
        return band === 0 ? '#8d94aa' : (band === 1 ? '#767d92' : '#5b6175');
      }
      // crystal: diamond from y=2 (tip) to y=20
      var top = 2, bot = 20, mid = 11;
      var half2 = y <= mid ? (y - top) * 0.62 : (bot - y) * 0.78;
      if (dx > half2) return null;
      if (dx > half2 - 1.2) return '#16323a';
      var glow = 1 - (dx / Math.max(1, half2));
      if (y < 7) return glow > 0.55 ? '#d8fffb' : '#7fe9df';
      if (glow > 0.72) return '#d8fffb';
      if (glow > 0.42) return '#59d2c8';
      if (glow > 0.18) return '#2e9a95';
      return '#1d6a6b';
    });
  }

  // Scenery blobs (non-blocking decoration).
  function makeDecor() {
    var rock = paint(10, 8, function (x, y) {
      var dx = (x - 4.5) / 4.6, dy = (y - 5) / 3.2;
      var d = dx * dx + dy * dy;
      if (d > 1) return null;
      if (d > 0.72) return '#3b3f4d';
      return y < 4 ? '#7b8296' : '#5c6376';
    });
    var bush = paint(12, 10, function (x, y) {
      var dx = (x - 5.5) / 5.4, dy = (y - 6) / 4.2;
      var d = dx * dx + dy * dy;
      if (d > 1) return null;
      if (d > 0.74) return '#1f4423';
      if (hash2(x, y, 9) > 0.7) return '#3f8b42';
      return y < 5 ? '#357a3a' : '#2a622f';
    });
    var flower = paint(5, 5, function (x, y) {
      if (x === 2 && y > 2) return '#2f6b34';
      var d = Math.abs(x - 2) + Math.abs(y - 1);
      if (d === 0) return '#ffe9a8';
      if (d === 1) return '#e8d06a';
      return null;
    });
    var bone = paint(9, 6, function (x, y) {
      if (y === 2 && x > 1 && x < 7) return '#d8d3c2';
      if ((x === 1 || x === 7) && (y === 1 || y === 3)) return '#c4bfae';
      if (x === 3 && y === 4) return '#b9b3a2';
      return null;
    });
    return [rock, bush, flower, bone];
  }

  // ============================================================
  //  Public sprite table
  // ============================================================
  var S = {};
  function build() {
    S.plat = fromMap('plat', MAPS.plat, P.stone);
    S.wall = fromMap('wall', MAPS.wall, P.wall);
    S.gunArrow = fromMap('gunArrow', MAPS.gunArrow, P.arrow);
    S.gunCannon = fromMap('gunCannon', MAPS.gunCannon, P.cannon);
    S.gunFrost = fromMap('gunFrost', MAPS.gunFrost, P.frost);
    S.coil = fromMap('coil', MAPS.coil, P.tesla);
    S.miner = fromMap('miner', MAPS.miner, P.miner);
    S.gen = fromMap('gen', MAPS.gen, P.gen);
    S.lab = fromMap('lab', MAPS.lab, P.lab);
    S.medic = fromMap('medic', MAPS.medic, P.medic);
    S.barracks = fromMap('barracks', MAPS.barracks, P.barr);
    S.rubble = fromMap('rubble', MAPS.rubble, P.rubble);
    S.core = makeCore();

    S.slime = fromMap('slime', MAPS.slime, P.slime);
    S.hound = fromMap('hound', MAPS.hound, P.hound);
    S.bat = fromMap('bat', MAPS.bat, P.bat);
    S.brute = fromMap('brute', MAPS.brute, P.brute);
    S.spitter = fromMap('spitter', MAPS.spitter, P.spit);
    S.soldier = fromMap('soldier', MAPS.soldier, P.sold);

    // Warlord: the brute, twice the size, forge-hot palette.
    S.boss = recolor(S.brute, function (r, g, b) {
      return [Math.min(255, r * 1.25 + 40), Math.max(0, g * 0.62), Math.max(0, b * 0.7)];
    }, 2);
    // Elites are the same silhouette with a cold, hardened palette.
    S.eliteOf = {};
    ['slime', 'hound', 'bat', 'brute', 'spitter'].forEach(function (k) {
      S.eliteOf[k] = recolor(S[k], function (r, g, b) {
        return [Math.min(255, r * 0.55 + 60), Math.min(255, g * 0.7 + 70), Math.min(255, b * 0.9 + 110)];
      });
    });

    S.flash = {};
    ['slime', 'hound', 'bat', 'brute', 'spitter', 'boss', 'soldier'].forEach(function (k) {
      S.flash[k] = flashOf(S[k]);
    });

    S.decor = makeDecor();
    return S;
  }

  global.Sprites = {
    table: S,
    build: build,
    newCanvas: newCanvas,
    paint: paint,
    fromMap: fromMap,
    recolor: recolor,
    hash2: hash2,
    vnoise: vnoise,
    fbm: fbm
  };
})(window);
