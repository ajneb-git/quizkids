#!/usr/bin/env node
// Génère data/compte-defi.json : 150 puzzles CEB pré-calculés (50 × 3 niveaux)

const fs = require('fs');
const path = require('path');

// ─── Solver (copie de app.js) ────────────────────────────────────────────────

function cebEval(op, a, b) {
  if (op === '+') return a + b;
  if (op === '-') return a > b ? a - b : NaN;
  if (op === '×') return a * b;
  if (op === '÷') return b > 1 && a % b === 0 ? a / b : NaN;
  return NaN;
}

function cebSolve(numbers, target, nodeLimit = 400000) {
  let nodeCount = 0;
  function dfs(pool) {
    if (++nodeCount > nodeLimit) return null;
    for (const item of pool) {
      if (item.v === target) return item.ops;
    }
    if (pool.length < 2) return null;
    for (let i = 0; i < pool.length; i++) {
      for (let j = 0; j < pool.length; j++) {
        if (i === j) continue;
        const a = pool[i], b = pool[j];
        for (const op of ['+', '-', '×', '÷']) {
          const r = cebEval(op, a.v, b.v);
          if (!r || !isFinite(r) || r <= 0 || r > 9999 || !Number.isInteger(r)) continue;
          const newItem = {
            v: r,
            ops: [...a.ops, ...b.ops, { a: a.v, op, b: b.v, r }]
          };
          const newPool = pool.filter((_, k) => k !== i && k !== j).concat(newItem);
          const sol = dfs(newPool);
          if (sol) return sol;
        }
      }
    }
    return null;
  }
  return dfs(numbers.map(n => ({ v: n, ops: [] })));
}

// ─── Tirage des nombres ───────────────────────────────────────────────────────

function shuffle(arr) { return [...arr].sort(() => Math.random() - 0.5); }

function pickNumbers(largePlates = 2) {
  const small = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).slice(0, 6 - largePlates);
  const large = shuffle([25, 50, 75, 100]).slice(0, largePlates);
  return [...small, ...large];
}

// ─── Génération par niveau ────────────────────────────────────────────────────

const LEVELS = {
  facile: {
    // 2-3 opérations, pas de division, cible 30-350
    numbers:  () => pickNumbers(1),           // 1 grande plaque → calculs plus simples
    target:   () => 30 + Math.floor(Math.random() * 320),
    minOps: 2, maxOps: 3,
    needMult: false, allowDiv: false,
  },
  moyen: {
    // 3-4 opérations, au moins une multiplication, cible 100-750
    numbers:  () => pickNumbers(2),
    target:   () => 100 + Math.floor(Math.random() * 650),
    minOps: 3, maxOps: 4,
    needMult: true, allowDiv: false,
  },
  difficile: {
    // 4-5 opérations, division autorisée, cible 400-999
    numbers:  () => pickNumbers(2),
    target:   () => 400 + Math.floor(Math.random() * 600),
    minOps: 4, maxOps: 5,
    needMult: true, allowDiv: true,
  },
};

function generateOne(level) {
  const cfg = LEVELS[level];
  for (let attempt = 0; attempt < 2000; attempt++) {
    const numbers = cfg.numbers();
    const target  = cfg.target();
    const ops     = cebSolve(numbers, target);
    if (!ops) continue;
    if (ops.length < cfg.minOps || ops.length > cfg.maxOps) continue;
    if (cfg.needMult && !ops.some(o => o.op === '×')) continue;
    if (!cfg.allowDiv && ops.some(o => o.op === '÷'))  continue;
    return { n: numbers, t: target, ops };
  }
  return null;
}

function generatePool(level, count) {
  const pool   = [];
  const usedT  = new Set();
  let   fails  = 0;

  while (pool.length < count && fails < count * 30) {
    const p = generateOne(level);
    if (!p || usedT.has(p.t)) { fails++; continue; }
    pool.push(p);
    usedT.add(p.t);
    if (pool.length % 10 === 0) process.stdout.write(`  ${level} : ${pool.length}/${count}\n`);
  }
  return pool;
}

// ─── Vérification ─────────────────────────────────────────────────────────────

function verify(puzzle) {
  // Rejoue chaque étape et s'assure que la dernière vaut t
  const available = new Set(puzzle.n);
  let last = null;
  for (const op of puzzle.ops) {
    const r = cebEval(op.op, op.a, op.b);
    if (r !== op.r) return false;
    last = r;
  }
  return last === puzzle.t;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log('Génération en cours…\n');

const tiers = ['facile', 'moyen', 'difficile'].map(level => {
  console.log(`── ${level.toUpperCase()} ──`);
  const pool = generatePool(level, 50);

  const invalid = pool.filter(p => !verify(p));
  if (invalid.length) {
    console.error(`⚠️  ${invalid.length} puzzles invalides dans ${level} !`);
    process.exit(1);
  }

  console.log(`  ✓ ${pool.length} puzzles vérifiés\n`);
  return { label: level.charAt(0).toUpperCase() + level.slice(1), pool };
});

const total = tiers.reduce((s, t) => s + t.pool.length, 0);
console.log(`Total : ${total} puzzles`);

const outPath = path.join(__dirname, '..', 'data', 'compte-defi.json');
fs.writeFileSync(outPath, JSON.stringify({ tiers }, null, 2));
console.log(`✅  Écrit dans ${outPath}`);
