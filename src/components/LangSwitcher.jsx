import React, { useContext } from 'react';
import { AppContext } from '../App.jsx';

const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'ro', label: 'Română', flag: '🇷🇴' },
];

export default function LangSwitcher({ variant = 'default' }) {
  const { state, dispatch } = useContext(AppContext);

  if (variant === 'compact') {
    return (
      <div className="lang-switcher-compact">
        <select
          value={state.language}
          onChange={(e) => dispatch({ type: 'SET_LANGUAGE', payload: e.target.value })}
          className="lang-select"
        >
          {LANGUAGES.map(lang => (
            <option key={lang.code} value={lang.code}>
              {lang.flag} {lang.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="lang-grid">
      {LANGUAGES.map(lang => (
        <button
          key={lang.code}
          className={`btn ${state.language === lang.code ? 'btn-primary' : 'btn-outline'} btn-sm`}
          onClick={() => dispatch({ type: 'SET_LANGUAGE', payload: lang.code })}
          style={{ minWidth: '100px' }}
        >
          {lang.flag} {lang.label}
        </button>
      ))}
    </div>
  );
}
