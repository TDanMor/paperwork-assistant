import React, { useContext, useEffect } from 'react';
import { AppContext } from '../App.jsx';
import { loadModel, activeHardwareProfile } from '../ai/engine.js';
import { t } from '../i18n/index.js';

export default function ModelLoader() {
  const { state, dispatch } = useContext(AppContext);
  const { modelStatus, modelProgress, modelMessage } = state;

  useEffect(() => {
    if (modelStatus === 'idle') {
      handleLoad();
    }
  }, [modelStatus]); 

  async function handleLoad() {
    if (modelStatus === 'error') {
      await new Promise(r => setTimeout(r, 2000));
    }

    dispatch({ type: 'SET_MODEL_STATUS', status: 'loading', progress: 0, message: t('model.starting') });
    try {
      await loadModel((pct, msg) => {
        dispatch({ type: 'SET_MODEL_STATUS', status: 'loading', progress: pct, message: msg });
      });
      
      localStorage.setItem('ai_model_cached', 'true');
      dispatch({ type: 'SET_MODEL_STATUS', status: 'ready', progress: 100, message: '' });
    } catch (err) {
      console.error('Model load error:', err);
      dispatch({ type: 'SET_MODEL_STATUS', status: 'error', message: err.message });
    }
  }

  if (modelStatus === 'checking_hardware' || modelStatus === 'ready_deterministic') {
    return null;
  }

  if (modelStatus === 'idle') {
    if (localStorage.getItem('ai_model_cached') === 'true') {
      return null;
    }

    return (
      <div className="model-banner model-banner--idle" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
        {activeHardwareProfile && (
          <div style={{ marginBottom: '0.75rem', background: 'rgba(0,0,0,0.05)', padding: '0.75rem', borderRadius: '8px', width: '100%' }}>
            <strong style={{ display: 'block', marginBottom: '0.2rem', color: 'var(--primary)' }}>
              {activeHardwareProfile.tier === 'PRO' ? t('hardware.pro_title') : t('hardware.lite_title')}
            </strong>
            <span style={{ fontSize: '0.8rem', opacity: 0.9 }}>
              {activeHardwareProfile.reasonKey 
                ? t(`hardware.${activeHardwareProfile.reasonKey}`) 
                : activeHardwareProfile.reason}
            </span>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', width: '100%', justifyContent: 'space-between' }}>
          <span className="model-banner__text">🤖 {t('model.idle_message')}</span>
          <button className="btn btn-primary btn-sm" onClick={handleLoad} style={{ whiteSpace: 'nowrap' }}>
            {t('model.load_button')}
          </button>
        </div>
      </div>
    );
  }

  if (modelStatus === 'loading') {
    if (localStorage.getItem('ai_model_cached') === 'true') {
      return null;
    }

    return (
      <div className="model-banner model-banner--loading">
        <span>{t('model.progress_label')}: {modelProgress}%</span>
        <div className="progress-wrap">
          <div className="progress-bar" style={{ width: `${modelProgress}%` }} />
        </div>
        <span className="model-banner__msg">{modelMessage}</span>
      </div>
    );
  }

  if (modelStatus === 'error') {
    return null;
  }

  return null; 
}