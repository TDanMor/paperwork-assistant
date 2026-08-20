import React, { useContext } from 'react';
import { AppContext } from '../App.jsx';
import { t } from '../i18n/index.js';
import LangSwitcher from './LangSwitcher.jsx';
import { activeModelId, MODELS, setActiveModel } from '../ai/engine.js';

const NAV_ITEMS = [
  { view: 'dashboard', icon: '📊', labelKey: 'nav.dashboard' },
  { view: 'upload',    icon: '📤', labelKey: 'nav.upload'    },
  { view: 'folders',   icon: '📁', labelKey: 'nav.folders'   },
  { view: 'settings',  icon: '⚙️',  labelKey: 'nav.settings'  },
];

export default function NavBar() {
  const { state, dispatch } = useContext(AppContext);
  const isLite = activeModelId === MODELS.lite;

  const handleModeChange = (e) => {
    const mode = e.target.value;
    if (window.confirm(t('settings.ai_mode_confirm'))) {
      setActiveModel(mode);
      dispatch({ type: 'SET_MODEL_STATUS', status: 'idle', message: t('settings.ai_switched_msg') });
      // Force a tiny delay so the reducer catches up before any automatic re-load triggers
      setTimeout(() => window.location.reload(), 100);
    }
  };

  return (
    <nav className="navbar">
      <span className="navbar-brand">📄 {t('app_title')}</span>
      <div className="navbar-links">
        {NAV_ITEMS.map(item => (
          <button
            key={item.view}
            className={`nav-btn${state.view === item.view ? ' active' : ''}`}
            onClick={() => { if (state.isUploading) { alert(t('nav.uploading_alert')); return; } dispatch({ type: 'SET_VIEW', view: item.view }) }}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{t(item.labelKey)}</span>
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <select
          className="lang-select"
          value={isLite ? 'lite' : 'pro'}
          onChange={handleModeChange}
          style={{ fontSize: '0.8rem', padding: '0.2rem 0.4rem' }}
        >
          <option value="pro">🏆 {t('settings.ai_pro_title').split(' ')[2] || 'Pro'}</option>
          <option value="lite">⚡ {t('settings.ai_lite_title').split(' ')[2] || 'Lite'}</option>
        </select>

        <LangSwitcher variant="compact" />
        <span className="navbar-version">v:{__APP_VERSION__}</span>
      </div>
    </nav>
  );
}

