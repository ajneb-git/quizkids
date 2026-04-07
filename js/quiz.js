import { CONFIG } from './config.js';
import { getDailyQuestions, markQuestionsAsSeen, markPlayedToday } from './storage.js';

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
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}

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

  stopTimer() {
    if (this.timer) this.timer.stop();
  }

  answer(choice) {
    if (this.answered) return null;
    this.answered = true;
    this.stopTimer();

    const q = this.getCurrentQuestion();
    const isCorrect = choice === q.reponse;
    if (isCorrect) {
      this.scores[q.categorie].correct++;
    } else {
      this.wrongAnswers.push({ question: q.question, media: q.media ?? null, userAnswer: choice, correctAnswer: q.reponse, explication: q.explication });
    }
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

export async function loadQuestions(questionsFile) {
  const response = await fetch(questionsFile);
  if (!response.ok) throw new Error('Failed to load questions');
  const data = await response.json();
  return data.categories;
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
