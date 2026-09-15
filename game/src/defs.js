/* ============================================================
   Hollow Bastion — game data
   Structures, monsters, research and wave composition.
   ============================================================ */
(function (global) {
  'use strict';

  var TILE = 16;
  var GW = 40, GH = 30;              // grid size in tiles (640 x 480 px)
  var CORE = { gx: 19, gy: 14, w: 2, h: 2 };
  var BORDER = 1;                    // outer ring kept clear for spawns

  // ------------------------------------------------------------
  //  Structures
  // ------------------------------------------------------------
  var BUILDINGS = {
    core: {
      key: 'core', name: 'Bastion Core', w: 2, h: 2, hp: 1600, cost: 0, repairBase: 700,
      blocks: true, powerGen: 10, indestructible: false, hidden: true,
      desc: 'The heart of the bastion. Lose it and the horde overruns the site.'
    },
    wall: {
      key: 'wall', name: 'Rampart', w: 1, h: 1, hp: 260, cost: 12, blocks: true,
      unlock: 0, desc: 'Cheap stone. Monsters prefer to walk around it, and chew through it when they cannot.'
    },
    arrow: {
      key: 'arrow', name: 'Bolt Tower', w: 1, h: 1, hp: 120, cost: 40, power: 2, blocks: true,
      range: 78, dmg: 9, rate: 1.25, proj: 'bolt', unlock: 0,
      desc: 'Reliable single-target fire. The backbone of every line.'
    },
    miner: {
      key: 'miner', name: 'Scrap Drill', w: 1, h: 1, hp: 150, cost: 55, power: 2, blocks: true,
      produce: { scrap: 0.55 }, unlock: 0,
      desc: 'Chews the ruins below into usable scrap, awake or asleep.'
    },
    gen: {
      key: 'gen', name: 'Dynamo', w: 1, h: 1, hp: 140, cost: 70, powerGen: 12, blocks: true,
      unlock: 0, desc: 'Supplies power. Without a surplus every powered structure runs slow.'
    },
    cannon: {
      key: 'cannon', name: 'Mortar', w: 1, h: 1, hp: 190, cost: 120, power: 5, blocks: true,
      range: 96, dmg: 30, rate: 0.5, proj: 'shell', splash: 26, unlock: 3,
      desc: 'Lobbed shells that burst on impact. Slow, heavy, loves a crowd.'
    },
    lab: {
      key: 'lab', name: 'Reliquary', w: 1, h: 1, hp: 120, cost: 200, power: 3, blocks: true,
      produce: { cores: 0.035 }, unlock: 5,
      desc: 'Distills raw cores from monster residue. Idle income for research.'
    },
    frost: {
      key: 'frost', name: 'Frost Spire', w: 1, h: 1, hp: 120, cost: 180, power: 5, blocks: true,
      range: 70, dmg: 5, rate: 1.5, proj: 'ice', slow: 0.45, slowTime: 2.2, unlock: 7,
      desc: 'Little damage, but everything it touches crawls.'
    },
    medic: {
      key: 'medic', name: 'Drone Bay', w: 1, h: 1, hp: 130, cost: 220, power: 4, blocks: true,
      repair: 7, range: 80, unlock: 9,
      desc: 'Repair drones patch damaged structures in range, for free.'
    },
    tesla: {
      key: 'tesla', name: 'Arc Coil', w: 1, h: 1, hp: 150, cost: 340, power: 9, blocks: true,
      range: 84, dmg: 18, rate: 0.85, chain: 3, chainFalloff: 0.7, unlock: 12,
      desc: 'Lightning that leaps between targets. Power hungry.'
    },
    barracks: {
      key: 'barracks', name: 'Barracks', w: 1, h: 1, hp: 240, cost: 420, power: 6, blocks: true,
      squad: 2, respawn: 9, soldierHp: 90, soldierDmg: 11, range: 120, unlock: 15,
      desc: 'Fields sentries that leave the wall and meet the horde head on.'
    }
  };

  var BUILD_ORDER = ['wall', 'arrow', 'miner', 'gen', 'cannon', 'lab', 'frost', 'medic', 'tesla', 'barracks'];

  // Per-structure upgrade curve
  function upgradeCost(def, lvl) { return Math.ceil(def.cost * 0.8 * Math.pow(1.55, lvl - 1)); }
  function powerScale(lvl) { return 1 + (lvl - 1) * 0.15; }      // draw grows slower than output
  function statScale(lvl) { return Math.pow(1.18, lvl - 1); }
  function hpScale(lvl) { return Math.pow(1.16, lvl - 1); }

  // ------------------------------------------------------------
  //  Monsters
  // ------------------------------------------------------------
  var ENEMIES = {
    slime: {
      key: 'slime', name: 'Sludge', sprite: 'slime', hp: 34, speed: 20, dmg: 8, atkRate: 0.9,
      r: 6, cores: 1.0, scrap: 2, from: 1, weight: 10
    },
    hound: {
      key: 'hound', name: 'Ripper', sprite: 'hound', hp: 26, speed: 46, dmg: 6, atkRate: 1.5,
      r: 6, cores: 1.3, scrap: 2, from: 3, weight: 8
    },
    bat: {
      key: 'bat', name: 'Screecher', sprite: 'bat', hp: 30, speed: 40, dmg: 7, atkRate: 1.2,
      r: 6, cores: 1.8, scrap: 3, from: 5, weight: 6, flying: true
    },
    spitter: {
      key: 'spitter', name: 'Spitter', sprite: 'spitter', hp: 55, speed: 22, dmg: 12, atkRate: 0.8,
      r: 7, cores: 2.4, scrap: 4, from: 7, weight: 5, ranged: 54
    },
    brute: {
      key: 'brute', name: 'Brute', sprite: 'brute', hp: 190, speed: 15, dmg: 26, atkRate: 0.65,
      r: 8, cores: 4.5, scrap: 8, from: 9, weight: 4, armor: 2
    },
    boss: {
      key: 'boss', name: 'Warlord', sprite: 'boss', hp: 1500, speed: 13, dmg: 70, atkRate: 0.6,
      r: 13, cores: 60, scrap: 60, from: 10, weight: 0, armor: 6, boss: true
    }
  };

  // Difficulty curve
  function waveHpMul(w) { return 1 + 0.22 * (w - 1) + 0.036 * Math.pow(w - 1, 1.85); }
  function waveDmgMul(w) { return 1 + 0.13 * (w - 1); }
  function waveRewardMul(w) { return 1 + 0.07 * (w - 1); }

  /** Roster for a wave: [{key, count, elite}] plus spawn cadence. */
  function waveComp(w) {
    var pool = [], k;
    for (k in ENEMIES) {
      var e = ENEMIES[k];
      if (e.weight > 0 && w >= e.from) pool.push(e);
    }
    if (!pool.length) pool.push(ENEMIES.slime);
    var total = Math.min(70, Math.round(4 + w * 1.35));
    var totalW = pool.reduce(function (s, e) { return s + e.weight; }, 0);
    var out = [];
    var assigned = 0;
    pool.forEach(function (e, i) {
      var n = i === pool.length - 1 ? total - assigned : Math.round(total * e.weight / totalW);
      n = Math.max(1, n);
      assigned += n;
      out.push({ key: e.key, count: n });
    });
    if (w % 10 === 0) out.push({ key: 'boss', count: 1 + Math.floor(w / 30) });
    var eliteChance = w < 12 ? 0 : Math.min(0.45, (w - 11) * 0.03);
    return { list: out, eliteChance: eliteChance, interval: Math.max(0.22, 0.75 - w * 0.008) };
  }

  var ELITE = { hp: 3.2, dmg: 1.7, cores: 3.0, speed: 0.9 };

  // ------------------------------------------------------------
  //  Research (spend Cores)
  // ------------------------------------------------------------
  var TECH = [
    { id: 'dmg', name: 'Ordnance', max: 40, base: 18, growth: 1.28, step: 0.12,
      desc: function (l) { return '+' + (l * 12) + '% turret damage'; } },
    { id: 'rate', name: 'Autoloaders', max: 30, base: 26, growth: 1.32, step: 0.08,
      desc: function (l) { return '+' + (l * 8) + '% turret fire rate'; } },
    { id: 'range', name: 'Optics', max: 15, base: 40, growth: 1.38, step: 0.05,
      desc: function (l) { return '+' + (l * 5) + '% turret range'; } },
    { id: 'hp', name: 'Reinforcement', max: 30, base: 22, growth: 1.3, step: 0.15,
      desc: function (l) { return '+' + (l * 15) + '% structure integrity'; } },
    { id: 'mine', name: 'Deep Bores', max: 40, base: 16, growth: 1.27, step: 0.16,
      desc: function (l) { return '+' + (l * 16) + '% scrap production'; } },
    { id: 'salvage', name: 'Salvaging', max: 30, base: 30, growth: 1.3, step: 0.12,
      desc: function (l) { return '+' + (l * 12) + '% cores from kills'; } },
    { id: 'grid', name: 'Power Grid', max: 25, base: 24, growth: 1.29, step: 8,
      desc: function (l) { return '+' + (l * 8) + ' power capacity'; } },
    { id: 'regen', name: 'Core Lattice', max: 20, base: 34, growth: 1.34, step: 0.6,
      desc: function (l) { return 'Core regenerates ' + (l * 0.6).toFixed(1) + ' hp/s'; } },
    { id: 'thrift', name: 'Logistics', max: 20, base: 28, growth: 1.33, step: 0.025,
      desc: function (l) { return '-' + (l * 2.5).toFixed(1) + '% build cost'; } }
  ];
  var TECH_BY_ID = {};
  TECH.forEach(function (t) { TECH_BY_ID[t.id] = t; });
  function techCost(t, lvl) { return Math.ceil(t.base * Math.pow(t.growth, lvl)); }

  global.Defs = {
    TILE: TILE, GW: GW, GH: GH, CORE: CORE, BORDER: BORDER,
    BUILDINGS: BUILDINGS, BUILD_ORDER: BUILD_ORDER,
    upgradeCost: upgradeCost, statScale: statScale, hpScale: hpScale, powerScale: powerScale,
    ENEMIES: ENEMIES, ELITE: ELITE,
    waveHpMul: waveHpMul, waveDmgMul: waveDmgMul, waveRewardMul: waveRewardMul, waveComp: waveComp,
    TECH: TECH, TECH_BY_ID: TECH_BY_ID, techCost: techCost
  };
})(window);
