import { CONFIG } from './config.js';

// ─── Level ────────────────────────────────────────────────────────────────────

export function getActiveLevel() {
  return localStorage.getItem('active_level') || 'college';
}

export function setActiveLevel(level) {
  localStorage.setItem('active_level', level);
}

// ─── Daily seed ───────────────────────────────────────────────────────────────

function getDailySeed() {
  return new Date().toISOString().slice(0, 10);
}

function seededRandom(seed, index) {
  const str = seed + '_' + index;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) / 2147483647;
}

// ─── Questions ────────────────────────────────────────────────────────────────

export function getDailyQuestions(allQuestions, category, count = CONFIG.QUESTIONS_PER_CATEGORY) {
  const seed = getDailySeed();
  const pool = allQuestions[category];
  const level = getActiveLevel();
  const seen = getSeenIds(category, level);
  const fresh = pool.filter(q => !seen.includes(q.id));
  const source = fresh.length >= count ? fresh : pool;

  const shuffled = [...source].sort((a, b) =>
    seededRandom(seed, a.id) - seededRandom(seed, b.id)
  );
  return shuffled.slice(0, count);
}

export function getSeenIds(category, level = getActiveLevel()) {
  try {
    const raw = localStorage.getItem(`seen_${level}_${category}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function markQuestionsAsSeen(category, ids) {
  const level = getActiveLevel();
  const existing = getSeenIds(category, level);
  const merged = [...new Set([...existing, ...ids])];
  localStorage.setItem(`seen_${level}_${category}`, JSON.stringify(merged.slice(-200)));
}

// ─── Play state (namespaced by level) ─────────────────────────────────────────

export function hasPlayedToday() {
  const today = new Date().toISOString().slice(0, 10);
  const level = getActiveLevel();
  return localStorage.getItem(`last_play_${level}`) === today;
}

export function markPlayedToday(scores, wrongAnswers = []) {
  const today = new Date().toISOString().slice(0, 10);
  const level = getActiveLevel();
  localStorage.setItem(`last_play_${level}`, today);
  localStorage.setItem(`scores_${level}_${today}`, JSON.stringify(scores));
  localStorage.setItem(`wrong_${level}_${today}`, JSON.stringify(wrongAnswers));

  const total = Object.values(scores).reduce((s, c) => s + c.correct, 0);
  const best = getBestScore();
  if (best === null || total > best.total) {
    localStorage.setItem(`best_score_${level}`, JSON.stringify({ total, date: today }));
  }
}

export function getTodayScores() {
  const today = new Date().toISOString().slice(0, 10);
  const level = getActiveLevel();
  try {
    const raw = localStorage.getItem(`scores_${level}_${today}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getTodayWrongAnswers() {
  const today = new Date().toISOString().slice(0, 10);
  const level = getActiveLevel();
  try {
    const raw = localStorage.getItem(`wrong_${level}_${today}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function getBestScore() {
  const level = getActiveLevel();
  try {
    const raw = localStorage.getItem(`best_score_${level}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
