import { CONFIG, LEVEL_CONFIG, REVISION_CONFIG } from './config.js';
import { getActiveLevel, setActiveLevel, hasPlayedToday, getTodayScores, getTodayWrongAnswers, getBestScore, markPlayedToday, getDefiFlagRecord, saveDefiFlagRecord, getDefiCapitaleRecord, saveDefiCapitaleRecord, getDefiLogoRecord, saveDefiLogoRecord, getDefiLogoMonthlyRecord, saveDefiLogoMonthlyRecord, getDefiDepartementsRecord, saveDefiDepartementsRecord, getDefiDepartementsMonthly, saveDefiDepartementsMonthly, getDefiVillesRecord, saveDefiVillesRecord, getDefiVillesMonthly, saveDefiVillesMonthly, getDefiPaysRecord, saveDefiPaysRecord, getDefiPaysMonthly, saveDefiPaysMonthly } from './storage.js?v=7';
import { loadQuestions, loadRevisionQuestions, prepareQuestions, QuizEngine, RevisionEngine } from './quiz.js';
import { renderResults, renderEncouragingMessage, renderWrongAnswers, renderComeBackTomorrow, setupShareButton } from './results.js';
import { decodeScores, getRefFromHash, getShareUrl } from './share.js';

let quizEngine = null;
let revisionEngine = null;
let allQuestions = null;
let currentLevelKey = null;
let defiData = null;        // données brutes drapeaux (tiers)
let currentDefiFlags = [];  // séquence de 50 drapeaux pour la partie en cours
let defiIndex = 0;          // niveau en cours (0-based)

let capitalesData = null;
let currentCapitales = [];
let capitaleIndex = 0;

let logosData = null;
let currentLogos = [];
let logosIndex = 0;
let deferredInstallPrompt = null;

let departementsData = null; let currentDepartements = []; let departementsIndex = 0;
let villesData = null;       let currentVilles = [];       let villesIndex = 0;
let paysData = null;         let currentPays = [];          let paysIndex = 0;

let histoireFrData = null;
let histoireMondeData = null;
let currentHistoire = [];
let histoireIndex = 0;
let histoireScore = 0;
let histoireMode = null; // 'france' | 'monde'

let sportData = null;
let currentSport = [];
let sportIndex = 0;
let sportScore = 0;
let franceSvg = null;   // SVG element (cached after first load)
let worldSvg = null;

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

  if (hash === '#defi-capitales') {
    await startDefiCapitales();
    return;
  }

  if (hash === '#defi-logos') {
    await startDefiLogos();
    return;
  }

  if (hash === '#defi-departements') {
    await startDefiDepartements();
    return;
  }

  if (hash === '#defi-villes') {
    await startDefiVilles();
    return;
  }

  if (hash === '#defi-pays') {
    await startDefiPays();
    return;
  }

  if (hash === '#defi-histoire-france') {
    await startHistoire('france');
    return;
  }

  if (hash === '#defi-histoire-monde') {
    await startHistoire('monde');
    return;
  }

  if (hash === '#defi-sport') {
    await startSport();
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

function buildDefiGame(data) {
  // Pour chaque palier, mélanger le pool et prendre 10 drapeaux au hasard
  return data.tiers.flatMap(tier => {
    const shuffled = [...tier.pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 10);
  });
}

async function startDefiDrapeaux() {
  if (!defiData) {
    try {
      const res = await fetch('./data/drapeaux-defi.json');
      defiData = await res.json();
    } catch (e) {
      console.error('Erreur chargement drapeaux-defi.json', e);
      showScreen('home');
      return;
    }
  }
  currentDefiFlags = buildDefiGame(defiData);
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
  const q = currentDefiFlags[defiIndex];
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

    if (defiIndex >= currentDefiFlags.length) {
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

  // Rejouer — on reconstruit une nouvelle séquence aléatoire
  document.getElementById('btn-defi-replay').onclick = () => {
    currentDefiFlags = buildDefiGame(defiData);
    defiIndex = 0;
    showScreen('defi-drapeaux');
    renderDefiRecord();
    renderDefiQuestion();
  };

  // Mettre à jour le badge sur l'accueil
  updateDefiRecordBadge();
}

function updateDefiRecordBadge() {
  [
    { id: 'defi-drapeaux-record',      fn: getDefiFlagRecord },
    { id: 'defi-capitales-record',     fn: getDefiCapitaleRecord },
    { id: 'defi-logos-record',         fn: getDefiLogoRecord },
    { id: 'defi-departements-record',  fn: getDefiDepartementsRecord },
    { id: 'defi-villes-record',        fn: getDefiVillesRecord },
    { id: 'defi-pays-record',          fn: getDefiPaysRecord },
  ].forEach(({ id, fn }) => {
    const rec = fn();
    const el  = document.getElementById(id);
    if (el && rec) { el.textContent = `🏆 Record : ${rec.niveau} / 50`; el.style.display = 'inline-block'; }
  });
}

// ─── Défi Capitales ───────────────────────────────────────────────────────────

function buildCapitaleGame(data) {
  return data.tiers.flatMap(tier => {
    const shuffled = [...tier.pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 10);
  });
}

async function startDefiCapitales() {
  if (!capitalesData) {
    try {
      const res = await fetch('./data/capitales-defi.json');
      capitalesData = await res.json();
    } catch (e) {
      console.error('Erreur chargement capitales-defi.json', e);
      showScreen('home');
      return;
    }
  }
  currentCapitales = buildCapitaleGame(capitalesData);
  capitaleIndex = 0;
  showScreen('defi-capitales');
  renderCapitaleRecord();
  renderCapitaleQuestion();
}

function renderCapitaleRecord() {
  const record = getDefiCapitaleRecord();
  const el = document.getElementById('capitale-record-live');
  if (el && record) el.textContent = `Record : ${record.niveau} / 50`;
}

function renderCapitaleQuestion() {
  const q = currentCapitales[capitaleIndex];
  const niveau = capitaleIndex + 1;

  document.getElementById('capitale-level-label').textContent = `Niveau ${niveau} / 50`;
  document.getElementById('capitale-progress-fill').style.width = `${(capitaleIndex / 50) * 100}%`;
  document.getElementById('capitale-drapeau').textContent = q.drapeau;
  document.getElementById('capitale-pays').textContent = q.pays;

  const feedback = document.getElementById('capitale-feedback');
  feedback.className = 'feedback hidden';
  feedback.innerHTML = '';

  const shuffled = [...q.choix].sort(() => Math.random() - 0.5);
  const choicesEl = document.getElementById('capitale-choices');
  choicesEl.innerHTML = '';
  shuffled.forEach(choice => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.textContent = choice;
    btn.addEventListener('click', () => handleCapitaleAnswer(choice, q));
    choicesEl.appendChild(btn);
  });
}

function handleCapitaleAnswer(choice, q) {
  const isCorrect = choice === q.reponse;

  document.querySelectorAll('#capitale-choices .choice-btn').forEach(btn => {
    btn.disabled = true;
    if (btn.textContent === q.reponse) btn.classList.add('correct');
    else if (btn.textContent === choice && !isCorrect) btn.classList.add('incorrect');
  });

  const feedback = document.getElementById('capitale-feedback');

  if (isCorrect) {
    feedback.className = 'feedback correct';
    feedback.textContent = '✓ Bonne réponse !';
    capitaleIndex++;

    if (capitaleIndex >= currentCapitales.length) {
      setTimeout(() => endDefiCapitale(true, null), 1500);
    } else {
      setTimeout(renderCapitaleQuestion, 1500);
    }
  } else {
    feedback.className = 'feedback incorrect';
    feedback.innerHTML = `✗ C'était : <strong>${q.reponse}</strong>`;
    setTimeout(() => endDefiCapitale(false, { pays: q.pays, reponse: q.reponse, choixUser: choice }), 3000);
  }
}

function endDefiCapitale(completed, erreur) {
  const niveauAtteint = completed ? 50 : capitaleIndex;
  const isNewRecord = saveDefiCapitaleRecord(niveauAtteint);

  showScreen('defi-capitales-results');

  document.getElementById('capitale-result-icon').textContent = completed ? '🏆' : '💥';
  document.getElementById('capitale-result-title').textContent = completed ? 'Bravo, défi complété !' : 'Game over !';
  document.getElementById('capitale-result-score').textContent = `${niveauAtteint} / 50`;

  const record = getDefiCapitaleRecord();
  let msg = '';
  if (completed) {
    msg = '🎉 Incroyable ! Tu connais toutes les capitales !';
  } else if (niveauAtteint === 0) {
    msg = 'Aïe, dès la première capitale ! À retenter !';
  } else if (niveauAtteint < 15) {
    msg = 'Bon début ! Révise tes capitales et recommence.';
  } else if (niveauAtteint < 30) {
    msg = 'Pas mal ! Tu maîtrises les grandes capitales. Les plus rares te résistent encore.';
  } else if (niveauAtteint < 45) {
    msg = 'Très bien ! Tu es un expert en géographie. Encore un effort pour le top !';
  } else {
    msg = 'Exceptionnel ! Tu frôles la perfection !';
  }
  document.getElementById('capitale-result-msg').textContent = msg;

  const recordEl = document.getElementById('capitale-result-record');
  if (isNewRecord) {
    recordEl.style.display = 'block';
    recordEl.textContent = niveauAtteint === 50 ? '🏆 Record absolu — 50/50 !' : `🏆 Nouveau record : ${niveauAtteint}/50 !`;
  } else {
    recordEl.style.display = 'none';
    if (record) {
      document.getElementById('capitale-result-msg').textContent += ` (Record actuel : ${record.niveau}/50)`;
    }
  }

  const errorEl = document.getElementById('capitale-result-error');
  if (erreur) {
    errorEl.innerHTML = `
      <p class="defi-error-title">La capitale qui t'a arrêté :</p>
      <p style="font-size:1.4rem;font-weight:900;margin:12px 0;color:var(--text-muted)">${erreur.pays}</p>
      <p>Tu as répondu <span class="wrong-answer-text">${erreur.choixUser}</span></p>
      <p>✓ La bonne réponse était : <strong>${erreur.reponse}</strong></p>
    `;
  } else {
    errorEl.innerHTML = '';
  }

  document.getElementById('btn-capitale-replay').onclick = () => {
    currentCapitales = buildCapitaleGame(capitalesData);
    capitaleIndex = 0;
    showScreen('defi-capitales');
    renderCapitaleRecord();
    renderCapitaleQuestion();
  };

  updateDefiRecordBadge();
}

// ─── Défi Logos ───────────────────────────────────────────────────────────────

function buildLogosGame(data) {
  return data.tiers.flatMap(tier => {
    const shuffled = [...tier.pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 10);
  });
}

async function startDefiLogos() {
  if (!logosData) {
    try {
      const res = await fetch('./data/logos-defi.json');
      logosData = await res.json();
    } catch (e) {
      console.error('Erreur chargement logos-defi.json', e);
      showScreen('home');
      return;
    }
  }
  currentLogos = buildLogosGame(logosData);
  logosIndex = 0;
  showScreen('defi-logos');
  renderLogosRecord();
  renderLogosQuestion();
}

function renderLogosRecord() {
  const record  = getDefiLogoRecord();
  const monthly = getDefiLogoMonthlyRecord();
  const el = document.getElementById('logos-record-live');
  if (el) {
    const parts = [];
    if (record)  parts.push(`🏆 ${record.niveau}/50`);
    if (monthly) parts.push(`📅 ${monthly.niveau}/50`);
    el.textContent = parts.length ? parts.join('  ·  ') : '';
  }
}

function renderLogosQuestion() {
  const q = currentLogos[logosIndex];
  const niveau = logosIndex + 1;

  document.getElementById('logos-level-label').textContent = `Niveau ${niveau} / 50`;
  document.getElementById('logos-progress-fill').style.width = `${(logosIndex / 50) * 100}%`;
  document.getElementById('defi-logos-question').textContent = 'À quel club appartient ce logo ?';

  const img = document.getElementById('defi-logo-img');
  img.src = q.image;
  img.alt = q.reponse;

  const feedback = document.getElementById('logos-feedback');
  feedback.className = 'feedback hidden';
  feedback.innerHTML = '';

  const shuffled = [...q.choix].sort(() => Math.random() - 0.5);
  const choicesEl = document.getElementById('logos-choices');
  choicesEl.innerHTML = '';
  shuffled.forEach(choice => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.textContent = choice;
    btn.addEventListener('click', () => handleLogosAnswer(choice, q));
    choicesEl.appendChild(btn);
  });
}

function handleLogosAnswer(choice, q) {
  const isCorrect = choice === q.reponse;

  document.querySelectorAll('#logos-choices .choice-btn').forEach(btn => {
    btn.disabled = true;
    if (btn.textContent === q.reponse) btn.classList.add('correct');
    else if (btn.textContent === choice && !isCorrect) btn.classList.add('incorrect');
  });

  const feedback = document.getElementById('logos-feedback');

  if (isCorrect) {
    feedback.className = 'feedback correct';
    feedback.textContent = '✓ Bonne réponse !';
    logosIndex++;
    if (logosIndex >= currentLogos.length) {
      setTimeout(() => endDefiLogos(true, null), 1500);
    } else {
      setTimeout(renderLogosQuestion, 1500);
    }
  } else {
    feedback.className = 'feedback incorrect';
    feedback.innerHTML = `✗ C'était : <strong>${q.reponse}</strong>`;
    setTimeout(() => endDefiLogos(false, { image: q.image, reponse: q.reponse, choixUser: choice }), 3000);
  }
}

function endDefiLogos(completed, erreur) {
  const niveauAtteint = completed ? 50 : logosIndex;
  const isNewRecord        = saveDefiLogoRecord(niveauAtteint);
  const isNewMonthlyRecord = saveDefiLogoMonthlyRecord(niveauAtteint);

  showScreen('defi-logos-results');

  document.getElementById('logos-result-icon').textContent = completed ? '🏆' : '💥';
  document.getElementById('logos-result-title').textContent = completed ? 'Bravo, défi complété !' : 'Game over !';
  document.getElementById('logos-result-score').textContent = `${niveauAtteint} / 50`;

  const record        = getDefiLogoRecord();
  const monthlyRecord = getDefiLogoMonthlyRecord();

  let msg = '';
  if (completed)               msg = '🎉 Parfait ! Tu connais tous les logos !';
  else if (niveauAtteint === 0) msg = 'Aïe, dès le premier logo ! Entraîne-toi et reviens !';
  else if (niveauAtteint < 15) msg = 'Bon début ! Tu maîtrises les plus grands clubs.';
  else if (niveauAtteint < 30) msg = 'Pas mal ! Les clubs européens te résistent encore.';
  else if (niveauAtteint < 45) msg = 'Très bien ! Tu es un vrai connaisseur du football !';
  else                         msg = 'Exceptionnel ! Tu frôles la perfection !';
  document.getElementById('logos-result-msg').textContent = msg;

  const recordEl = document.getElementById('logos-result-record');
  if (isNewRecord || isNewMonthlyRecord) {
    recordEl.style.display = 'block';
    if (isNewRecord && niveauAtteint === 50) recordEl.textContent = '🏆 Record absolu — 50/50 !';
    else if (isNewRecord)        recordEl.textContent = `🏆 Nouveau record all-time : ${niveauAtteint}/50 !`;
    else if (isNewMonthlyRecord) recordEl.textContent = `📅 Nouveau record du mois : ${niveauAtteint}/50 !`;
  } else {
    recordEl.style.display = 'none';
  }

  // ── Tableau des records ──
  const recordsPanel = document.getElementById('logos-result-records');
  if (recordsPanel) {
    const rows = [];
    if (record) {
      rows.push(`<div class="record-row">
        <span class="record-label">🏆 Meilleur score all-time</span>
        <span class="record-value${isNewRecord ? ' new' : ''}">${record.niveau} / 50 <small>(${record.date})</small></span>
      </div>`);
    }
    if (monthlyRecord) {
      const monthLabel = new Date(monthlyRecord.month + '-01').toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
      rows.push(`<div class="record-row">
        <span class="record-label">📅 Meilleur ce mois (${monthLabel})</span>
        <span class="record-value${isNewMonthlyRecord ? ' new' : ''}">${monthlyRecord.niveau} / 50</span>
      </div>`);
    }
    recordsPanel.innerHTML = rows.join('');
  }

  const errorEl = document.getElementById('logos-result-error');
  if (erreur) {
    errorEl.innerHTML = `
      <p class="defi-error-title">Le logo qui t'a arrêté :</p>
      <div class="logo-img-wrap" style="margin:12px auto;width:110px;height:110px">
        <img src="${erreur.image}" alt="${erreur.reponse}" style="max-width:100%;max-height:100%;object-fit:contain" />
      </div>
      <p>Tu as répondu <span class="wrong-answer-text">${erreur.choixUser}</span></p>
      <p>✓ La bonne réponse était : <strong>${erreur.reponse}</strong></p>
    `;
  } else {
    errorEl.innerHTML = '';
  }

  document.getElementById('btn-logos-replay').onclick = () => {
    currentLogos = buildLogosGame(logosData);
    logosIndex = 0;
    showScreen('defi-logos');
    renderLogosRecord();
    renderLogosQuestion();
  };

  updateDefiRecordBadge();
}

// ─── Geo Map Helpers ─────────────────────────────────────────────────────────

async function loadSvgMap(url) {
  const res = await fetch(url);
  const text = await res.text();
  const parser = new DOMParser();
  // Use text/html (lenient) so malformed SVG doesn't produce a parseerror document
  const doc = parser.parseFromString(text, 'text/html');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) throw new Error('No SVG element found in ' + url);
  // Strip inline fill/stroke so CSS controls them
  svgEl.querySelectorAll('path, rect, polygon').forEach(el => {
    el.removeAttribute('fill');
    el.removeAttribute('stroke');
    el.removeAttribute('stroke-width');
  });
  return svgEl;
}

function injectSvg(containerId, svgEl) {
  const container = document.getElementById(containerId);
  if (!container) return null;
  container.innerHTML = '';
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('width', '100%');
  clone.setAttribute('height', '100%');
  clone.removeAttribute('style');
  container.appendChild(clone);
  return clone;
}

// ─── Pinch-to-zoom on map containers ─────────────────────────────────────────

function setupMapZoom(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // On subsequent calls (game restart): just reset zoom state and return
  if (container._resetZoom) { container._resetZoom(); return; }

  let scale = 1, tx = 0, ty = 0;
  let pinching = false, lastDist = 0, lastMidX = 0, lastMidY = 0;

  // Disable browser default touch handling on this element
  container.style.touchAction = 'none';

  function getSvg() { return container.querySelector('svg'); }

  function applyTransform() {
    const svg = getSvg();
    if (!svg) return;
    if (scale <= 1) {
      scale = 1; tx = 0; ty = 0;
      svg.style.transform = '';
      container.classList.remove('map-zoomed');
      return;
    }
    const { width: W, height: H } = container.getBoundingClientRect();
    // Clamp so the map can't be dragged out of bounds
    tx = Math.min(0, Math.max(W * (1 - scale), tx));
    ty = Math.min(0, Math.max(H * (1 - scale), ty));
    svg.style.transformOrigin = '0 0';
    svg.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
    container.classList.add('map-zoomed');
  }

  // Expose reset for game restarts (called at top of this function on re-entry)
  container._resetZoom = () => {
    scale = 1; tx = 0; ty = 0;
    const svg = getSvg();
    if (svg) svg.style.transform = '';
    container.classList.remove('map-zoomed');
  };

  // ── Touch: pinch + pan ────────────────────────────────────────────────────
  container.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      pinching = true;
      lastDist = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY
      );
      lastMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      lastMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    } else if (e.touches.length === 1) {
      lastMidX = e.touches[0].clientX;
      lastMidY = e.touches[0].clientY;
    }
  }, { passive: true });

  container.addEventListener('touchmove', e => {
    if (e.touches.length === 2) {
      if (!pinching) {
        pinching = true;
        lastDist = Math.hypot(
          e.touches[1].clientX - e.touches[0].clientX,
          e.touches[1].clientY - e.touches[0].clientY
        );
      }
      const dist = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY
      );
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const newScale = Math.min(Math.max(scale * (dist / lastDist), 1), 5);
      const ratio = newScale / scale;
      const rect = container.getBoundingClientRect();
      // Zoom toward pinch midpoint
      tx = (midX - rect.left) * (1 - ratio) + tx * ratio;
      ty = (midY - rect.top) * (1 - ratio) + ty * ratio;
      scale = newScale;
      lastDist = dist;
      applyTransform();
    } else if (e.touches.length === 1 && scale > 1) {
      tx += e.touches[0].clientX - lastMidX;
      ty += e.touches[0].clientY - lastMidY;
      lastMidX = e.touches[0].clientX;
      lastMidY = e.touches[0].clientY;
      applyTransform();
    }
  }, { passive: true });

  container.addEventListener('touchend', e => {
    if (e.touches.length < 2) pinching = false;
    if (e.touches.length === 1) {
      lastMidX = e.touches[0].clientX;
      lastMidY = e.touches[0].clientY;
    }
  }, { passive: true });

  // Double-tap to reset zoom
  let lastTap = 0;
  container.addEventListener('touchend', e => {
    if (e.touches.length === 0) {
      const now = Date.now();
      if (now - lastTap < 300) { scale = 1; tx = 0; ty = 0; applyTransform(); }
      lastTap = now;
    }
  }, { passive: true });

  // ── Mouse wheel (desktop) ─────────────────────────────────────────────────
  container.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = e.deltaY > 0 ? 0.85 : 1.18;
    const newScale = Math.min(Math.max(scale * factor, 1), 5);
    const ratio = newScale / scale;
    tx = cx * (1 - ratio) + tx * ratio;
    ty = cy * (1 - ratio) + ty * ratio;
    scale = newScale;
    applyTransform();
  }, { passive: false });
}

function highlightGeoPath(svgEl, id) {
  svgEl.querySelectorAll('.map-highlight').forEach(el => el.classList.remove('map-highlight'));
  const target = svgEl.querySelector(`[id="${id}"]`);
  if (!target) return;
  // For world SVG: <g id="FR"> containing <path> elements
  if (target.tagName === 'g') {
    target.querySelectorAll('path, rect, polygon').forEach(p => p.classList.add('map-highlight'));
  } else {
    target.classList.add('map-highlight');
  }
}

// France SVG coordinate space (from GeoJSON → SVG conversion)
const FRANCE_SVG_BOUNDS = { minLon: -5.40, maxLon: 9.86, minLat: 41.07, maxLat: 51.39, w: 800, h: 541 };

function latLonToFranceSvg(lat, lon) {
  const b = FRANCE_SVG_BOUNDS;
  const x = (lon - b.minLon) / (b.maxLon - b.minLon) * b.w;
  const y = (1 - (lat - b.minLat) / (b.maxLat - b.minLat)) * b.h;
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

function showCityMarker(svgEl, lat, lon) {
  svgEl.querySelectorAll('.city-marker-outer, .city-marker-inner').forEach(el => el.remove());
  const { x, y } = latLonToFranceSvg(lat, lon);
  const NS = 'http://www.w3.org/2000/svg';
  const outer = document.createElementNS(NS, 'circle');
  outer.setAttribute('cx', x); outer.setAttribute('cy', y); outer.setAttribute('r', '10');
  outer.setAttribute('fill', '#ffd700'); outer.setAttribute('opacity', '0.55');
  outer.classList.add('city-marker-outer');
  const inner = document.createElementNS(NS, 'circle');
  inner.setAttribute('cx', x); inner.setAttribute('cy', y); inner.setAttribute('r', '5');
  inner.setAttribute('fill', '#ffd700');
  inner.classList.add('city-marker-inner');
  svgEl.appendChild(outer);
  svgEl.appendChild(inner);
}

// Highlight the WRONG choice in red (keeps existing yellow highlight intact)
function highlightGeoPathError(svgEl, id) {
  if (!svgEl || !id) return;
  const target = svgEl.querySelector(`[id="${id}"]`);
  if (!target) return;
  if (target.tagName === 'g') {
    target.querySelectorAll('path, rect, polygon').forEach(p => p.classList.add('map-highlight-error'));
  } else {
    target.classList.add('map-highlight-error');
  }
}

// Red city marker for the wrong city (leaves the gold correct marker untouched)
function showCityMarkerError(svgEl, lat, lon) {
  if (!svgEl || lat == null || lon == null) return;
  const { x, y } = latLonToFranceSvg(lat, lon);
  const NS = 'http://www.w3.org/2000/svg';
  const outer = document.createElementNS(NS, 'circle');
  outer.setAttribute('cx', x); outer.setAttribute('cy', y); outer.setAttribute('r', '10');
  outer.setAttribute('fill', '#ef4444'); outer.setAttribute('opacity', '0.5');
  outer.classList.add('city-marker-error-outer');
  const inner = document.createElementNS(NS, 'circle');
  inner.setAttribute('cx', x); inner.setAttribute('cy', y); inner.setAttribute('r', '5');
  inner.setAttribute('fill', '#ef4444');
  inner.classList.add('city-marker-error-inner');
  svgEl.appendChild(outer);
  svgEl.appendChild(inner);
}

// Search all tiers pools for the entry matching reponseValue
function findInDefiData(data, reponseValue) {
  if (!data) return null;
  for (const tier of data.tiers) {
    for (const item of tier.pool) {
      if (item.reponse === reponseValue) return item;
    }
  }
  return null;
}

function geoRecordPanel(panelId, record, monthly, isNewRecord, isNewMonthly) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const rows = [];
  if (record) {
    rows.push(`<div class="record-row">
      <span class="record-label">🏆 Meilleur score all-time</span>
      <span class="record-value${isNewRecord ? ' new' : ''}">${record.niveau} / 50 <small>(${record.date})</small></span>
    </div>`);
  }
  if (monthly) {
    const label = new Date(monthly.month + '-01').toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
    rows.push(`<div class="record-row">
      <span class="record-label">📅 Meilleur ce mois (${label})</span>
      <span class="record-value${isNewMonthly ? ' new' : ''}">${monthly.niveau} / 50</span>
    </div>`);
  }
  panel.innerHTML = rows.join('');
}

// ─── Défi Départements ────────────────────────────────────────────────────────

async function startDefiDepartements() {
  if (!departementsData) {
    try {
      const res = await fetch('./data/departements-defi.json');
      departementsData = await res.json();
    } catch (e) { console.error('Erreur departements-defi.json', e); showScreen('home'); return; }
  }
  if (!franceSvg) {
    try { franceSvg = await loadSvgMap('./maps/france-departements.svg'); }
    catch (e) { console.error('Erreur france-departements.svg', e); showScreen('home'); return; }
  }
  currentDepartements = buildDefiGame(departementsData);
  departementsIndex = 0;
  showScreen('defi-departements');
  injectSvg('dep-map-container', franceSvg);
  setupMapZoom('dep-map-container');
  renderDepRecord();
  renderDepQuestion();
}

function renderDepRecord() {
  const record = getDefiDepartementsRecord();
  const monthly = getDefiDepartementsMonthly();
  const el = document.getElementById('dep-record-live');
  if (!el) return;
  const parts = [];
  if (record)  parts.push(`🏆 ${record.niveau}/50`);
  if (monthly) parts.push(`📅 ${monthly.niveau}/50`);
  el.textContent = parts.join('  ·  ');
}

function renderDepQuestion() {
  document.getElementById('dep-map-container')?._resetZoom?.();
  const q = currentDepartements[departementsIndex];
  const niveau = departementsIndex + 1;
  document.getElementById('dep-level-label').textContent = `Niveau ${niveau} / 50`;
  document.getElementById('dep-progress-fill').style.width = `${(departementsIndex / 50) * 100}%`;

  const svgEl = document.querySelector('#dep-map-container svg');
  if (svgEl) highlightGeoPath(svgEl, q.id);

  const feedback = document.getElementById('dep-feedback');
  feedback.className = 'feedback hidden'; feedback.innerHTML = '';

  const shuffled = [...q.choix].sort(() => Math.random() - 0.5);
  const choicesEl = document.getElementById('dep-choices');
  choicesEl.innerHTML = '';
  shuffled.forEach(choice => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn'; btn.textContent = choice;
    btn.addEventListener('click', () => handleDepAnswer(choice, q));
    choicesEl.appendChild(btn);
  });
}

function handleDepAnswer(choice, q) {
  const isCorrect = choice === q.reponse;
  document.querySelectorAll('#dep-choices .choice-btn').forEach(btn => {
    btn.disabled = true;
    if (btn.textContent === q.reponse) btn.classList.add('correct');
    else if (btn.textContent === choice && !isCorrect) btn.classList.add('incorrect');
  });
  const feedback = document.getElementById('dep-feedback');
  if (isCorrect) {
    feedback.className = 'feedback correct';
    feedback.textContent = '✓ Bonne réponse !';
    departementsIndex++;
    if (departementsIndex >= currentDepartements.length) setTimeout(() => endDefiDepartements(true, null), 1500);
    else setTimeout(renderDepQuestion, 1500);
  } else {
    feedback.className = 'feedback incorrect';
    feedback.innerHTML = `✗ C'était : <strong>${q.reponse}</strong>`;
    const svgEl = document.querySelector('#dep-map-container svg');
    if (svgEl) {
      const wrongItem = findInDefiData(departementsData, choice);
      if (wrongItem?.id) highlightGeoPathError(svgEl, wrongItem.id);
    }
    setTimeout(() => endDefiDepartements(false, { id: q.id, reponse: q.reponse, choixUser: choice }), 8000);
  }
}

function endDefiDepartements(completed, erreur) {
  const niveauAtteint      = completed ? 50 : departementsIndex;
  const isNewRecord        = saveDefiDepartementsRecord(niveauAtteint);
  const isNewMonthlyRecord = saveDefiDepartementsMonthly(niveauAtteint);

  showScreen('defi-departements-results');
  document.getElementById('dep-result-icon').textContent  = completed ? '🏆' : '💥';
  document.getElementById('dep-result-title').textContent = completed ? 'Bravo, défi complété !' : 'Game over !';
  document.getElementById('dep-result-score').textContent = `${niveauAtteint} / 50`;

  const record  = getDefiDepartementsRecord();
  const monthly = getDefiDepartementsMonthly();

  let msg = '';
  if (completed)                msg = '🎉 Parfait ! Tu connais tous les départements !';
  else if (niveauAtteint === 0) msg = 'Aïe, dès le premier département ! À retenter !';
  else if (niveauAtteint < 15) msg = 'Bon début ! Tu maîtrises les grands départements.';
  else if (niveauAtteint < 30) msg = 'Pas mal ! Les départements moins connus te résistent encore.';
  else if (niveauAtteint < 45) msg = 'Très bien ! Tu es un expert de la géographie française !';
  else                          msg = 'Exceptionnel ! Tu frôles la perfection !';
  document.getElementById('dep-result-msg').textContent = msg;

  const recordEl = document.getElementById('dep-result-record');
  if (isNewRecord || isNewMonthlyRecord) {
    recordEl.style.display = 'block';
    if (isNewRecord && niveauAtteint === 50) recordEl.textContent = '🏆 Record absolu — 50/50 !';
    else if (isNewRecord)        recordEl.textContent = `🏆 Nouveau record all-time : ${niveauAtteint}/50 !`;
    else if (isNewMonthlyRecord) recordEl.textContent = `📅 Nouveau record du mois : ${niveauAtteint}/50 !`;
  } else { recordEl.style.display = 'none'; }

  geoRecordPanel('dep-result-records', record, monthly, isNewRecord, isNewMonthlyRecord);

  const errorEl = document.getElementById('dep-result-error');
  if (erreur) {
    errorEl.innerHTML = `
      <p class="defi-error-title">Le département qui t'a arrêté :</p>
      <p>Tu as répondu <span class="wrong-answer-text">${erreur.choixUser}</span></p>
      <p>✓ La bonne réponse était : <strong>${erreur.reponse}</strong></p>`;
    if (franceSvg) {
      const wrap = document.createElement('div');
      wrap.className = 'map-container';
      wrap.style.cssText = 'margin:10px auto;width:160px;height:108px';
      const mini = franceSvg.cloneNode(true);
      mini.setAttribute('width', '100%'); mini.setAttribute('height', '100%');
      mini.removeAttribute('style');
      highlightGeoPath(mini, erreur.id);
      wrap.appendChild(mini);
      errorEl.insertBefore(wrap, errorEl.children[1]);
    }
  } else { errorEl.innerHTML = ''; }

  document.getElementById('btn-dep-replay').onclick = () => {
    currentDepartements = buildDefiGame(departementsData);
    departementsIndex = 0;
    showScreen('defi-departements');
    injectSvg('dep-map-container', franceSvg);
    setupMapZoom('dep-map-container');
    renderDepRecord();
    renderDepQuestion();
  };
  updateDefiRecordBadge();
}

// ─── Défi Villes ──────────────────────────────────────────────────────────────

async function startDefiVilles() {
  if (!villesData) {
    try {
      const res = await fetch('./data/villes-defi.json');
      villesData = await res.json();
    } catch (e) { console.error('Erreur villes-defi.json', e); showScreen('home'); return; }
  }
  if (!franceSvg) {
    try { franceSvg = await loadSvgMap('./maps/france-departements.svg'); }
    catch (e) { console.error('Erreur france-departements.svg', e); showScreen('home'); return; }
  }
  currentVilles = buildDefiGame(villesData);
  villesIndex = 0;
  showScreen('defi-villes');
  injectSvg('vil-map-container', franceSvg);
  setupMapZoom('vil-map-container');
  renderVilRecord();
  renderVilQuestion();
}

function renderVilRecord() {
  const record = getDefiVillesRecord();
  const monthly = getDefiVillesMonthly();
  const el = document.getElementById('vil-record-live');
  if (!el) return;
  const parts = [];
  if (record)  parts.push(`🏆 ${record.niveau}/50`);
  if (monthly) parts.push(`📅 ${monthly.niveau}/50`);
  el.textContent = parts.join('  ·  ');
}

function renderVilQuestion() {
  document.getElementById('vil-map-container')?._resetZoom?.();
  const q = currentVilles[villesIndex];
  const niveau = villesIndex + 1;
  document.getElementById('vil-level-label').textContent = `Niveau ${niveau} / 50`;
  document.getElementById('vil-progress-fill').style.width = `${(villesIndex / 50) * 100}%`;

  const svgEl = document.querySelector('#vil-map-container svg');
  if (svgEl) {
    // Clear dept highlights, show city marker
    svgEl.querySelectorAll('.map-highlight').forEach(el => el.classList.remove('map-highlight'));
    showCityMarker(svgEl, q.lat, q.lon);
  }

  const feedback = document.getElementById('vil-feedback');
  feedback.className = 'feedback hidden'; feedback.innerHTML = '';

  const shuffled = [...q.choix].sort(() => Math.random() - 0.5);
  const choicesEl = document.getElementById('vil-choices');
  choicesEl.innerHTML = '';
  shuffled.forEach(choice => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn'; btn.textContent = choice;
    btn.addEventListener('click', () => handleVilAnswer(choice, q));
    choicesEl.appendChild(btn);
  });
}

function handleVilAnswer(choice, q) {
  const isCorrect = choice === q.reponse;
  document.querySelectorAll('#vil-choices .choice-btn').forEach(btn => {
    btn.disabled = true;
    if (btn.textContent === q.reponse) btn.classList.add('correct');
    else if (btn.textContent === choice && !isCorrect) btn.classList.add('incorrect');
  });
  const feedback = document.getElementById('vil-feedback');
  if (isCorrect) {
    feedback.className = 'feedback correct';
    feedback.textContent = '✓ Bonne réponse !';
    villesIndex++;
    if (villesIndex >= currentVilles.length) setTimeout(() => endDefiVilles(true, null), 1500);
    else setTimeout(renderVilQuestion, 1500);
  } else {
    feedback.className = 'feedback incorrect';
    feedback.innerHTML = `✗ C'était : <strong>${q.reponse}</strong>`;
    const svgEl = document.querySelector('#vil-map-container svg');
    if (svgEl) {
      const wrongItem = findInDefiData(villesData, choice);
      if (wrongItem?.lat != null) showCityMarkerError(svgEl, wrongItem.lat, wrongItem.lon);
    }
    setTimeout(() => endDefiVilles(false, { reponse: q.reponse, choixUser: choice, lat: q.lat, lon: q.lon }), 8000);
  }
}

function endDefiVilles(completed, erreur) {
  const niveauAtteint      = completed ? 50 : villesIndex;
  const isNewRecord        = saveDefiVillesRecord(niveauAtteint);
  const isNewMonthlyRecord = saveDefiVillesMonthly(niveauAtteint);

  showScreen('defi-villes-results');
  document.getElementById('vil-result-icon').textContent  = completed ? '🏆' : '💥';
  document.getElementById('vil-result-title').textContent = completed ? 'Bravo, défi complété !' : 'Game over !';
  document.getElementById('vil-result-score').textContent = `${niveauAtteint} / 50`;

  const record  = getDefiVillesRecord();
  const monthly = getDefiVillesMonthly();

  let msg = '';
  if (completed)                msg = '🎉 Parfait ! Tu connais toutes les villes françaises !';
  else if (niveauAtteint === 0) msg = 'Aïe, dès la première ville ! À retenter !';
  else if (niveauAtteint < 15) msg = 'Bon début ! Tu maîtrises les grandes villes.';
  else if (niveauAtteint < 30) msg = 'Pas mal ! Les villes moyennes te résistent encore.';
  else if (niveauAtteint < 45) msg = 'Très bien ! Tu es un expert de la France !';
  else                          msg = 'Exceptionnel ! Tu frôles la perfection !';
  document.getElementById('vil-result-msg').textContent = msg;

  const recordEl = document.getElementById('vil-result-record');
  if (isNewRecord || isNewMonthlyRecord) {
    recordEl.style.display = 'block';
    if (isNewRecord && niveauAtteint === 50) recordEl.textContent = '🏆 Record absolu — 50/50 !';
    else if (isNewRecord)        recordEl.textContent = `🏆 Nouveau record all-time : ${niveauAtteint}/50 !`;
    else if (isNewMonthlyRecord) recordEl.textContent = `📅 Nouveau record du mois : ${niveauAtteint}/50 !`;
  } else { recordEl.style.display = 'none'; }

  geoRecordPanel('vil-result-records', record, monthly, isNewRecord, isNewMonthlyRecord);

  const errorEl = document.getElementById('vil-result-error');
  if (erreur) {
    errorEl.innerHTML = `
      <p class="defi-error-title">La ville qui t'a arrêtée :</p>
      <p>Tu as répondu <span class="wrong-answer-text">${erreur.choixUser}</span></p>
      <p>✓ La bonne réponse était : <strong>${erreur.reponse}</strong></p>`;
    if (franceSvg) {
      const wrap = document.createElement('div');
      wrap.className = 'map-container';
      wrap.style.cssText = 'margin:10px auto;width:160px;height:108px';
      const mini = franceSvg.cloneNode(true);
      mini.setAttribute('width', '100%'); mini.setAttribute('height', '100%');
      mini.removeAttribute('style');
      showCityMarker(mini, erreur.lat, erreur.lon);
      wrap.appendChild(mini);
      errorEl.insertBefore(wrap, errorEl.children[1]);
    }
  } else { errorEl.innerHTML = ''; }

  document.getElementById('btn-vil-replay').onclick = () => {
    currentVilles = buildDefiGame(villesData);
    villesIndex = 0;
    showScreen('defi-villes');
    injectSvg('vil-map-container', franceSvg);
    setupMapZoom('vil-map-container');
    renderVilRecord();
    renderVilQuestion();
  };
  updateDefiRecordBadge();
}

// ─── Défi Pays ────────────────────────────────────────────────────────────────

async function startDefiPays() {
  if (!paysData) {
    try {
      const res = await fetch('./data/pays-defi.json');
      paysData = await res.json();
    } catch (e) { console.error('Erreur pays-defi.json', e); showScreen('home'); return; }
  }
  if (!worldSvg) {
    try { worldSvg = await loadSvgMap('./maps/world.svg'); }
    catch (e) { console.error('Erreur world.svg', e); showScreen('home'); return; }
  }
  currentPays = buildDefiGame(paysData);
  paysIndex = 0;
  showScreen('defi-pays');
  injectSvg('pays-map-container', worldSvg);
  setupMapZoom('pays-map-container');
  renderPaysRecord();
  renderPaysQuestion();
}

function renderPaysRecord() {
  const record = getDefiPaysRecord();
  const monthly = getDefiPaysMonthly();
  const el = document.getElementById('pays-record-live');
  if (!el) return;
  const parts = [];
  if (record)  parts.push(`🏆 ${record.niveau}/50`);
  if (monthly) parts.push(`📅 ${monthly.niveau}/50`);
  el.textContent = parts.join('  ·  ');
}

function renderPaysQuestion() {
  document.getElementById('pays-map-container')?._resetZoom?.();
  const q = currentPays[paysIndex];
  const niveau = paysIndex + 1;
  document.getElementById('pays-level-label').textContent = `Niveau ${niveau} / 50`;
  document.getElementById('pays-progress-fill').style.width = `${(paysIndex / 50) * 100}%`;

  const svgEl = document.querySelector('#pays-map-container svg');
  if (svgEl) highlightGeoPath(svgEl, q.id);

  const feedback = document.getElementById('pays-feedback');
  feedback.className = 'feedback hidden'; feedback.innerHTML = '';

  const shuffled = [...q.choix].sort(() => Math.random() - 0.5);
  const choicesEl = document.getElementById('pays-choices');
  choicesEl.innerHTML = '';
  shuffled.forEach(choice => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn'; btn.textContent = choice;
    btn.addEventListener('click', () => handlePaysAnswer(choice, q));
    choicesEl.appendChild(btn);
  });
}

function handlePaysAnswer(choice, q) {
  const isCorrect = choice === q.reponse;
  document.querySelectorAll('#pays-choices .choice-btn').forEach(btn => {
    btn.disabled = true;
    if (btn.textContent === q.reponse) btn.classList.add('correct');
    else if (btn.textContent === choice && !isCorrect) btn.classList.add('incorrect');
  });
  const feedback = document.getElementById('pays-feedback');
  if (isCorrect) {
    feedback.className = 'feedback correct';
    feedback.textContent = '✓ Bonne réponse !';
    paysIndex++;
    if (paysIndex >= currentPays.length) setTimeout(() => endDefiPays(true, null), 1500);
    else setTimeout(renderPaysQuestion, 1500);
  } else {
    feedback.className = 'feedback incorrect';
    feedback.innerHTML = `✗ C'était : <strong>${q.reponse}</strong>`;
    const svgEl = document.querySelector('#pays-map-container svg');
    if (svgEl) {
      const wrongItem = findInDefiData(paysData, choice);
      if (wrongItem?.id) highlightGeoPathError(svgEl, wrongItem.id);
    }
    setTimeout(() => endDefiPays(false, { id: q.id, reponse: q.reponse, choixUser: choice }), 8000);
  }
}

function endDefiPays(completed, erreur) {
  const niveauAtteint      = completed ? 50 : paysIndex;
  const isNewRecord        = saveDefiPaysRecord(niveauAtteint);
  const isNewMonthlyRecord = saveDefiPaysMonthly(niveauAtteint);

  showScreen('defi-pays-results');
  document.getElementById('pays-result-icon').textContent  = completed ? '🏆' : '💥';
  document.getElementById('pays-result-title').textContent = completed ? 'Bravo, défi complété !' : 'Game over !';
  document.getElementById('pays-result-score').textContent = `${niveauAtteint} / 50`;

  const record  = getDefiPaysRecord();
  const monthly = getDefiPaysMonthly();

  let msg = '';
  if (completed)                msg = '🎉 Parfait ! Tu connais tous les pays du monde !';
  else if (niveauAtteint === 0) msg = 'Aïe, dès le premier pays ! À retenter !';
  else if (niveauAtteint < 15) msg = 'Bon début ! Tu maîtrises les grands pays.';
  else if (niveauAtteint < 30) msg = 'Pas mal ! Les petits pays te résistent encore.';
  else if (niveauAtteint < 45) msg = 'Très bien ! Tu es un expert en géographie mondiale !';
  else                          msg = 'Exceptionnel ! Tu frôles la perfection !';
  document.getElementById('pays-result-msg').textContent = msg;

  const recordEl = document.getElementById('pays-result-record');
  if (isNewRecord || isNewMonthlyRecord) {
    recordEl.style.display = 'block';
    if (isNewRecord && niveauAtteint === 50) recordEl.textContent = '🏆 Record absolu — 50/50 !';
    else if (isNewRecord)        recordEl.textContent = `🏆 Nouveau record all-time : ${niveauAtteint}/50 !`;
    else if (isNewMonthlyRecord) recordEl.textContent = `📅 Nouveau record du mois : ${niveauAtteint}/50 !`;
  } else { recordEl.style.display = 'none'; }

  geoRecordPanel('pays-result-records', record, monthly, isNewRecord, isNewMonthlyRecord);

  const errorEl = document.getElementById('pays-result-error');
  if (erreur) {
    errorEl.innerHTML = `
      <p class="defi-error-title">Le pays qui t'a arrêté :</p>
      <p>Tu as répondu <span class="wrong-answer-text">${erreur.choixUser}</span></p>
      <p>✓ La bonne réponse était : <strong>${erreur.reponse}</strong></p>`;
    if (worldSvg) {
      const wrap = document.createElement('div');
      wrap.className = 'map-container';
      wrap.style.cssText = 'margin:10px auto;width:200px;height:102px';
      const mini = worldSvg.cloneNode(true);
      mini.setAttribute('width', '100%'); mini.setAttribute('height', '100%');
      mini.removeAttribute('style');
      highlightGeoPath(mini, erreur.id);
      wrap.appendChild(mini);
      errorEl.insertBefore(wrap, errorEl.children[1]);
    }
  } else { errorEl.innerHTML = ''; }

  document.getElementById('btn-pays-replay').onclick = () => {
    currentPays = buildDefiGame(paysData);
    paysIndex = 0;
    showScreen('defi-pays');
    injectSvg('pays-map-container', worldSvg);
    setupMapZoom('pays-map-container');
    renderPaysRecord();
    renderPaysQuestion();
  };
  updateDefiRecordBadge();
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

function switchTab(tabId) {
  localStorage.setItem('active_tab', tabId);
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tabId}`));
}

function initTabs() {
  const saved = localStorage.getItem('active_tab') || 'quiz';
  switchTab(saved);
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  initTabs();

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
      window.location.hash = `#defi-${card.dataset.defi}`;
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

// ─── Histoire France & Monde ──────────────────────────────────────────────────

async function startHistoire(mode) {
  histoireMode = mode;
  if (mode === 'france') {
    if (!histoireFrData) {
      try { const r = await fetch('./data/histoire-france.json'); histoireFrData = await r.json(); }
      catch (e) { console.error(e); showScreen('home'); return; }
    }
    currentHistoire = buildDefiGame(histoireFrData);
  } else {
    if (!histoireMondeData) {
      try { const r = await fetch('./data/histoire-monde.json'); histoireMondeData = await r.json(); }
      catch (e) { console.error(e); showScreen('home'); return; }
    }
    currentHistoire = buildDefiGame(histoireMondeData);
  }
  histoireIndex = 0;
  histoireScore = 0;
  document.getElementById('hist-mode-badge').textContent = mode === 'france' ? '🏰 France' : '🌐 Monde';
  showScreen('histoire');
  renderHistoireQuestion();
}

function renderHistoireQuestion() {
  const q = currentHistoire[histoireIndex];
  const total = currentHistoire.length;
  document.getElementById('hist-level-label').textContent = `Question ${histoireIndex + 1} / ${total}`;
  document.getElementById('hist-progress-fill').style.width = `${(histoireIndex / total) * 100}%`;

  // Randomly assign event1/event2 to left/right button
  const swap = Math.random() < 0.5;
  const evA = swap ? q.event2 : q.event1;
  const evB = swap ? q.event1 : q.event2;

  const btn1 = document.getElementById('hist-btn1');
  const btn2 = document.getElementById('hist-btn2');

  [btn1, btn2].forEach((btn, i) => {
    const ev = i === 0 ? evA : evB;
    btn.querySelector('.hist-event-label').textContent = ev.label;
    const dateEl = btn.querySelector('.hist-event-date');
    dateEl.textContent = '';
    dateEl.classList.add('hidden');
    btn.className = 'hist-event-btn';
    btn.disabled = false;
    btn.dataset.annee = ev.annee;
    btn.dataset.display = ev.display;
  });

  const nextBtn = document.getElementById('hist-next-btn');
  nextBtn.classList.add('hidden');
  nextBtn.textContent = histoireIndex >= total - 1 ? 'Voir les résultats →' : 'Suivant →';
}

window.handleHistoireAnswer = function(btnNum) {
  const btn1 = document.getElementById('hist-btn1');
  const btn2 = document.getElementById('hist-btn2');
  const a1 = parseFloat(btn1.dataset.annee);
  const a2 = parseFloat(btn2.dataset.annee);

  // Reveal dates
  [btn1, btn2].forEach(btn => {
    const dateEl = btn.querySelector('.hist-event-date');
    dateEl.textContent = btn.dataset.display;
    dateEl.classList.remove('hidden');
    btn.disabled = true;
  });

  // Special case: Darwin & Lincoln born same day — both correct
  const tie = (a1 === a2);
  const correctBtn = tie ? btnNum : (a1 < a2 ? 1 : 2);
  const isCorrect = tie || (btnNum === correctBtn);

  if (isCorrect) {
    histoireScore++;
    (btnNum === 1 ? btn1 : btn2).classList.add('hist-correct');
    const other = btnNum === 1 ? btn2 : btn1;
    other.classList.add('hist-neutral');
  } else {
    (btnNum === 1 ? btn1 : btn2).classList.add('hist-wrong');
    (correctBtn === 1 ? btn1 : btn2).classList.add('hist-correct');
  }

  document.getElementById('hist-next-btn').classList.remove('hidden');
};

window.nextHistoireQuestion = function() {
  histoireIndex++;
  if (histoireIndex >= currentHistoire.length) {
    showHistoireResults();
  } else {
    renderHistoireQuestion();
  }
};

function showHistoireResults() {
  const total = currentHistoire.length;
  const pct = Math.round(histoireScore / total * 100);
  showScreen('histoire-results');
  document.getElementById('hist-result-title').textContent =
    histoireMode === 'france' ? 'Quiz Histoire de France !' : 'Quiz Histoire du monde !';
  document.getElementById('hist-result-score').textContent = `${histoireScore} / ${total}`;
  document.getElementById('hist-result-pct').textContent = `${pct}%`;

  let icon, msg;
  if (pct >= 90)      { icon = '🏆'; msg = 'Excellent ! Tu es un expert en histoire !'; }
  else if (pct >= 70) { icon = '⭐'; msg = 'Très bien ! Tu connais bien ton histoire !'; }
  else if (pct >= 50) { icon = '👍'; msg = 'Pas mal ! Continue à apprendre !'; }
  else                { icon = '📚'; msg = 'À réviser ! Tu feras mieux la prochaine fois.'; }

  document.getElementById('hist-result-icon').textContent = icon;
  document.getElementById('hist-result-msg').textContent = msg;

  document.getElementById('btn-hist-replay').onclick = () => {
    window.location.hash = `#defi-histoire-${histoireMode}`;
  };
}

// ─── Sport : Qui a le plus ? ──────────────────────────────────────────────────

async function startSport() {
  if (!sportData) {
    try { const r = await fetch('./data/sport-defi.json'); sportData = await r.json(); }
    catch (e) { console.error(e); showScreen('home'); return; }
  }
  currentSport = buildDefiGame(sportData);
  sportIndex = 0;
  sportScore = 0;
  showScreen('sport');
  renderSportQuestion();
}

function renderSportQuestion() {
  const q = currentSport[sportIndex];
  const total = currentSport.length;
  document.getElementById('sport-level-label').textContent = `Question ${sportIndex + 1} / ${total}`;
  document.getElementById('sport-progress-fill').style.width = `${(sportIndex / total) * 100}%`;
  document.getElementById('sport-question-text').textContent = q.question;

  // Randomly swap sport1/sport2 between left and right button
  const swap = Math.random() < 0.5;
  const sA = swap ? q.sport2 : q.sport1;
  const sB = swap ? q.sport1 : q.sport2;

  const btn1 = document.getElementById('sport-btn1');
  const btn2 = document.getElementById('sport-btn2');

  [btn1, btn2].forEach((btn, i) => {
    const s = i === 0 ? sA : sB;
    btn.querySelector('.hist-event-label').textContent = s.label;
    const statEl = btn.querySelector('.hist-event-date');
    statEl.textContent = '';
    statEl.classList.add('hidden');
    btn.className = 'hist-event-btn';
    btn.disabled = false;
    btn.dataset.stat = s.stat;
    btn.dataset.display = s.display;
  });

  const nextBtn = document.getElementById('sport-next-btn');
  nextBtn.classList.add('hidden');
  nextBtn.textContent = sportIndex >= total - 1 ? 'Voir les résultats →' : 'Suivant →';
}

window.handleSportAnswer = function(btnNum) {
  const btn1 = document.getElementById('sport-btn1');
  const btn2 = document.getElementById('sport-btn2');
  const s1 = parseFloat(btn1.dataset.stat);
  const s2 = parseFloat(btn2.dataset.stat);

  // Reveal stat on both buttons
  [btn1, btn2].forEach(btn => {
    const statEl = btn.querySelector('.hist-event-date');
    statEl.textContent = btn.dataset.display;
    statEl.classList.remove('hidden');
    btn.disabled = true;
  });

  // Égalité possible (même stat)
  const tie = (s1 === s2);
  const correctBtn = tie ? btnNum : (s1 > s2 ? 1 : 2);
  const isCorrect = tie || (btnNum === correctBtn);

  if (isCorrect) {
    sportScore++;
    (btnNum === 1 ? btn1 : btn2).classList.add('hist-correct');
    (btnNum === 1 ? btn2 : btn1).classList.add('hist-neutral');
  } else {
    (btnNum === 1 ? btn1 : btn2).classList.add('hist-wrong');
    (correctBtn === 1 ? btn1 : btn2).classList.add('hist-correct');
  }

  document.getElementById('sport-next-btn').classList.remove('hidden');
};

window.nextSportQuestion = function() {
  sportIndex++;
  if (sportIndex >= currentSport.length) {
    showSportResults();
  } else {
    renderSportQuestion();
  }
};

function showSportResults() {
  const total = currentSport.length;
  const pct = Math.round(sportScore / total * 100);
  showScreen('sport-results');
  document.getElementById('sport-result-score').textContent = `${sportScore} / ${total}`;
  document.getElementById('sport-result-pct').textContent = `${pct}%`;

  let icon, msg;
  if (pct >= 90)      { icon = '🏆'; msg = 'Exceptionnel ! Tu es un vrai expert du sport !'; }
  else if (pct >= 70) { icon = '⭐'; msg = 'Très bien ! Tu t\'y connais en sport !'; }
  else if (pct >= 50) { icon = '👍'; msg = 'Pas mal ! Continue à suivre l\'actu sportive !'; }
  else                { icon = '📺'; msg = 'Les stats du sport te réservent encore des surprises !'; }

  document.getElementById('sport-result-icon').textContent = icon;
  document.getElementById('sport-result-msg').textContent = msg;
  document.getElementById('btn-sport-replay').onclick = () => { window.location.hash = '#defi-sport'; };
}

document.addEventListener('DOMContentLoaded', init);
