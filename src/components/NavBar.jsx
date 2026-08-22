import React, { useContext, useState, useRef, useEffect } from 'react';
import { AppContext } from '../App.jsx';
import { t } from '../i18n/index.js';
import LangSwitcher from './LangSwitcher.jsx';
import GpuGuard from './GpuGuard.jsx';
import { activeModelId, MODELS, setActiveModel } from '../ai/engine.js';

const NAV_ITEMS = [
  { view: 'dashboard', icon: '📊', labelKey: 'nav.dashboard' },
  { view: 'upload',    icon: '📤', labelKey: 'nav.upload'    },
  { view: 'folders',   icon: '📁', labelKey: 'nav.folders'   },
  { view: 'timeline',  icon: '⏱️', labelKey: 'nav.timeline'  },
  { view: 'settings',  icon: '⚙️', labelKey: 'nav.settings'  },
];

export default function NavBar() {
  const { state, dispatch } = useContext(AppContext);
  const isLite = activeModelId === MODELS.lite;
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef(null);

  const handleModeChange = (e) => {
    const mode = e.target.value;
    if (window.confirm(t('settings.mode_confirm'))) {
      setActiveModel(mode);
      dispatch({ type: 'SET_MODEL_STATUS', status: 'idle', message: t('settings.switched_msg') });
      setShowDropdown(false);
      // Force a tiny delay so the reducer catches up before any automatic re-load triggers
      setTimeout(() => window.location.reload(), 100);
    }
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <nav className="navbar">
      <div className="navbar-brand-container">
        <img src="/logo-round.png" alt="Logo" style={{ height: '32px', width: '32px', objectFit: 'contain' }} />
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
      <div className="navbar-controls" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <div className="perf-toggle-container" ref={dropdownRef}>
          <div className="perf-dropdown-wrapper">
            <div className="perf-trigger" onClick={() => setShowDropdown(!showDropdown)} style={{ cursor: 'pointer' }}>
              <span className="perf-current-title">
                {activeModelId === MODELS.lite ? '⚡' : '🏆'} <span className="perf-label-text">{activeModelId === MODELS.lite ? t('settings.lite_title') : t('settings.pro_title')}</span>
              </span>
            </div>
            <div className="perf-dropdown-menu" style={{ display: showDropdown ? 'block' : '' }}>
              <button
                className={`perf-option ${activeModelId !== MODELS.lite ? 'perf-option--active' : ''}`}
                onClick={() => activeModelId === MODELS.lite ? handleModeChange({ target: { value: 'pro' } }) : setShowDropdown(false)}
              >
                <span className="perf-title">🏆 {t('settings.pro_title')}</span>
                <span className="perf-desc">{t('settings.pro_desc')}</span>
                <span className="perf-vram">{t('settings.pro_vram')}</span>
              </button>
              <button
                className={`perf-option ${activeModelId === MODELS.lite ? 'perf-option--active' : ''}`}
                onClick={() => activeModelId !== MODELS.lite ? handleModeChange({ target: { value: 'lite' } }) : setShowDropdown(false)}
              >
                <span className="perf-title">⚡ {t('settings.lite_title')}</span>
                <span className="perf-desc">{t('settings.lite_desc')}</span>
                <span className="perf-vram">{t('settings.lite_vram')}</span>
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

