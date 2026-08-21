import React, { useState, useEffect, useContext } from 'react';
import { AppContext } from '../App.jsx';
import { initializeHardware, activeHardwareProfile } from '../ai/engine.js';
import { t } from '../i18n/index.js';

export default function Onboarding({ onFinish }) {
  const { state, dispatch } = useContext(AppContext);
  const [phase, setPhase] = useState('welcome'); // 'welcome' | 'scanning' | 'result'
  
  useEffect(() => {
    if (phase === 'scanning') {
      // Artificial 1.5s delay for UX so the user actually sees the scan happening
      Promise.all([
        initializeHardware(),
        new Promise(r => setTimeout(r, 1500))
      ]).then(() => {
        setPhase('result');
      }).catch(err => {
        console.error('Hardware scan error:', err);
        setPhase('result'); 
      });
    }
  }, [phase]);

  const handleLangChange = (e) => {
    dispatch({ type: 'SET_LANGUAGE', payload: e.target.value });
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'var(--surface)',
      zIndex: 9999,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '2rem',
      textAlign: 'center',
      overflowY: 'auto'
    }}>
      <div style={{
        maxWidth: '550px', width: '100%',
        background: 'var(--bg)',
        padding: '2.5rem',
        borderRadius: '16px',
        boxShadow: 'var(--shadow-xl)',
        border: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', alignItems: 'center'
      }}>
        
        {phase === 'welcome' && (
          <>
            <h1 style={{ fontSize: '1.75rem', marginBottom: '0.5rem', color: 'var(--primary)' }}>
              {t('onboarding.welcome_title')}
            </h1>
            <p className="muted" style={{ marginBottom: '2rem', fontSize: '1rem' }}>
              {t('onboarding.welcome_subtitle')}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', width: '100%', textAlign: 'left', marginBottom: '2rem' }}>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '1.5rem' }}>🔒</span>
                <div>
                  <strong style={{ display: 'block', marginBottom: '0.2rem' }}>{t('onboarding.feat_local_title')}</strong>
                  <span style={{ fontSize: '0.85rem', opacity: 0.8, lineHeight: 1.4, display: 'block' }}>{t('onboarding.feat_local_desc')}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '1.5rem' }}>💾</span>
                <div>
                  <strong style={{ display: 'block', marginBottom: '0.2rem' }}>{t('onboarding.feat_data_title')}</strong>
                  <span style={{ fontSize: '0.85rem', opacity: 0.8, lineHeight: 1.4, display: 'block' }}>{t('onboarding.feat_data_desc')}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '1.5rem' }}>📅</span>
                <div>
                  <strong style={{ display: 'block', marginBottom: '0.2rem' }}>{t('onboarding.feat_sync_title')}</strong>
                  <span style={{ fontSize: '0.85rem', opacity: 0.8, lineHeight: 1.4, display: 'block' }}>{t('onboarding.feat_sync_desc')}</span>
                </div>
              </div>
            </div>

            <div style={{ width: '100%', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem', background: 'rgba(0,0,0,0.03)', borderRadius: '8px' }}>
              <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{t('onboarding.select_language')}:</span>
              <select 
                value={state.language} 
                onChange={handleLangChange}
                style={{ padding: '0.4rem 0.75rem', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface)', fontSize: '0.9rem' }}
              >
                <option value="en">🇬🇧 English</option>
                <option value="de">🇩🇪 Deutsch</option>
                <option value="es">🇪🇸 Español</option>
                <option value="fr">🇫🇷 Français</option>
                <option value="ro">🇷🇴 Română</option>
              </select>
            </div>

            <p style={{ fontSize: '0.8rem', opacity: 0.7, marginBottom: '1rem', lineHeight: 1.5 }}>
              {t('onboarding.scan_notice')}
            </p>

            <button 
              className="btn btn-primary" 
              style={{ width: '100%', padding: '0.8rem', fontSize: '1rem' }}
              onClick={() => setPhase('scanning')}
            >
              {t('onboarding.btn_scan')}
            </button>
          </>
        )}

        {phase === 'scanning' && (
          <div style={{ padding: '2rem 0' }}>
            <div className="spinner" style={{ width: '48px', height: '48px', marginBottom: '1.5rem', borderLeftColor: 'var(--primary)', margin: '0 auto 1.5rem auto' }}></div>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>{t('hardware.scanning_title')}</h2>
            <p className="muted">{t('hardware.scanning_subtitle')}</p>
          </div>
        )}
        
        {phase === 'result' && (
          <div style={{ padding: '1rem 0' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>
              {activeHardwareProfile?.tier === 'NO_LOCAL' ? '⚡' : '✅'}
            </div>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>{t('hardware.scan_complete')}</h2>
            
            <div style={{ background: 'rgba(0,0,0,0.05)', padding: '1rem', borderRadius: '8px', margin: '1.5rem 0', width: '100%', textAlign: 'left' }}>
              <strong style={{ display: 'block', marginBottom: '0.25rem', color: 'var(--primary)', fontSize: '1.1rem' }}>
                {activeHardwareProfile?.tier === 'PRO' ? t('hardware.pro_title') : 
                 activeHardwareProfile?.tier === 'LITE' ? t('hardware.lite_title') : 
                 t('hardware.no_local_title')}
              </strong>
              <p style={{ fontSize: '0.9rem', lineHeight: 1.5 }}>{activeHardwareProfile?.reason}</p>
            </div>

            <button 
              className="btn btn-primary" 
              style={{ width: '100%', padding: '0.8rem', fontSize: '1rem' }}
              onClick={onFinish}
            >
              {t('hardware.continue_btn')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
