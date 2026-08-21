import React, { useState, useEffect, useContext } from 'react';
import { AppContext } from '../App.jsx';
import { initializeHardware, activeHardwareProfile } from '../ai/engine.js';
import { t } from '../i18n/index.js';

export default function HardwareScanner({ onFinish }) {
  const [phase, setPhase] = useState('scanning'); // 'scanning' | 'result'
  
  useEffect(() => {
    // Artificial 1.5s delay for UX so the user actually sees the scan happening
    Promise.all([
      initializeHardware(),
      new Promise(r => setTimeout(r, 1500))
    ]).then(() => {
      setPhase('result');
    }).catch(err => {
      console.error('Hardware scan error:', err);
      setPhase('result'); // Fallback to result anyway, it'll default to NO_LOCAL in hardware.js
    });
  }, []);

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'var(--surface)',
      zIndex: 9999,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '2rem',
      textAlign: 'center'
    }}>
      <div style={{
        maxWidth: '450px', width: '100%',
        background: 'var(--bg)',
        padding: '2.5rem 2rem',
        borderRadius: '16px',
        boxShadow: 'var(--shadow-xl)',
        border: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', alignItems: 'center'
      }}>
        
        {phase === 'scanning' ? (
          <>
            <div className="spinner" style={{ width: '48px', height: '48px', marginBottom: '1.5rem', borderLeftColor: 'var(--primary)' }}></div>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>{t('hardware.scanning_title')}</h2>
            <p className="muted">{t('hardware.scanning_subtitle')}</p>
          </>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
