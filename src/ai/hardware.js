import { MODELS } from './engine.js';

// V2 invalidates old optimistic profiles
const STORAGE_KEY = 'paperworkAssistant.deviceProfile.v2';
const DETECTOR_VERSION = 2;

export function hasCachedProfile() {
  return !!localStorage.getItem(STORAGE_KEY);
}

export async function detectCapabilityOnce(force = false) {
  // 1. Check cached profile
  if (!force) {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed.detectorVersion === DETECTOR_VERSION) {
          return parsed;
        }
      } catch (e) {
        // Ignore and do fresh detection
      }
    }
  }

  const profile = {
    tier: 'NO_LOCAL',
    model: null,
    webgpuAvailable: false,
    adapterAvailable: false,
    deviceAvailable: false,
    smokeTestPassed: false,
    deviceMemory: navigator.deviceMemory || 4, // Default to 4 if unknown
    failureStage: 'UNKNOWN',
    failureReason: '',
    checkedAt: new Date().toISOString(),
    detectorVersion: DETECTOR_VERSION
  };

  // STAGE 1: WebGPU API available?
  if (!('gpu' in navigator)) {
    profile.failureStage = 'NO_WEBGPU';
    profile.failureReason = 'WebGPU is not available in this browser.';
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    return profile;
  }
  profile.webgpuAvailable = true;

  // STAGE 2: Adapter available?
  let adapter;
  try {
    adapter = await navigator.gpu.requestAdapter();
  } catch (err) {
    console.warn('[PA GPU] Adapter request failed:', err);
  }

  if (!adapter) {
    profile.failureStage = 'NO_ADAPTER';
    profile.failureReason = 'No suitable GPU adapter found.';
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    return profile;
  }
  profile.adapterAvailable = true;

  // STAGE 3: Device available?
  let device;
  try {
    device = await adapter.requestDevice();
  } catch (err) {
    console.warn('[PA GPU] Device request failed:', err);
    profile.failureStage = 'DEVICE_CREATE_FAILED';
    profile.failureReason = 'Failed to create WebGPU device. Driver or hardware limitation.';
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    return profile;
  }
  profile.deviceAvailable = true;

  // STAGE 4: Smoke Test (1KB allocation)
  try {
    const buffer = device.createBuffer({
      size: 1024,
      usage: GPUBufferUsage.STORAGE
    });
    // If it didn't throw and isn't null, it passed the basic test
    buffer.destroy();
    device.destroy();
    profile.smokeTestPassed = true;
  } catch (err) {
    console.warn('[PA GPU] Smoke test failed:', err);
    profile.failureStage = 'GPU_SMOKE_TEST_FAILED';
    profile.failureReason = 'Basic WebGPU memory allocation failed. Driver unstable.';
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    return profile;
  }

  console.log('[PA GPU] Smoke test passed! Evaluating limits for AI.');

  // AI_POTENTIALLY_SUPPORTED
  const limits = adapter.limits || {};
  const maxBufGB = limits.maxStorageBufferBindingSize ? limits.maxStorageBufferBindingSize / (1024 ** 3) : 0;
  
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (profile.deviceMemory < 4) {
    profile.tier = 'NO_LOCAL';
    profile.failureStage = 'INSUFFICIENT_RAM';
    profile.failureReason = 'RAM is too low (<4GB) for safe local processing.';
  } else if (isMobile) {
    profile.tier = 'LITE';
    profile.model = MODELS.lite;
    profile.failureStage = 'AI_POTENTIALLY_SUPPORTED'; // Not a failure, just current state
  } else {
    // Desktop
    if (maxBufGB >= 1.0 && profile.deviceMemory >= 8) {
      profile.tier = 'PRO';
      profile.model = MODELS.pro;
      profile.failureStage = 'AI_POTENTIALLY_SUPPORTED';
    } else {
      profile.tier = 'LITE';
      profile.model = MODELS.lite;
      profile.failureStage = 'AI_POTENTIALLY_SUPPORTED';
    }
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  return profile;
}

export function resetHardwareProfile() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem('pa_model_pref');
}
