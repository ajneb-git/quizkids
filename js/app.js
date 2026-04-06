import { CONFIG, LEVEL_CONFIG } from './config.js';
import { getActiveLevel, setActiveLevel, hasPlayedToday, getTodayScores, getTodayWrongAnswers, getBestScore, markPlayedToday } from './storage.js';
import { loadQuestions, prepareQuestions, QuizEngine } from './quiz.js';
import { renderResults, renderEncouragingMessage, renderWrongAnswers, renderComeBackTomorrow, setupShareButton } from './results.js';
import { decodeScores, getRefFromHash, getShareUrl } from './share.js';

let quizEngine = null;
let allQuestions = null;
let currentLevelKey = null;
let deferredInstallPrompt = null;

// ─── Level helpers ────────────────────────────────────────────────────────────

function getLevelConf() {
  return LEVEL_CONFIG[getActiveLevel()];
}

// ─── Notifications ────────────────────────────────────────────────────────────

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') { await registerPeriodicSync(); return true; }
  if (Notification.permission === 'denied') return false;
  const permission = await Notification.requestPermission();
  if (permission === 'granted') { await registerPeriodicSync(); updateNotifButton(true); return true; }
  return false;
}

async function registerPeriodicSync() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('periodicSync' in reg) {
      await reg.periodicSync.register('daily-quiz-reminder', { minInterval: 12 * 60 * 60 * 1000 });
    }
  } catch (e) {
    console.info('Periodic sync not available:', e.message);
  }
}

async function persistPlayDateForSW(date) {
  try {
    const cache = await caches.open('quizkids-state');
    await cache.put('/state/last-play-date', new Response(date, { headers: { 'Content-Type': 'text/plain' } }));
  } catch { /* ignore */ }
}

function updateNotifButton(enabled) {
  const btn = document.getElementById('btn-notif');
  if (!btn) return;
  btn.textContent = enabled ? '🔔 Rappel activé' : '🔕 Me rappeler chaque matin';
  btn.classList.toggle('notif-active', enabled);
}

function isNotifEnabled() {
  return 'Notification' in window && Notification.permission === 'granted';
}

// ─── PWA install ──────────────────────────────────────────────────────────────

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const btn = document.getElementById('btn-install');
  if (btn) btn.style.display = 'flex';
});

window.addEventListener('appinstalled', () => {
  const btn = document.getElementById('btn-install');
  if (btn) btn.style.display = 'none';
  deferredInstallPrompt = null;
});

// ─── Screen management ────────────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(`screen-${id}`);
  if (el) el.classList.add('active');
}

// ─── Level selector ───────────────────────────────────────────────────────────

function renderLevelSelector() {
  const active = getActiveLevel();
  document.querySelectorAll('.level-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.level === active);
  });
  // Update banner & play button label
  renderHome();
}

// ─── Home screen ──────────────────────────────────────────────────────────────

function renderHome() {
  const level = getActiveLevel();
  const levelConf = LEVEL_CONFIG[level];
  const best = getBestScore();
  const banner = document.getElementById('best-score-banner');

  if (banner) {
    if (best) {
      const date = new Date(best.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
      banner.textContent = `🏆 Ton record : ${best.total}/${levelConf.maxScore} (${date}) — à battre !`;
      banner.style.display = 'block';
    } else {
      banner.style.display = 'none';
    }
  }

  updateNotifButton(isNotifEnabled());

  const btnShareHome = document.getElementById('btn-share-home');
  if (btnShareHome) {
    if (hasPlayedToday()) {
      const scores = getTodayScores();
      btnShareHome.style.display = 'flex';
      if (scores) setupShareButton(scores, 'btn-share-home');
    } else {
      btnShareHome.style.display = 'none';
    }
  }

  // Highlight active level
  document.querySelectorAll('.level-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.level === level);
  });

  // Show today's status under play button
  const playStatus = document.getElementById('play-status');
  if (playStatus) {
    playStatus.textContent = hasPlayedToday()
      ? '✅ Quiz du jour terminé — reviens demain !'
      : `${levelConf.emoji} ${levelConf.label} · 60 questions · 15 sec par question`;
  }
}

// ─── Quiz UI ──────────────────────────────────────────────────────────────────

function renderQuestion(engine) {
  const q = engine.getCurrentQuestion();
  const idx = engine.getCurrentIndex();
  const total = engine.getTotalQuestions();
  const levelConf = getLevelConf();

  document.getElementById('q-number').textContent = `Question ${idx + 1} / ${total}`;
  document.getElementById('q-category').textContent = levelConf.categoryLabels[q.categorie] ?? q.categorie;
  document.getElementById('q-text').textContent = q.question;

  const mediaEl = document.getElementById('q-media');
  if (q.media?.type === 'emoji') {
    mediaEl.textContent = q.media.valeur;
    mediaEl.style.display = 'block';
  } else {
    mediaEl.textContent = '';
    mediaEl.style.display = 'none';
  }

  const choicesEl = document.getElementById('q-choices');
  choicesEl.innerHTML = '';
  q.choix.forEach(choice => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.textContent = choice;
    btn.addEventListener('click', () => handleAnswer(choice, engine));
    choicesEl.appendChild(btn);
  });

  const feedback = document.getElementById('q-feedback');
  feedback.className = 'feedback hidden';
  feedback.innerHTML = '';

  const timerBar = document.getElementById('timer-bar');
  timerBar.style.transition = 'none';
  timerBar.style.width = '100%';
  timerBar.style.backgroundColor = '';
  requestAnimationFrame(() => { timerBar.style.transition = ''; });

  engine.startTimer(
    (progress) => {
      timerBar.style.width = `${progress * 100}%`;
      if (progress < 0.3) timerBar.style.backgroundColor = '#ef4444';
      else if (progress < 0.6) timerBar.style.backgroundColor = '#f59e0b';
      else timerBar.style.backgroundColor = '';
    },
    () => {
      const result = engine.timeExpired();
      if (result) showFeedback(result, engine);
    }
  );
}

function handleAnswer(choice, engine) {
  const result = engine.answer(choice);
  if (!result) return;
  document.querySelectorAll('.choice-btn').forEach(btn => {
    btn.disabled = true;
    if (btn.textContent === result.correctAnswer) btn.classList.add('correct');
    else if (btn.textContent === choice && !result.isCorrect) btn.classList.add('incorrect');
  });
  showFeedback(result, engine);
}

function showFeedback(result, engine) {
  const timerBar = document.getElementById('timer-bar');
  timerBar.style.transition = 'none';
  document.querySelectorAll('.choice-btn').forEach(btn => {
    btn.disabled = true;
    if (btn.textContent === result.correctAnswer) btn.classList.add('correct');
  });

  const feedback = document.getElementById('q-feedback');
  if (result.isCorrect) {
    feedback.className = 'feedback correct';
    feedback.innerHTML = `✓ Bonne réponse !${result.explication ? `<br><span class="explication">${result.explication}</span>` : ''}`;
  } else {
    feedback.className = 'feedback incorrect';
    feedback.innerHTML = `✗ Réponse : <strong>${result.correctAnswer}</strong>${result.explication ? `<br><span class="explication">${result.explication}</span>` : ''}`;
  }

  setTimeout(() => {
    const hasNext = engine.next();
    if (hasNext) renderQuestion(engine);
  }, CONFIG.FEEDBACK_DELAY_MS);
}

// ─── Quiz initialization ──────────────────────────────────────────────────────

async function startQuiz() {
  const levelConf = getLevelConf();
  const levelKey = getActiveLevel();

  // Reset cache if level changed
  if (levelKey !== currentLevelKey) {
    allQuestions = null;
    currentLevelKey = levelKey;
  }

  if (!allQuestions) {
    try {
      allQuestions = await loadQuestions(levelConf.questionsFile);
    } catch (e) {
      console.error('Failed to load questions:', e);
      showScreen('home');
      return;
    }
  }

  const questions = prepareQuestions(allQuestions, levelConf.categories);

  quizEngine = new QuizEngine(questions, levelConf.categories, async () => {
    const today = new Date().toISOString().slice(0, 10);
    await persistPlayDateForSW(today);
    const pendingRef = sessionStorage.getItem('pending_ref');
    if (pendingRef !== null) {
      sessionStorage.removeItem('pending_ref');
      window.location.hash = pendingRef ? `#compare?ref=${pendingRef}` : '#results';
    } else {
      window.location.hash = '#results';
    }
  });

  renderQuestion(quizEngine);
}

// ─── Router ───────────────────────────────────────────────────────────────────

async function route() {
  const hash = window.location.hash || '#home';
  const levelConf = getLevelConf();

  if (hash.startsWith('#compare')) {
    const ref = getRefFromHash();
    const friendScores = ref ? decodeScores(ref) : null;
    if (hasPlayedToday()) {
      const myScores = getTodayScores();
      showScreen('compare');
      if (myScores) {
        await renderResults(myScores, friendScores, 'radar-canvas-compare', 'score-breakdown-compare', levelConf);
        document.getElementById('compare-title').textContent =
          friendScores ? 'Vous deux face à face ! 🆚' : 'Tes résultats du jour';
      }
    } else {
      sessionStorage.setItem('pending_ref', ref ?? '');
      window.location.hash = '#quiz';
    }
    return;
  }

  switch (hash) {
    case '#home':
      showScreen('home');
      renderHome();
      break;

    case '#quiz':
      if (hasPlayedToday()) { window.location.hash = '#already-played'; return; }
      showScreen('quiz');
      await startQuiz();
      break;

    case '#results': {
      const scores = getTodayScores();
      const wrongAnswers = getTodayWrongAnswers();
      showScreen('results');
      if (scores) {
        await renderResults(scores, null, 'radar-canvas', 'score-breakdown', levelConf);
        renderEncouragingMessage(scores, 'encouraging-msg', levelConf);
        renderWrongAnswers(wrongAnswers, 'wrong-answers');
        renderComeBackTomorrow('come-back-msg');
        setupShareButton(scores, 'btn-share');
      }
      break;
    }

    case '#already-played': {
      const scores = getTodayScores();
      const wrongAnswers = getTodayWrongAnswers();
      showScreen('already-played');
      if (scores) {
        await renderResults(scores, null, 'radar-canvas-ap', 'score-breakdown-ap', levelConf);
        renderEncouragingMessage(scores, 'encouraging-msg-ap', levelConf);
        renderWrongAnswers(wrongAnswers, 'wrong-answers-ap');
        renderComeBackTomorrow('come-back-msg-ap');
        const shareUrl = getShareUrl(scores);
        const shareInput = document.getElementById('already-played-share');
        if (shareInput) shareInput.value = shareUrl;
        setupShareButton(scores, 'btn-share-ap');
      }
      break;
    }

    default:
      window.location.hash = '#home';
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  // Level selector buttons
  document.querySelectorAll('.level-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const newLevel = btn.dataset.level;
      if (newLevel === getActiveLevel()) return;
      setActiveLevel(newLevel);
      allQuestions = null; // force reload
      currentLevelKey = null;
      renderHome();
    });
  });

  document.getElementById('btn-play')?.addEventListener('click', () => {
    window.location.hash = '#quiz';
  });

  document.getElementById('btn-notif')?.addEventListener('click', async () => {
    if (isNotifEnabled()) {
      const btn = document.getElementById('btn-notif');
      const orig = btn.textContent;
      btn.textContent = '✓ Déjà activé !';
      setTimeout(() => { btn.textContent = orig; }, 2000);
    } else {
      await requestNotificationPermission();
    }
  });

  document.getElementById('btn-install')?.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') deferredInstallPrompt = null;
  });

  document.querySelectorAll('.btn-home').forEach(btn => {
    btn.addEventListener('click', () => { window.location.hash = '#home'; });
  });

  document.getElementById('btn-copy-share')?.addEventListener('click', async () => {
    const input = document.getElementById('already-played-share');
    if (!input) return;
    try {
      await navigator.clipboard.writeText(input.value);
      const btn = document.getElementById('btn-copy-share');
      const orig = btn.textContent;
      btn.textContent = '✓ Copié !';
      setTimeout(() => { btn.textContent = orig; }, 2000);
    } catch { input.select(); }
  });

  window.addEventListener('hashchange', route);
  route();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(console.error);
  }
}

document.addEventListener('DOMContentLoaded', init);
