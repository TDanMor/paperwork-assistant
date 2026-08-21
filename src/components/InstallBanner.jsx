import React, { useState, useEffect } from 'react';
import { t } from '../i18n/index.js';

export default function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [dismissed, setDismissed] = useState(localStorage.getItem('pwa_prompt_dismissed') === 'true');

  useEffect(() => {
    // Check if running as PWA
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
      setIsStandalone(true);
      return;
    }

    const ua = window.navigator.userAgent;
    const isIOSDevice = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    if (isIOSDevice) {
      setIsIOS(true);
    }

    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  if (isStandalone || dismissed || (!deferredPrompt && !isIOS)) return null;

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem('pwa_prompt_dismissed', 'true');
  };

  return (
    <div className="install-banner">
      <div className="install-banner-content">
        <img src="/logo-round.png" alt="App Icon" style={{ width: '32px', height: '32px' }} />
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
          <strong style={{ fontSize: '0.9rem' }}>{t('install.title')}</strong>
          <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>
            {isIOS ? t('install.desc_ios') : t('install.desc_android')}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {!isIOS && <button onClick={handleInstallClick} className="btn btn-primary btn-sm" style={{ padding: '0.3rem 0.75rem', minHeight: 'auto' }}>{t('install.btn')}</button>}
        <button onClick={handleDismiss} className="btn btn-sm" style={{ padding: '0.3rem 0.5rem', background: 'transparent', minHeight: 'auto', border: '1px solid var(--border)' }}>✕</button>
      </div>
    </div>
  );
}
