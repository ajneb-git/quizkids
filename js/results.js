import { CONFIG } from './config.js';
import { getShareUrl } from './share.js';

const chartInstances = {};

export async function renderResults(scores, compareScores = null, canvasId = 'radar-canvas', breakdownId = 'score-breakdown') {
  renderScoreSummary(scores, breakdownId);
  await renderRadar(scores, compareScores, canvasId);
}

function renderScoreSummary(scores, breakdownId) {
  const total = CONFIG.CATEGORIES.reduce((sum, cat) => sum + (scores[cat]?.correct ?? 0), 0);
  const maxTotal = CONFIG.CATEGORIES.length * CONFIG.QUESTIONS_PER_CATEGORY;

  const totalEl = document.getElementById('total-score');
  if (totalEl) totalEl.textContent = `${total} / ${maxTotal}`;

  const breakdown = document.getElementById(breakdownId);
  if (!breakdown) return;

  breakdown.innerHTML = CONFIG.CATEGORIES.map(cat => {
    const s = scores[cat] ?? { correct: 0, total: 10 };
    const pct = Math.round((s.correct / s.total) * 100);
    const label = CONFIG.CATEGORY_LABELS[cat];
    return `
      <div class="score-row">
        <span class="score-label">${label}</span>
        <span class="score-value">${s.correct}/${s.total}</span>
        <div class="score-bar-track">
          <div class="score-bar-fill" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

async function renderRadar(scores, compareScores, canvasId) {
  if (chartInstances[canvasId]) {
    chartInstances[canvasId].destroy();
    delete chartInstances[canvasId];
  }

  const { Chart, registerables } = await import('https://cdn.jsdelivr.net/npm/chart.js@4/+esm');
  Chart.register(...registerables);

  const labels = CONFIG.CATEGORIES.map(cat => CONFIG.CATEGORY_LABELS[cat]);
  const myData = CONFIG.CATEGORIES.map(cat => scores[cat]?.correct ?? 0);

  const datasets = [{
    label: 'Moi',
    data: myData,
    backgroundColor: 'rgba(99, 102, 241, 0.25)',
    borderColor: 'rgb(99, 102, 241)',
    pointBackgroundColor: 'rgb(99, 102, 241)',
    pointBorderColor: '#fff',
    pointRadius: 4,
  }];

  if (compareScores) {
    datasets.push({
      label: 'Mon ami',
      data: CONFIG.CATEGORIES.map(cat => compareScores[cat]?.correct ?? 0),
      backgroundColor: 'rgba(251, 146, 60, 0.25)',
      borderColor: 'rgb(251, 146, 60)',
      pointBackgroundColor: 'rgb(251, 146, 60)',
      pointBorderColor: '#fff',
      pointRadius: 4,
    });
  }

  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  chartInstances[canvasId] = new Chart(canvas, {
    type: 'radar',
    data: { labels, datasets },
    options: {
      scales: {
        r: {
          min: 0,
          max: 10,
          ticks: {
            stepSize: 2,
            color: 'rgba(255,255,255,0.4)',
            backdropColor: 'transparent',
            font: { size: 10 }
          },
          grid: { color: 'rgba(255,255,255,0.1)' },
          angleLines: { color: 'rgba(255,255,255,0.15)' },
          pointLabels: {
            color: 'rgba(255,255,255,0.85)',
            font: { size: 12, family: 'Nunito', weight: '700' }
          }
        }
      },
      plugins: {
        legend: {
          display: !!compareScores,
          labels: {
            color: 'rgba(255,255,255,0.85)',
            font: { family: 'Nunito', size: 13 }
          }
        }
      },
      animation: { duration: 600 }
    }
  });
}

export function renderEncouragingMessage(scores, elId = 'encouraging-msg') {
  const el = document.getElementById(elId);
  if (!el) return;

  const ranked = CONFIG.CATEGORIES
    .map(cat => ({
      cat,
      correct: scores[cat]?.correct ?? 0,
      label: CONFIG.CATEGORY_LABELS[cat].replace(/^\S+\s+/, '') // strip emoji
    }))
    .sort((a, b) => b.correct - a.correct);

  const best  = ranked[0];
  const worst = ranked[ranked.length - 1];
  const total = ranked.reduce((s, r) => s + r.correct, 0);

  let msg;

  if (best.correct === worst.correct) {
    msg = `Régulier sur toutes les catégories avec ${best.correct}/10 partout — c'est solide ! 💪`;
  } else if (total >= 50) {
    msg = `Impressionnant ! Tu maîtrises notamment la ${best.label.toLowerCase()} (${best.correct}/10). Encore un effort en ${worst.label.toLowerCase()} et tu seras imbattable ! 🔥`;
  } else if (total >= 36) {
    msg = `Bien joué ! T'es vraiment fort·e en ${best.label.toLowerCase()} (${best.correct}/10). La ${worst.label.toLowerCase()} te résiste encore... mais ça viendra ! 💡`;
  } else if (total >= 20) {
    msg = `Tu peux mieux faire en ${worst.label.toLowerCase()} (${worst.correct}/10), mais t'es imbattable en ${best.label.toLowerCase()} (${best.correct}/10) ! Continue comme ça ! 🚀`;
  } else {
    msg = `C'est un début ! La ${best.label.toLowerCase()} est ton point fort (${best.correct}/10). Reviens demain pour progresser — chaque jour compte ! ⭐`;
  }

  el.textContent = msg;
}

export function renderWrongAnswers(wrongAnswers, elId = 'wrong-answers') {
  const el = document.getElementById(elId);
  if (!el) return;

  if (!wrongAnswers || wrongAnswers.length === 0) {
    el.innerHTML = '<p class="perfect-score">🎉 Aucune erreur aujourd\'hui — score parfait !</p>';
    return;
  }

  const total = wrongAnswers.length;

  function slideHTML(w) {
    return `
      <div class="wrong-item">
        ${w.media?.type === 'emoji' ? `<span class="wrong-media">${w.media.valeur}</span>` : ''}
        <p class="wrong-question">${w.question}</p>
        <p class="wrong-user">${w.userAnswer === null
          ? '⏱ Temps écoulé'
          : `Tu as répondu : <span class="wrong-answer-text">${w.userAnswer}</span>`}</p>
        <p class="wrong-correct">✅ Bonne réponse : <strong>${w.correctAnswer}</strong></p>
        ${w.explication ? `<p class="wrong-explication">${w.explication}</p>` : ''}
      </div>
    `;
  }

  el.innerHTML = `
    <div class="wrong-carousel">
      <div class="carousel-header">
        <h3 class="section-title">Tes erreurs</h3>
        <span class="carousel-counter">${total === 1 ? '1 erreur' : `1 / ${total}`}</span>
      </div>
      <div class="carousel-slide">${slideHTML(wrongAnswers[0])}</div>
      ${total > 1 ? `
      <div class="carousel-nav">
        <button class="carousel-btn carousel-prev" aria-label="Précédent">‹</button>
        <div class="carousel-dots">
          ${wrongAnswers.map((_, i) => `<span class="dot${i === 0 ? ' active' : ''}"></span>`).join('')}
        </div>
        <button class="carousel-btn carousel-next" aria-label="Suivant">›</button>
      </div>` : ''}
    </div>
  `;

  if (total <= 1) return;

  let currentIdx = 0;
  const slideEl  = el.querySelector('.carousel-slide');
  const counter  = el.querySelector('.carousel-counter');
  const dots     = el.querySelectorAll('.dot');
  const prevBtn  = el.querySelector('.carousel-prev');
  const nextBtn  = el.querySelector('.carousel-next');

  function goTo(idx) {
    currentIdx = (idx + total) % total;
    slideEl.innerHTML = slideHTML(wrongAnswers[currentIdx]);
    counter.textContent = `${currentIdx + 1} / ${total}`;
    dots.forEach((d, i) => d.classList.toggle('active', i === currentIdx));
  }

  prevBtn.addEventListener('click', () => goTo(currentIdx - 1));
  nextBtn.addEventListener('click', () => goTo(currentIdx + 1));

  // Swipe support
  let touchStartX = 0;
  const carousel = el.querySelector('.wrong-carousel');
  carousel.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
  carousel.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 48) goTo(currentIdx + (dx < 0 ? 1 : -1));
  });
}

export function renderComeBackTomorrow(elId = 'come-back-msg') {
  const el = document.getElementById(elId);
  if (!el) return;

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const day = tomorrow.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  el.innerHTML = `
    <span class="come-back-icon">🗓️</span>
    <p>C'est terminé pour aujourd'hui !</p>
    <p class="come-back-date">Rendez-vous <strong>${day} dès 8h</strong> pour retenter ta chance avec de nouvelles questions.</p>
  `;
}

export function setupShareButton(scores, btnId = 'btn-share') {
  const btn = document.getElementById(btnId);
  if (!btn) return;

  const url = getShareUrl(scores);
  btn.onclick = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'QuizKids — Je te défie !',
          text: 'J\'ai fait mon quiz du jour. Peux-tu faire mieux ?',
          url
        });
      } catch {
        // User cancelled
      }
    } else {
      try {
        await navigator.clipboard.writeText(url);
        const original = btn.textContent;
        btn.textContent = '✓ Lien copié !';
        setTimeout(() => { btn.textContent = original; }, 2000);
      } catch {
        prompt('Copie ce lien pour défier un ami :', url);
      }
    }
  };
}
