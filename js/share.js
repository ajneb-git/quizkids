const CATEGORY_ORDER = ['drapeaux', 'sport', 'histoire', 'sciences', 'culture', 'geographie'];

export function encodeScores(scores) {
  const values = CATEGORY_ORDER.map(cat => scores[cat]?.correct ?? 0);
  return btoa(values.join(','));
}

export function decodeScores(encoded) {
  try {
    const values = atob(encoded).split(',').map(Number);
    if (values.length !== CATEGORY_ORDER.length) return null;
    return Object.fromEntries(
      CATEGORY_ORDER.map((cat, i) => [cat, { correct: values[i], total: 10 }])
    );
  } catch {
    return null;
  }
}

export function getShareUrl(scores) {
  const base = window.location.origin + window.location.pathname;
  return `${base}#compare?ref=${encodeScores(scores)}`;
}

export function getRefFromHash() {
  const hash = window.location.hash;
  const match = hash.match(/[?&]ref=([^&]+)/);
  return match ? match[1] : null;
}
