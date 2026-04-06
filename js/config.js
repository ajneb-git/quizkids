export const CONFIG = {
  QUESTIONS_PER_CATEGORY: 10,
  TIMER_DURATION_MS: 15000,
  FEEDBACK_DELAY_MS: 1500,
};

export const LEVEL_CONFIG = {
  college: {
    label: '6e / 5e',
    emoji: '📚',
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
