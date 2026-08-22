import React, { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { AppContext } from '../App.jsx';
import { t } from '../i18n/index.js';

export default function GpuGuard() {
  const { state: appState } = useContext(AppContext);
  const [state, setState] = useState({
    loading: true,
    webgl: { available: false, hardwareAccelerated: false },
    webgpu: { available: false, adapterAvailable: false },
    overallStatus: 'checking'
  });

  const [showMenu, setShowMenu] = useState(false);
  const [showPopup, setShowPopup] = useState(false);
  const hasShownPopup = useRef(false);
  const menuRef = useRef(null);

  const checkGpu = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, overallStatus: 'checking' }));
    const webgpu = { available: false, adapterAvailable: false };
    const webgl = { available: false, hardwareAccelerated: false };

    if ('gpu' in navigator) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        webgpu.adapterAvailable = !!adapter;
      } catch (e) {}
    }

    const canvas = document.createElement('canvas');
    let gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (gl) {
      webgl.available = true;
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '';
        webgl.hardwareAccelerated = !/software|llvmpipe|swiftshader/i.test(renderer);
      }
    }

    let overallStatus = 'unavailable';
    if (webgpu.adapterAvailable) overallStatus = 'ready';
    else if (webgl.available && webgl.hardwareAccelerated) overallStatus = 'limited';

    setState({ loading: false, webgl, webgpu, overallStatus });
  }, []);

  useEffect(() => {
    checkGpu();
    const handleVisibility = () => { if (document.visibilityState === 'visible') checkGpu(); };
    document.addEventListener('visibilitychange', handleVisibility);

    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false);
    };
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [checkGpu]);

  const effectiveStatus = appState.modelStatus === 'error' ? 'error' : state.overallStatus;
  const isRed = effectiveStatus === 'error' || effectiveStatus === 'unavailable';
  const displayClass = isRed ? 'unavailable' : effectiveStatus; // map error to red badge

  // Automatically show popup when engine fails/turns red, exactly once per session
  useEffect(() => {
    if (!state.loading && isRed && !hasShownPopup.current) {
      hasShownPopup.current = true;
      setShowPopup(true);
    }
  }, [state.loading, isRed]);

  if (state.loading) return <div className="sentinel-badge sentinel-badge--checking"><span>●</span></div>;

  const isWindows = /Win/i.test(navigator.platform || navigator.userAgentData?.platform || '');
  const hasIssue = effectiveStatus !== 'ready';

  return (
    <>
      <div className="perf-toggle-container" ref={menuRef}>
        <button
          className={`sentinel-badge sentinel-badge--${displayClass}`}
          onClick={() => setShowMenu(!showMenu)}
          title={effectiveStatus === 'error' ? t('gpu.error') : t(`gpu.${effectiveStatus}_title`)}
        >
          <span className="sentinel-dot">●</span>
          <span className="sentinel-label">
            {effectiveStatus === 'ready' ? t('gpu.ready_title').split(' ')[1] : t('gpu.action_required').split(' ')[1]}
          </span>
        </button>

        {showMenu && (
          <div className="perf-dropdown-menu" style={{ display: 'block', width: '280px', padding: '1rem' }}>
            <h3 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {hasIssue ? '⚠️' : '✅'} {effectiveStatus === 'error' ? t('gpu.error') : t(`gpu.${effectiveStatus}_title`)}
            </h3>
            <p className="muted" style={{ fontSize: '0.75rem', marginBottom: '1rem', lineHeight: '1.4' }}>
              {effectiveStatus === 'error' ? appState.modelMessage : t(`gpu.${effectiveStatus}_subtitle`)}
            </p>

            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', padding: '0.5rem', background: 'var(--bg)', borderRadius: '4px' }}>
              <div style={{ fontSize: '0.65rem' }}>
                <strong style={{ display: 'block' }}>{t('gpu.webgpu')}</strong>
                <span style={{ color: state.webgpu.adapterAvailable ? 'var(--c-informational)' : 'var(--c-overdue)' }}>
                  {state.webgpu.adapterAvailable ? t('gpu.available') : t('gpu.unavailable')}
                </span>
              </div>
              <div style={{ fontSize: '0.65rem' }}>
                <strong style={{ display: 'block' }}>{t('gpu.webgl')}</strong>
                <span style={{ color: state.webgl.hardwareAccelerated ? 'var(--c-informational)' : 'var(--c-overdue)' }}>
                  {state.webgl.hardwareAccelerated ? t('gpu.available') : t('gpu.unavailable')}
                </span>
              </div>
            </div>

            {hasIssue && isWindows && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
                <h4 style={{ fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.5rem' }}>⚡ {t('gpu.action_required')}</h4>
                <div style={{ fontSize: '0.7rem', display: 'flex', flexDirection: 'column', gap: '0.3rem', marginBottom: '0.75rem' }}>
                  <div>1. {t('gpu.step_1_desc')}</div>
                  <div>2. {t('gpu.step_2_desc')}</div>
                  <div>3. {t('gpu.step_3_desc')}</div>
                </div>
                <a href="/Deploy-GPU.bat" download className="btn btn-primary btn-sm" style={{ width: '100%', marginBottom: '0.5rem' }}>
                  {t('gpu.download_fix')}
                </a>
              </div>
            )}

            <button onClick={() => { checkGpu(); setShowMenu(false); }} className="btn btn-outline btn-sm" style={{ width: '100%' }}>
              {t('gpu.check_again')}
            </button>
          </div>
        )}
      </div>

      {showPopup && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          zIndex: 99999, display: 'flex', padding: '1rem',
          alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{
            maxWidth: '400px', width: '100%', background: 'var(--bg)',
            borderRadius: '16px', padding: '2rem', textAlign: 'center',
            boxShadow: 'var(--shadow-xl)', border: '1px solid var(--border)'
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem', color: 'var(--c-overdue)' }}>
              {t('gpu.popup_error_title')}
            </h2>
            <p style={{ fontSize: '1rem', lineHeight: '1.5', marginBottom: '1.5rem', color: 'var(--text)' }}>
              {t('gpu.popup_error_desc')}
              <br/><br/>
              <strong>{effectiveStatus === 'error' ? appState.modelMessage : t('gpu.mobile_limitation')}</strong>
            </p>
            <button 
              className="btn btn-primary" 
              style={{ width: '100%', padding: '0.8rem', fontSize: '1rem' }}
              onClick={() => setShowPopup(false)}
            >
              {t('gpu.popup_close')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
