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
      <div className="navbar-brand-container">
        <span className="navbar-brand-icon">🤵</span>
        <div className="navbar-brand-info">
          <span className="navbar-brand-text">{t('app_title')}</span>
          <span className="navbar-version-label">v:{__APP_VERSION__}</span>
        </div>
      </div>

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
        <div className="perf-toggle-container">
          <div className="perf-dropdown">
            <div className="perf-current">
              <span className="perf-title">
                {isLite ? '⚡' : '🏆'} {isLite ? t('settings.ai_lite_title') : t('settings.ai_pro_title')}
              </span>
              <span className="perf-subtitle">
                {isLite ? t('settings.ai_lite_vram') : t('settings.ai_pro_vram')}
              </span>
            </div>
            <select
              className="perf-select-overlay"
              value={isLite ? 'lite' : 'pro'}
              onChange={handleModeChange}
              title={t('settings.ai_model')}
            >
              <option value="pro">🏆 {t('settings.ai_pro_title')} ({t('settings.ai_pro_vram')})</option>
              <option value="lite">⚡ {t('settings.ai_lite_title')} ({t('settings.ai_lite_vram')})</option>
            </select>
          </div>
        </div>

        <LangSwitcher variant="compact" />
      </div>
    </nav>
  );
}

