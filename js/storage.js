import { CONFIG } from './config.js';

function getDailySeed() {
  return new Date().toISOString().slice(0, 10); // "2026-04-02"
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

export function getDailyQuestions(allQuestions, category, count = CONFIG.QUESTIONS_PER_CATEGORY) {
  const seed = getDailySeed();
  const pool = allQuestions[category];
  const seen = getSeenIds(category);
  const fresh = pool.filter(q => !seen.includes(q.id));
  const source = fresh.length >= count ? fresh : pool;

  const shuffled = [...source].sort((a, b) => {
    return seededRandom(seed, a.id) - seededRandom(seed, b.id);
  });
  return shuffled.slice(0, count);
}

export function getSeenIds(category) {
  try {
    const raw = localStorage.getItem(`seen_${category}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function markQuestionsAsSeen(category, ids) {
  const existing = getSeenIds(category);
  const merged = [...new Set([...existing, ...ids])];
  // Keep only last 200 to avoid localStorage bloat
  const trimmed = merged.slice(-200);
  localStorage.setItem(`seen_${category}`, JSON.stringify(trimmed));
}

export function hasPlayedToday() {
  const today = new Date().toISOString().slice(0, 10);
  return localStorage.getItem('last_play_date') === today;
}

export function markPlayedToday(scores, wrongAnswers = []) {
  const today = new Date().toISOString().slice(0, 10);
  localStorage.setItem('last_play_date', today);
  localStorage.setItem(`scores_${today}`, JSON.stringify(scores));
  localStorage.setItem(`wrong_${today}`, JSON.stringify(wrongAnswers));

  // Update best score
  const total = Object.values(scores).reduce((s, c) => s + c.correct, 0);
  const best = getBestScore();
  if (best === null || total > best.total) {
    localStorage.setItem('best_score', JSON.stringify({ total, date: today }));
  }
}

export function getTodayScores() {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const raw = localStorage.getItem(`scores_${today}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getTodayWrongAnswers() {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const raw = localStorage.getItem(`wrong_${today}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function getBestScore() {
  try {
    const raw = localStorage.getItem('best_score');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
