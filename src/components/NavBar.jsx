import React, { useContext } from 'react';
import { AppContext } from '../App.jsx';
import { t } from '../i18n/index.js';
import LangSwitcher from './LangSwitcher.jsx';
import GpuGuard from './GpuGuard.jsx';
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
    if (window.confirm(t('settings.mode_confirm'))) {
      setActiveModel(mode);
      dispatch({ type: 'SET_MODEL_STATUS', status: 'idle', message: t('settings.switched_msg') });
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
          <div className="perf-dropdown-wrapper">
            <div className="perf-trigger">
              <span className="perf-current-title">
                {isLite ? '⚡' : '🏆'} {isLite ? t('settings.lite_mode_title') : t('settings.pro_mode_title')}
              </span>
              <span className="perf-current-subtitle">
                {isLite ? t('settings.lite_mode_vram') : t('settings.pro_mode_vram')}
              </span>
            </div>
            <div className="perf-dropdown-menu">
              <button
                className={`perf-option ${!isLite ? 'perf-option--active' : ''}`}
                onClick={() => isLite && handleModeChange({ target: { value: 'pro' } })}
              >
                <span className="perf-title">🏆 {t('settings.pro_mode_title')}</span>
                <span className="perf-desc">{t('settings.pro_mode_desc')}</span>
                <span className="perf-vram">{t('settings.pro_mode_vram')}</span>
              </button>
              <button
                className={`perf-option ${isLite ? 'perf-option--active' : ''}`}
                onClick={() => !isLite && handleModeChange({ target: { value: 'lite' } })}
              >
                <span className="perf-title">⚡ {t('settings.lite_mode_title')}</span>
                <span className="perf-desc">{t('settings.lite_mode_desc')}</span>
                <span className="perf-vram">{t('settings.lite_mode_vram')}</span>
              </button>
            </div>
          </div>
        </div>

        <GpuGuard />

        <LangSwitcher variant="compact" />
      </div>
    </nav>
  );
}

