import React, { useContext } from 'react';
import { AppContext } from '../App.jsx';
import { t } from '../i18n/index.js';
import LangSwitcher from './LangSwitcher.jsx';

const NAV_ITEMS = [
  { view: 'dashboard', icon: '📊', labelKey: 'nav.dashboard' },
  { view: 'upload',    icon: '📤', labelKey: 'nav.upload'    },
  { view: 'folders',   icon: '📁', labelKey: 'nav.folders'   },
  { view: 'settings',  icon: '⚙️',  labelKey: 'nav.settings'  },
];

export default function NavBar() {
  const { state, dispatch } = useContext(AppContext);

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
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <LangSwitcher variant="compact" />
        <span className="navbar-version">v:{__APP_VERSION__}</span>
      </div>
    </nav>
  );
}

