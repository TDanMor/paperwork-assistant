import React, { useContext, useEffect } from 'react';
import { AppContext } from '../App.jsx';
import { loadModel } from '../ai/engine.js';
import { t } from '../i18n/index.js';

export default function ModelLoader() {
  const { state, dispatch } = useContext(AppContext);
  const { modelStatus, modelProgress, modelMessage } = state;

  // Automatically start loading if we know it is already cached
  useEffect(() => {
    if (modelStatus === 'idle' && localStorage.getItem('ai_model_cached') === 'true') {
      handleLoad();
    }
  }, [modelStatus]); 

  async function handleLoad() {
    dispatch({ type: 'SET_MODEL_STATUS', status: 'loading', progress: 0, message: 'Starting…' });
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

  if (modelStatus === 'idle') {
    // Prevent the banner from flashing for a split second before auto-loading starts
    if (localStorage.getItem('ai_model_cached') === 'true') {
      return null;
    }

    return (
      <div className="model-banner model-banner--idle">
        <span className="model-banner__text">🤖 {t('model.idle_message')}</span>
        <button className="btn btn-primary btn-sm" onClick={handleLoad}>
          {t('model.load_button')}
        </button>
      </div>
    );
  }

  if (modelStatus === 'loading') {
    // NEW: If the model is already cached, hide the giant banner so it loads silently in the background!
    if (localStorage.getItem('ai_model_cached') === 'true') {
      return null;
    }

    // Only show the giant progress bar the VERY FIRST time they download the 2GB model
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
    return (
      <div className="model-banner model-banner--error">
        <span>⚠️ {t('model.error')}: {modelMessage}</span>
        <button className="btn btn-outline btn-sm" onClick={handleLoad}>Retry</button>
      </div>
    );
  }

  return null; 
}