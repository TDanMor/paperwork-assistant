import en from './en.json';
import de from './de.json';
import es from './es.json';
import fr from './fr.json';
import ro from './ro.json';

const translations = { en, de, es, fr, ro };

export function t(path) {
  const activeLang = localStorage.getItem('pa_lang') || 'en';
  const dict = translations[activeLang] || translations.en;
  
  const keys = path.split('.');
  let val = dict;
  for (const k of keys) {
    if (!val) break;
    val = val[k];
  }
  
  if (!val) {
    let fallback = translations.en;
    for (const k of keys) {
      if (!fallback) break;
      fallback = fallback[k];
    }
    return fallback || path;
  }
  return val;
}

// Re-adding the missing export so App.jsx doesn't crash!
export function setLanguage(lang) {
  localStorage.setItem('pa_lang', lang);
}
