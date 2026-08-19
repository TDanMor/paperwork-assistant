import React, { useState, useEffect, useCallback } from 'react';
import { t } from '../i18n/index.js';

export default function GpuGuard() {
  const [state, setState] = useState({
    loading: true,
    webgl: {
      available: false,
      hardwareAccelerated: false,
      rendererClass: 'unknown'
    },
    webgpu: {
      available: false,
      adapterAvailable: false
    },
    overallStatus: 'checking'
  });

  const checkGpu = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, overallStatus: 'checking' }));

    const webgpu = { available: false, adapterAvailable: false };
    const webgl = { available: false, hardwareAccelerated: false, rendererClass: 'unknown' };

    // 1. WebGPU Detection
    if ('gpu' in navigator) {
      webgpu.available = true;
      try {
        const adapter = await navigator.gpu.requestAdapter();
        webgpu.adapterAvailable = !!adapter;
      } catch (e) {
        webgpu.adapterAvailable = false;
      }
    }

    // 2. WebGL Detection
    const canvas = document.createElement('canvas');
    let gl = canvas.getContext('webgl2') || canvas.getContext('webgl');

    if (gl) {
      webgl.available = true;
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '';
        const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || '';

        // Software renderer detection heuristics
        const isSoftware = /software|llvmpipe|google swiftshader|mesa/i.test(renderer) || /microsoft/i.test(vendor);
        webgl.hardwareAccelerated = !isSoftware;
        webgl.rendererClass = isSoftware ? 'software' : 'hardware';
      }
    }

    // 3. Overall Status Logic
    let overallStatus = 'unavailable';
    if (webgpu.adapterAvailable) {
      overallStatus = 'ready';
    } else if (webgl.available && webgl.hardwareAccelerated) {
      overallStatus = 'limited';
    }

    setState({
      loading: false,
      webgl,
      webgpu,
      overallStatus
    });
  }, []);

  useEffect(() => {
    checkGpu();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkGpu();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [checkGpu]);

  const isWindows = /Win/i.test(navigator.platform || navigator.userAgentData?.platform || '');

  if (state.loading) {
    return (
      <div style={{ minHeight: '42px', display: 'flex', alignItems: 'center', marginBottom: '1.5rem' }}>
        <p className="muted" style={{ fontSize: '0.85rem' }}>{t('gpu.checking')}</p>
      </div>
    );
  }

  if (state.overallStatus === 'ready') {
    return (
      <div className="gpu-badge gpu-badge--ready" style={{ marginBottom: '1.5rem' }}>
        <span className="gpu-dot"></span>
        <span style={{ fontWeight: 600 }}>{t('gpu.ready_title')}</span>
        <span className="gpu-separator">·</span>
        <span className="muted" style={{ fontSize: '0.85rem' }}>{t('gpu.ready_subtitle')}</span>
      </div>
    );
  }

  return (
    <div
      className={`gpu-banner gpu-banner--${state.overallStatus}`}
      style={{ marginBottom: '1.5rem', padding: '1rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--surface)', boxShadow: 'var(--shadow-sm)' }}
    >
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
        <span style={{ fontSize: '1.5rem' }}>{state.overallStatus === 'limited' ? '⚠️' : '❌'}</span>
        <div style={{ flex: 1 }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.25rem' }}>
            {state.overallStatus === 'limited' ? t('gpu.limited_title') : t('gpu.unavailable_title')}
          </h3>
          <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
            {state.overallStatus === 'limited' ? t('gpu.limited_subtitle') : t('gpu.unavailable_subtitle')}
          </p>

          <div style={{ display: 'flex', gap: '2rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '0.75rem' }}>
              <strong style={{ display: 'block' }}>{t('gpu.webgpu')}</strong>
              <span style={{ color: state.webgpu.adapterAvailable ? 'var(--c-informational)' : 'var(--c-overdue)' }}>
                {state.webgpu.adapterAvailable ? t('gpu.available') : t('gpu.unavailable')}
              </span>
            </div>
            <div style={{ fontSize: '0.75rem' }}>
              <strong style={{ display: 'block' }}>{t('gpu.webgl')}</strong>
              <span style={{ color: state.webgl.hardwareAccelerated ? 'var(--c-informational)' : 'var(--c-overdue)' }}>
                {state.webgl.hardwareAccelerated ? t('gpu.hardware_accelerated') : t('gpu.software_rendering')}
              </span>
            </div>
          </div>

          {isWindows ? (
            <div className="gpu-recovery" style={{ background: 'var(--bg)', padding: '1rem', borderRadius: 'var(--radius-sm)' }}>
              <h4 style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.75rem' }}>⚡ {t('gpu.action_required')}</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.8rem', marginBottom: '1rem' }}>
                <div><strong>{t('gpu.step_1')}:</strong> {t('gpu.step_1_desc')}</div>
                <div><strong>{t('gpu.step_2')}:</strong> {t('gpu.step_2_desc')}</div>
                <div><strong>{t('gpu.step_3')}:</strong> {t('gpu.step_3_desc')}</div>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <a href="/Deploy-GPU.bat" download className="btn btn-primary btn-sm">
                  {t('gpu.download_fix')}
                </a>
                <button onClick={checkGpu} className="btn btn-outline btn-sm">
                  {t('gpu.check_again')}
                </button>
              </div>
            </div>
          ) : (
            <div>
               <p style={{ fontSize: '0.8rem', color: 'var(--c-urgent)' }}>{t('gpu.mobile_limitation')}</p>
               <button onClick={checkGpu} className="btn btn-outline btn-sm" style={{ marginTop: '0.75rem' }}>
                  {t('gpu.check_again')}
                </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
