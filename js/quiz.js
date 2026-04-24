import { CONFIG } from './config.js';
import { getDailyQuestions, markQuestionsAsSeen, markPlayedToday } from './storage.js';

// ─── Timer ────────────────────────────────────────────────────────────────────

class QuizTimer {
  constructor(duration, onTick, onExpire) {
    this.duration = duration;
    this.onTick = onTick;
    this.onExpire = onExpire;
    this.interval = null;
  }

  start() {
    this.startTime = Date.now();
    this.interval = setInterval(() => {
      const elapsed = Date.now() - this.startTime;
      const remaining = Math.max(0, this.duration - elapsed);
      this.onTick(remaining / this.duration);
      if (remaining === 0) {
        clearInterval(this.interval);
        this.interval = null;
        this.onExpire();
      }
    }, 50);
  }

  stop() {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
  }
}

// ─── Quiz Engine (quiz quotidien) ─────────────────────────────────────────────

export class QuizEngine {
  constructor(questions, categories, timerDuration, onEnd) {
    this.questions = questions;
    this.categories = categories;
    this.timerDuration = timerDuration;
    this.currentIndex = 0;
    this.onEnd = onEnd;
    this.timer = null;
    this.answered = false;
    this.wrongAnswers = [];

    this.scores = {};
    categories.forEach(cat => {
      this.scores[cat] = { correct: 0, total: CONFIG.QUESTIONS_PER_CATEGORY };
    });
  }

  getCurrentQuestion()  { return this.questions[this.currentIndex]; }
  getTotalQuestions()   { return this.questions.length; }
  getCurrentIndex()     { return this.currentIndex; }

  startTimer(onTick, onExpire) {
    this.timer = new QuizTimer(this.timerDuration, onTick, onExpire);
    this.timer.start();
  }

  stopTimer() { if (this.timer) this.timer.stop(); }

  answer(choice) {
    if (this.answered) return null;
    this.answered = true;
    this.stopTimer();
    const q = this.getCurrentQuestion();
    const isCorrect = choice === q.reponse;
    if (isCorrect) this.scores[q.categorie].correct++;
    else this.wrongAnswers.push({ question: q.question, media: q.media ?? null, userAnswer: choice, correctAnswer: q.reponse, explication: q.explication });
    return { isCorrect, correctAnswer: q.reponse, explication: q.explication };
  }

  timeExpired() {
    if (this.answered) return null;
    this.answered = true;
    const q = this.getCurrentQuestion();
    this.wrongAnswers.push({ question: q.question, media: q.media ?? null, userAnswer: null, correctAnswer: q.reponse, explication: q.explication });
    return { isCorrect: false, correctAnswer: q.reponse, explication: q.explication };
  }

  next() {
    this.currentIndex++;
    this.answered = false;
    if (this.currentIndex >= this.questions.length) {
      markPlayedToday(this.scores, this.wrongAnswers);
      this.categories.forEach(cat => {
        const ids = this.questions.filter(q => q.categorie === cat).map(q => q.id);
        markQuestionsAsSeen(cat, ids);
      });
      this.onEnd(this.scores);
      return false;
    }
    return true;
  }

  getScores() { return this.scores; }
}

// ─── Revision Engine (rejouable, mélange aléatoire) ──────────────────────────

export class RevisionEngine {
  constructor(questions, timerDuration, onEnd) {
    // Shuffle randomly (pas de seed quotidienne)
    this.questions = [...questions].sort(() => Math.random() - 0.5);
    this.timerDuration = timerDuration;
    this.currentIndex = 0;
    this.onEnd = onEnd;
    this.timer = null;
    this.answered = false;
    this.correct = 0;
    this.wrongAnswers = [];
  }

  getCurrentQuestion()  { return this.questions[this.currentIndex]; }
  getTotalQuestions()   { return this.questions.length; }
  getCurrentIndex()     { return this.currentIndex; }

  startTimer(onTick, onExpire) {
    this.timer = new QuizTimer(this.timerDuration, onTick, onExpire);
    this.timer.start();
  }

  stopTimer() { if (this.timer) this.timer.stop(); }

  // Pour QCM
  answer(choice) {
    if (this.answered) return null;
    this.answered = true;
    this.stopTimer();
    const q = this.getCurrentQuestion();
    const isCorrect = choice === q.reponse;
    this._record(q, choice, isCorrect);
    return { isCorrect, correctAnswer: q.reponse, explication: q.explication, chapitre: q.chapitre };
  }

  // Pour champ texte — comparaison exacte (casse + accents)
  answerText(input) {
    if (this.answered) return null;
    this.answered = true;
    this.stopTimer();
    const q = this.getCurrentQuestion();
    const isCorrect = input.trim() === q.reponse;
    this._record(q, input.trim(), isCorrect);
    return { isCorrect, correctAnswer: q.reponse, explication: q.explication, chapitre: q.chapitre };
  }

  timeExpired() {
    if (this.answered) return null;
    this.answered = true;
    const q = this.getCurrentQuestion();
    this._record(q, null, false);
    return { isCorrect: false, correctAnswer: q.reponse, explication: q.explication, chapitre: q.chapitre };
  }

  _record(q, userAnswer, isCorrect) {
    if (isCorrect) {
      this.correct++;
    } else {
      this.wrongAnswers.push({
        question: q.question,
        chapitre: q.chapitre,
        type: q.type,
        userAnswer,
        correctAnswer: q.reponse,
        explication: q.explication
      });
    }
  }

  next() {
    this.currentIndex++;
    this.answered = false;
    if (this.currentIndex >= this.questions.length) {
      this.onEnd({ correct: this.correct, total: this.questions.length, wrongAnswers: this.wrongAnswers });
      return false;
    }
    return true;
  }
}

// ─── Loaders ─────────────────────────────────────────────────────────────────

export async function loadQuestions(questionsFile) {
  const response = await fetch(questionsFile);
  if (!response.ok) throw new Error('Failed to load questions');
  const data = await response.json();
  return data.categories;
}

export async function loadRevisionQuestions(questionsFile, category) {
  const response = await fetch(questionsFile);
  if (!response.ok) throw new Error('Failed to load revision questions');
  const data = await response.json();
  return data.categories[category] ?? [];
}

export function prepareQuestions(allQuestions, categories) {
  const byCategory = categories.map(cat => getDailyQuestions(allQuestions, cat));
  const result = [];
  for (let i = 0; i < CONFIG.QUESTIONS_PER_CATEGORY; i++) {
    for (let c = 0; c < categories.length; c++) {
      if (byCategory[c][i]) result.push(byCategory[c][i]);
    }
  }
  return result;
}
