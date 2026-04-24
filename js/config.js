export const CONFIG = {
  QUESTIONS_PER_CATEGORY: 10,
  TIMER_DURATION_MS: 15000,
  FEEDBACK_DELAY_MS: 2000,
};

export const LEVEL_CONFIG = {
  college: {
    label: '6e / 5e',
    emoji: '📚',
    timerDuration: 15000,
    categories: ['drapeaux', 'sport', 'histoire', 'sciences', 'culture', 'geographie'],
    categoryLabels: {
      drapeaux:   '🌍 Drapeaux',
      sport:      '⚽ Sport',
      histoire:   '📜 Histoire',
      sciences:   '🔬 Sciences',
      culture:    '🎬 Culture',
      geographie: '🗺️ Géographie'
    },
    questionsFile: './data/questions.json',
    maxScore: 60
  },
  primaire: {
    label: 'École primaire',
    emoji: '🎒',
    timerDuration: 20000,
    categories: ['drapeaux', 'geographie', 'culture', 'logique', 'sport', 'gastronomie'],
    categoryLabels: {
      drapeaux:    '🌍 Drapeaux',
      geographie:  '🗺️ Géo & capitales',
      culture:     '🎬 Culture & Disney',
      logique:     '🧮 Logique & maths',
      sport:       '⚽ Sport',
      gastronomie: '🍎 Gastronomie'
    },
    questionsFile: './data/questions-primaire.json',
    maxScore: 60
  }
};

export const REVISION_CONFIG = {
  conjugaison: {
    label: 'Conjugaison',
    emoji: '✍️',
    description: 'Passé composé · Plus-que-parfait · Impératif · Accord PP',
    timerDuration: 30000,
    questionsFile: './data/questions-revision-conjugaison.json',
    category: 'conjugaison'
  }
};
