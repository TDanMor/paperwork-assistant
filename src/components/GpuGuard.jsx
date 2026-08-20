import React, { useState, useEffect, useCallback, useRef } from 'react';
import { t } from '../i18n/index.js';

export default function GpuGuard() {
  const [state, setState] = useState({
    loading: true,
    webgl: { available: false, hardwareAccelerated: false },
    webgpu: { available: false, adapterAvailable: false },
    overallStatus: 'checking'
  });

  const [showMenu, setShowMenu] = useState(false);
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

  if (state.loading) return <div className="sentinel-badge sentinel-badge--checking"><span>●</span></div>;

  const isWindows = /Win/i.test(navigator.platform || navigator.userAgentData?.platform || '');
  const hasIssue = state.overallStatus !== 'ready';

  return (
    <div className="perf-toggle-container" ref={menuRef}>
      <button
        className={`sentinel-badge sentinel-badge--${state.overallStatus}`}
        onClick={() => setShowMenu(!showMenu)}
        title={t(`gpu.${state.overallStatus}_title`)}
      >
        <span className="sentinel-dot">●</span>
        <span className="sentinel-label">
          {state.overallStatus === 'ready' ? t('gpu.ready_title').split(' ')[1] : t('gpu.action_required').split(' ')[1]}
        </span>
      </button>

      {showMenu && (
        <div className="perf-dropdown-menu" style={{ display: 'block', width: '280px', padding: '1rem' }}>
          <h3 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {hasIssue ? '⚠️' : '✅'} {t(`gpu.${state.overallStatus}_title`)}
          </h3>
          <p className="muted" style={{ fontSize: '0.75rem', marginBottom: '1rem', lineHeight: '1.4' }}>
             {t(`gpu.${state.overallStatus}_subtitle`)}
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
  );
}
