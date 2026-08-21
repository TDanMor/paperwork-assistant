import { MODELS } from './engine.js';

const STORAGE_KEY = 'paperworkAssistant.deviceProfile.v1';

export function hasCachedProfile() {
  return !!localStorage.getItem(STORAGE_KEY);
}

export async function detectCapabilityOnce() {
  // 1. Check cached profile
  const cached = localStorage.getItem(STORAGE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {
      // Ignore and do fresh detection
    }
  }

  // 2. Fresh detection
  if (!('gpu' in navigator)) {
    const profile = {
      tier: 'NO_LOCAL',
      model: null,
      reason: 'WebGPU is not available in this browser. AI will be bypassed.',
      checkedAt: new Date().toISOString()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    return profile;
  }

  let adapter;
  try {
    adapter = await navigator.gpu.requestAdapter();
  } catch (err) {
    // Some browsers throw if WebGPU is disabled by flags
  }

  if (!adapter) {
    const profile = {
      tier: 'NO_LOCAL',
      model: null,
      reason: 'No suitable GPU adapter found for WebGPU.',
      checkedAt: new Date().toISOString()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    return profile;
  }

  const limits = adapter.limits;
  const maxBuf = limits.maxStorageBufferBindingSize || 0; // bytes
  const maxBufGB = maxBuf / (1024 ** 3);
  
  // navigator.deviceMemory is undefined on Safari. Default to 8GB heuristic if missing.
  const deviceMemory = navigator.deviceMemory || 8; 
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  
  let profile;

  // 3. Decide tier & model
  // Note: maxBufGB check is sometimes artificially low on certain browsers. 
  // We use deviceMemory as the primary safety net.
  if (deviceMemory < 4) {
    profile = {
      tier: 'NO_LOCAL',
      model: null,
      reason: 'RAM is too low (<4GB) for safe local AI execution.',
    };
  } else if (isMobile) {
    // Mobile / tablet ALWAYS gets Lite to prevent VRAM crashes.
    profile = {
      tier: 'LITE',
      model: MODELS.lite,
      reason: 'Mobile device detected; using highly optimized Lite model to prevent memory crashes.',
    };
  } else {
    // Desktop / laptop
    if (maxBufGB >= 1.0 && deviceMemory >= 8) {
      profile = {
        tier: 'PRO',
        model: MODELS.pro,
        reason: 'Powerful Desktop GPU and sufficient RAM detected; using PRO local model.',
      };
    } else {
      profile = {
        tier: 'LITE',
        model: MODELS.lite,
        reason: 'Desktop supports WebGPU but with modest limits; using Lite local model.',
      };
    }
  }

  profile.checkedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  return profile;
}

export function resetHardwareProfile() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem('pa_model_pref'); // Also clear any manual overrides
}
