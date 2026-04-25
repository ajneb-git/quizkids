import { CONFIG, LEVEL_CONFIG, REVISION_CONFIG } from './config.js';
import { getActiveLevel, setActiveLevel, hasPlayedToday, getTodayScores, getTodayWrongAnswers, getBestScore, markPlayedToday, getDefiFlagRecord, saveDefiFlagRecord } from './storage.js';
import { loadQuestions, loadRevisionQuestions, prepareQuestions, QuizEngine, RevisionEngine } from './quiz.js';
import { renderResults, renderEncouragingMessage, renderWrongAnswers, renderComeBackTomorrow, setupShareButton } from './results.js';
import { decodeScores, getRefFromHash, getShareUrl } from './share.js';

let quizEngine = null;
let revisionEngine = null;
let allQuestions = null;
let currentLevelKey = null;
let defiData = null;      // liste des 50 drapeaux
let defiIndex = 0;        // niveau en cours (0-based)
let deferredInstallPrompt = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getLevelConf() { return LEVEL_CONFIG[getActiveLevel()]; }

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
    if ('periodicSync' in reg) await reg.periodicSync.register('daily-quiz-reminder', { minInterval: 12 * 60 * 60 * 1000 });
  } catch (e) { console.info('Periodic sync not available:', e.message); }
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

function isNotifEnabled() { return 'Notification' in window && Notification.permission === 'granted'; }

// ─── PWA install ──────────────────────────────────────────────────────────────

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); deferredInstallPrompt = e;
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

  document.querySelectorAll('.level-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.level === level);
  });

  const playStatus = document.getElementById('play-status');
  if (playStatus) {
    playStatus.textContent = hasPlayedToday()
      ? '✅ Quiz du jour terminé — reviens demain !'
      : `${levelConf.emoji} ${levelConf.label} · 60 questions · ${levelConf.timerDuration / 1000}s par question`;
  }
}

// ─── Quiz UI (quotidien) ──────────────────────────────────────────────────────

function renderQuestion(engine) {
  const q = engine.getCurrentQuestion();
  const idx = engine.getCurrentIndex();
  const total = engine.getTotalQuestions();
  const levelConf = getLevelConf();

  document.getElementById('q-number').textContent = `Question ${idx + 1} / ${total}`;
  document.getElementById('q-category').textContent = levelConf.categoryLabels[q.categorie] ?? q.categorie;
  document.getElementById('q-text').textContent = q.question;

  const mediaEl = document.getElementById('q-media');
  if (q.media?.type === 'emoji') { mediaEl.textContent = q.media.valeur; mediaEl.style.display = 'block'; }
  else { mediaEl.textContent = ''; mediaEl.style.display = 'none'; }

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

  startTimerUI(engine);
}

function handleAnswer(choice, engine) {
  const result = engine.answer(choice);
  if (!result) return;
  document.querySelectorAll('.choice-btn').forEach(btn => {
    btn.disabled = true;
    if (btn.textContent === result.correctAnswer) btn.classList.add('correct');
    else if (btn.textContent === choice && !result.isCorrect) btn.classList.add('incorrect');
  });
  showFeedback(result, engine, () => { if (engine.next()) renderQuestion(engine); });
}

function showFeedback(result, engine, onNext) {
  document.getElementById('timer-bar').style.transition = 'none';
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
  setTimeout(onNext, CONFIG.FEEDBACK_DELAY_MS);
}

function startTimerUI(engine) {
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
    () => { const result = engine.timeExpired(); if (result) showFeedback(result, engine, () => { if (engine.next()) renderQuestion(engine); }); }
  );
}

// ─── Revision Quiz UI ─────────────────────────────────────────────────────────

function renderRevisionQuestion(engine) {
  const q = engine.getCurrentQuestion();
  const idx = engine.getCurrentIndex();
  const total = engine.getTotalQuestions();

  document.getElementById('rq-number').textContent = `Question ${idx + 1} / ${total}`;
  document.getElementById('rq-chapitre').textContent = q.chapitre ?? '';
  document.getElementById('rq-text').textContent = q.question;

  const choicesEl = document.getElementById('rq-choices');
  const textEl = document.getElementById('rq-text-input-zone');
  const feedback = document.getElementById('rq-feedback');
  feedback.className = 'feedback hidden';
  feedback.innerHTML = '';

  if (q.type === 'qcm') {
    choicesEl.style.display = '';
    textEl.style.display = 'none';
    choicesEl.innerHTML = '';
    q.choix.forEach(choice => {
      const btn = document.createElement('button');
      btn.className = 'choice-btn';
      btn.textContent = choice;
      btn.addEventListener('click', () => handleRevisionAnswer(choice, engine, 'qcm'));
      choicesEl.appendChild(btn);
    });
  } else {
    choicesEl.style.display = 'none';
    textEl.style.display = '';
    const input = document.getElementById('rq-input');
    const submitBtn = document.getElementById('rq-submit');
    // ⚠️ Toujours réactiver l'input entre les questions
    input.disabled = false;
    submitBtn.disabled = false;
    input.value = '';
    setTimeout(() => input.focus(), 100);

    submitBtn.onclick = () => {
      if (input.value.trim() === '') return;
      handleRevisionAnswer(input.value, engine, 'texte');
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter' && input.value.trim() !== '') {
        handleRevisionAnswer(input.value, engine, 'texte');
      }
    };
  }
}

function handleRevisionAnswer(value, engine, type) {
  const result = type === 'texte' ? engine.answerText(value) : engine.answer(value);
  if (!result) return;

  // Disable inputs
  document.querySelectorAll('#rq-choices .choice-btn').forEach(btn => {
    btn.disabled = true;
    if (btn.textContent === result.correctAnswer) btn.classList.add('correct');
    else if (btn.textContent === value && !result.isCorrect) btn.classList.add('incorrect');
  });
  const input = document.getElementById('rq-input');
  const submitBtn = document.getElementById('rq-submit');
  if (input) input.disabled = true;
  if (submitBtn) submitBtn.disabled = true;

  showRevisionFeedback(result, engine);
}

function showRevisionFeedback(result, engine) {
  const delay = result.isCorrect ? CONFIG.FEEDBACK_DELAY_MS : 4500;
  const feedback = document.getElementById('rq-feedback');
  if (result.isCorrect) {
    feedback.className = 'feedback correct';
    feedback.innerHTML = `✓ Bonne réponse !${result.explication ? `<br><span class="explication">${result.explication}</span>` : ''}`;
  } else {
    feedback.className = 'feedback incorrect';
    feedback.innerHTML = `✗ Réponse correcte : <strong>${result.correctAnswer}</strong>${result.explication ? `<br><span class="explication">${result.explication}</span>` : ''}`;
  }
  setTimeout(() => {
    const hasNext = engine.next();
    if (hasNext) renderRevisionQuestion(engine);
    else renderRevisionResults(engine);
  }, delay);
}

function renderRevisionResults(engine) {
  const { correct, total, wrongAnswers } = engine.onEnd ? {} : { correct: engine.correct, total: engine.questions.length, wrongAnswers: engine.wrongAnswers };
  showScreen('revision-results');
  document.getElementById('rr-score').textContent = `${engine.correct} / ${engine.questions.length}`;

  const pct = Math.round((engine.correct / engine.questions.length) * 100);
  let msg = '';
  if (pct === 100) msg = '🎉 Parfait ! Tu maîtrises tout le cours !';
  else if (pct >= 75) msg = '💪 Très bien ! Encore un peu de travail sur les erreurs.';
  else if (pct >= 50) msg = '📖 Pas mal, mais relis bien le cours sur les points ratés.';
  else msg = '🔁 Courage ! Relis le cours et recommence — tu vas y arriver !';
  document.getElementById('rr-msg').textContent = msg;

  // Recap erreurs
  const recapEl = document.getElementById('rr-wrong');
  if (engine.wrongAnswers.length === 0) {
    recapEl.innerHTML = '<p class="perfect-score">🎉 Aucune erreur !</p>';
  } else {
    // Group by chapitre
    const byChap = {};
    engine.wrongAnswers.forEach(w => {
      const c = w.chapitre ?? 'Autre';
      if (!byChap[c]) byChap[c] = [];
      byChap[c].push(w);
    });
    recapEl.innerHTML = Object.entries(byChap).map(([chap, errors]) => `
      <div class="revision-chap">
        <h4 class="revision-chap-title">📌 ${chap}</h4>
        ${errors.map(w => `
          <div class="wrong-item">
            <div class="wrong-body">
              <p class="wrong-question">${w.question.replace(/\n/g, '<br>')}</p>
              <p class="wrong-user">${w.userAnswer === null ? '⏱ Temps écoulé' : `Tu as répondu : <span class="wrong-answer-text">${w.userAnswer}</span>`}</p>
              <p class="wrong-correct">✓ Bonne réponse : <strong>${w.correctAnswer}</strong></p>
              ${w.explication ? `<p class="wrong-explication">${w.explication}</p>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `).join('');
  }
}

// ─── Quiz initialization ──────────────────────────────────────────────────────

async function startQuiz() {
  const levelConf = getLevelConf();
  const levelKey = getActiveLevel();
  if (levelKey !== currentLevelKey) { allQuestions = null; currentLevelKey = levelKey; }
  if (!allQuestions) {
    try { allQuestions = await loadQuestions(levelConf.questionsFile); }
    catch (e) { console.error('Failed to load questions:', e); showScreen('home'); return; }
  }
  const questions = prepareQuestions(allQuestions, levelConf.categories);
  quizEngine = new QuizEngine(questions, levelConf.categories, levelConf.timerDuration, async () => {
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

async function startRevision(themeKey) {
  const conf = REVISION_CONFIG[themeKey];
  if (!conf) return;
  try {
    const questions = await loadRevisionQuestions(conf.questionsFile, conf.category);
    revisionEngine = new RevisionEngine(questions, () => {});
    showScreen('revision-quiz');
    renderRevisionQuestion(revisionEngine);
  } catch (e) {
    console.error('Failed to load revision questions:', e);
    showScreen('home');
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

async function route() {
  const hash = window.location.hash || '#home';
  const levelConf = getLevelConf();

  if (hash === '#defi-drapeaux') {
    await startDefiDrapeaux();
    return;
  }

  if (hash.startsWith('#revision-quiz')) {
    const theme = new URLSearchParams(hash.split('?')[1] ?? '').get('theme') || 'conjugaison';
    await startRevision(theme);
    return;
  }

  if (hash.startsWith('#compare')) {
    const ref = getRefFromHash();
    const friendScores = ref ? decodeScores(ref) : null;
    if (hasPlayedToday()) {
      const myScores = getTodayScores();
      showScreen('compare');
      if (myScores) {
        await renderResults(myScores, friendScores, 'radar-canvas-compare', 'score-breakdown-compare', levelConf);
        document.getElementById('compare-title').textContent = friendScores ? 'Vous deux face à face ! 🆚' : 'Tes résultats du jour';
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

// ─── Défi Drapeaux ────────────────────────────────────────────────────────────

async function startDefiDrapeaux() {
  if (!defiData) {
    try {
      const res = await fetch('./data/drapeaux-defi.json');
      const json = await res.json();
      defiData = json.drapeaux;
    } catch (e) {
      console.error('Erreur chargement drapeaux-defi.json', e);
      showScreen('home');
      return;
    }
  }
  defiIndex = 0;
  showScreen('defi-drapeaux');
  renderDefiRecord();
  renderDefiQuestion();
}

function renderDefiRecord() {
  const record = getDefiFlagRecord();
  const el = document.getElementById('defi-record-live');
  if (el && record) el.textContent = `Record : ${record.niveau} / 50`;
}

function renderDefiQuestion() {
  const q = defiData[defiIndex];
  const niveau = defiIndex + 1;

  // Progress bar
  document.getElementById('defi-level-label').textContent = `Niveau ${niveau} / 50`;
  document.getElementById('defi-progress-fill').style.width = `${(defiIndex / 50) * 100}%`;

  // Flag
  document.getElementById('defi-flag-emoji').textContent = q.emoji;

  // Reset feedback
  const feedback = document.getElementById('defi-feedback');
  feedback.className = 'feedback hidden';
  feedback.innerHTML = '';

  // Choices — mélangés aléatoirement
  const shuffled = [...q.choix].sort(() => Math.random() - 0.5);
  const choicesEl = document.getElementById('defi-choices');
  choicesEl.innerHTML = '';
  shuffled.forEach(choice => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.textContent = choice;
    btn.addEventListener('click', () => handleDefiAnswer(choice, q));
    choicesEl.appendChild(btn);
  });
}

function handleDefiAnswer(choice, q) {
  const isCorrect = choice === q.reponse;

  // Colorier les boutons
  document.querySelectorAll('#defi-choices .choice-btn').forEach(btn => {
    btn.disabled = true;
    if (btn.textContent === q.reponse) btn.classList.add('correct');
    else if (btn.textContent === choice && !isCorrect) btn.classList.add('incorrect');
  });

  const feedback = document.getElementById('defi-feedback');

  if (isCorrect) {
    feedback.className = 'feedback correct';
    feedback.textContent = '✓ Bonne réponse !';
    defiIndex++;

    if (defiIndex >= defiData.length) {
      // Fini les 50 !
      setTimeout(() => endDefi(true, null), 1500);
    } else {
      setTimeout(renderDefiQuestion, 1500);
    }
  } else {
    feedback.className = 'feedback incorrect';
    feedback.innerHTML = `✗ C'était : <strong>${q.reponse}</strong>`;
    setTimeout(() => endDefi(false, { emoji: q.emoji, reponse: q.reponse, choixUser: choice }), 3000);
  }
}

function endDefi(completed, erreur) {
  const niveauAtteint = completed ? 50 : defiIndex; // defiIndex = nb de bonnes réponses
  const isNewRecord = saveDefiFlagRecord(niveauAtteint);

  showScreen('defi-results');

  // Icône + titre
  document.getElementById('defi-result-icon').textContent = completed ? '🏆' : '💥';
  document.getElementById('defi-result-title').textContent = completed ? 'Bravo, défi complété !' : 'Game over !';

  // Score
  document.getElementById('defi-result-score').textContent = `${niveauAtteint} / 50`;

  // Message
  const record = getDefiFlagRecord();
  let msg = '';
  if (completed) {
    msg = '🎉 Incroyable ! Tu as reconnu les 50 drapeaux !';
  } else if (niveauAtteint === 0) {
    msg = 'Aïe, dès le premier drapeau ! Tu vas t\'améliorer rapidement.';
  } else if (niveauAtteint < 15) {
    msg = 'Bon début ! Continue à t\'entraîner sur les drapeaux.';
  } else if (niveauAtteint < 30) {
    msg = 'Pas mal ! Tu maîtrises les grandes nations. Les petits pays te résistent encore.';
  } else if (niveauAtteint < 45) {
    msg = 'Très bien ! Tu es un expert des drapeaux. Encore un effort pour le top !';
  } else {
    msg = 'Exceptionnel ! Tu frôles la perfection !';
  }
  document.getElementById('defi-result-msg').textContent = msg;

  // Nouveau record
  const recordEl = document.getElementById('defi-result-record');
  if (isNewRecord) {
    recordEl.style.display = 'block';
    recordEl.textContent = niveauAtteint === 50 ? '🏆 Record absolu — 50/50 !' : `🏆 Nouveau record : ${niveauAtteint}/50 !`;
  } else {
    recordEl.style.display = 'none';
    if (record) {
      const prev = document.getElementById('defi-result-msg');
      prev.textContent += ` (Record actuel : ${record.niveau}/50)`;
    }
  }

  // Drapeau raté
  const errorEl = document.getElementById('defi-result-error');
  if (erreur) {
    errorEl.innerHTML = `
      <p class="defi-error-title">Le drapeau qui t'a arrêté :</p>
      <div class="defi-error-flag">${erreur.emoji}</div>
      <p>Tu as répondu <span class="wrong-answer-text">${erreur.choixUser}</span></p>
      <p>✓ La bonne réponse était : <strong>${erreur.reponse}</strong></p>
    `;
  } else {
    errorEl.innerHTML = '';
  }

  // Rejouer
  document.getElementById('btn-defi-replay').onclick = () => {
    defiIndex = 0;
    showScreen('defi-drapeaux');
    renderDefiRecord();
    renderDefiQuestion();
  };

  // Mettre à jour le badge sur l'accueil
  updateDefiRecordBadge();
}

function updateDefiRecordBadge() {
  const record = getDefiFlagRecord();
  const badge = document.getElementById('defi-drapeaux-record');
  if (badge && record) {
    badge.textContent = `🏆 Record : ${record.niveau} / 50`;
    badge.style.display = 'inline-block';
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  // Level selector
  document.querySelectorAll('.level-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const newLevel = btn.dataset.level;
      if (newLevel === getActiveLevel()) return;
      setActiveLevel(newLevel);
      allQuestions = null;
      currentLevelKey = null;
      renderHome();
    });
  });

  // Revision cards
  document.querySelectorAll('.revision-card').forEach(card => {
    if (card.dataset.theme) {
      card.addEventListener('click', () => {
        window.location.hash = `#revision-quiz?theme=${card.dataset.theme}`;
      });
    }
  });

  // Défi cards
  document.querySelectorAll('[data-defi]').forEach(card => {
    card.addEventListener('click', () => {
      window.location.hash = `#${card.dataset.defi === 'drapeaux' ? 'defi-drapeaux' : card.dataset.defi}`;
    });
  });

  // Badge record accueil
  updateDefiRecordBadge();

  // Replay revision
  document.getElementById('btn-revision-replay')?.addEventListener('click', () => {
    history.back();
    setTimeout(() => { window.location.hash = window.location.hash; route(); }, 50);
  });

  document.getElementById('btn-play')?.addEventListener('click', () => { window.location.hash = '#quiz'; });

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
