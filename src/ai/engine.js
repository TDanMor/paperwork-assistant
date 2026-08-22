import { CreateMLCEngine } from "@mlc-ai/web-llm";
import { detectCapabilityOnce } from './hardware.js';

/* ─── Active Model Definitions ─────────────────────────────────────
 * pro:  Phi-3.5-Mini — Advanced reasoning, strong structured JSON output.
 *       Targets desktops with dedicated GPUs and 8GB+ RAM.
 * lite: Qwen2.5-0.5B — Ultra-stable, tiny VRAM footprint (~300MB).
 *       Purpose-built for phones & tablets where even 1.5B models
 *       can trigger OOM crashes on high-end Snapdragon/Exynos GPUs.
 * ────────────────────────────────────────────────────────────────── */
export const MODELS = {
  pro:  "Phi-3.5-mini-instruct-q4f16_1-MLC",
  lite: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC"
};

/* ─── Legacy Model Constants (Rollback Safety Net) ────────────────
 * Preserved in case the new models exhibit regressions on specific
 * document types. To rollback: swap MODELS values with these.
 * ────────────────────────────────────────────────────────────────── */
export const LEGACY_MODELS = {
  pro:  "Llama-3.2-3B-Instruct-q4f16_1-MLC",
  lite: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC"  // Previous lite model before mobile hardening
};

export let activeModelId = null;
export let activeHardwareProfile = null;
export let engine = null;
let aiActivated = false;
let isProcessing = false;
let isResetting = false;
let lastTaskResetDone = true;

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
const isAndroid = /Android/i.test(navigator.userAgent);

/**
 * Run once on boot to detect capability and assign the correct model.
 */
export async function initializeHardware() {
  activeHardwareProfile = await detectCapabilityOnce();
  const manualPref = localStorage.getItem('pa_model_pref');
  if (manualPref) {
    activeModelId = manualPref;
  } else {
    activeModelId = activeHardwareProfile.model;
  }
}

export function setActiveModel(mode) {
  const newId = MODELS[mode] || MODELS.pro;
  if (activeModelId !== newId) {
    activeModelId = newId;
    localStorage.setItem('pa_model_pref', newId);
    resetEngineState(); // Force reload on next use
  }
}

export async function loadModel(progressCallback) {
  if (isResetting || engine) return;
  
  if (activeHardwareProfile && activeHardwareProfile.tier === 'NO_LOCAL') {
    // Bypass engine creation entirely
    aiActivated = false;
    return;
  }

  /* ─── Tier-Aware Engine Configuration ──────────────────────────
   * Lite (Qwen-0.5B on phones): Aggressively cap VRAM and context
   *   to prevent OOM crashes on mobile WebGPU runtimes.
   * Pro (Phi-3.5 on desktops): Full performance, larger context.
   * ────────────────────────────────────────────────────────────── */
  const isLiteModel = (activeModelId === MODELS.lite);

  const engineConfig = {
    initProgressCallback: (report) => {
      if (progressCallback && report && typeof report.progress !== 'undefined') {
        progressCallback(Math.round(report.progress * 100), report.text || '');
      }
    },
    // Lite: 1024 tokens (768 on Android) keeps VRAM under ~600MB total.
    context_window_size: isLiteModel ? (isAndroid ? 768 : 1024) : 2048,
    // 🛡️ Master Brain V5.4: Reduce sequence length to cap initial WASM memory allocation
    max_total_sequence_length: isLiteModel ? (isAndroid ? 768 : 1024) : 2048,
    adapterOpts: { powerPreference: "high-performance" }
  };

  // Mobile-specific VRAM safety caps (Lite tier only)
  if (isLiteModel) {
    engineConfig.gpu_memory_utilization = isAndroid ? 0.4 : 0.6; // Even more conservative on Android
    engineConfig.max_num_sequence = 1;            // Single sequence — no parallel decoding
    engineConfig.prefill_chunk_size = isAndroid ? 128 : 256; // Smaller prefill chunks to avoid spikes
  }

  try {
    engine = await CreateMLCEngine(activeModelId, engineConfig);
    aiActivated = true; 
  } catch (err) {
    console.error("Primary GPU Load Failed:", {
      error: err.message,
      model: activeModelId,
      config: engineConfig
    });

    // 🛡️ Master Brain V5.4: Android/Mobile Resilience - Retry with low-power adapter
    if (isMobile) {
      try {
        console.warn("Retrying with low-power adapter...");
        engineConfig.adapterOpts.powerPreference = "low-power";
        if (isAndroid) engineConfig.context_window_size = 512; // Absolute minimum

        engine = await CreateMLCEngine(activeModelId, engineConfig);
        aiActivated = true;
        return;
      } catch (retryErr) {
        console.error("Critical Engine Failure (Fallback also failed):", retryErr);
      }
    }

    engine = null;
    aiActivated = false;
    throw err;
  }
}

export function isModelLoaded() {
  return aiActivated && engine !== null && !isResetting;
}

export function isEngineResetting() {
  return isResetting;
}

export async function resetEngineState() {
  if (isResetting) return;
  isResetting = true;

  try {
    if (engine) {
      await engine.unload();
    }
  } catch (e) {
    console.warn("Clean unload failed, forcing nullify.");
  } finally {
    engine = null;
    aiActivated = false;
    isProcessing = false;
    isResetting = false;
  }
}

/**
 * Returns the token count for a given text.
 */
export async function getTokenCount(text) {
  if (!isModelLoaded() || typeof engine.tokenize !== 'function') {
    // 🛡️ Fallback if engine isn't ready or doesn't support tokenize
    return Math.ceil(text.length / 3.2);
  }
  try {
    const tokens = await engine.tokenize(text);
    return tokens.length;
  } catch (e) {
    console.warn("Tokenization failed:", e);
    return Math.ceil(text.length / 3.2);
  }
}

export async function chat(systemPrompt, userMessage) {
  if (activeHardwareProfile && activeHardwareProfile.tier === 'NO_LOCAL') {
    // Return empty string to force deterministic fallback in prompts.js
    return "";
  }
  
  if (!engine) throw new Error("Model not loaded");
  if (isProcessing) throw new Error("AI is already busy with another document.");

  isProcessing = true;

  try {
    // 🧹 Purge on entry ONLY if the previous run didn't finish its cleanup
    if (!lastTaskResetDone) {
      await engine.resetChat();
    }

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage }
    ];

    const reply = await engine.chat.completions.create({
      messages,
      temperature: 0.1, 
      max_tokens: 250 // Reduced further for maximum safety
    });

    const content = reply.choices[0].message.content;

    // 🧹 Mandatory purge after run to keep VRAM clean
    await engine.resetChat();
    lastTaskResetDone = true;

    return content;
  } catch (err) {
    lastTaskResetDone = false; // Flag as dirty on error
    console.error("GPU Inference Error:", {
      message: err.message,
      stack: err.stack,
      model: activeModelId
    });

    const isFatal =
      err.message.includes("disposed") ||
      err.message.includes("lost") ||
      err.message.includes("Device was lost") ||
      err.message.includes("should not be 0") ||
      err.message.includes("Buffer length exceeded") ||
      err.message.includes("Out of memory");

    if (isFatal) {
      try { await engine.unload(); } catch (e) {}
      resetEngineState();
    }

    throw new Error(isFatal ? "GPU Memory Crashed. The engine is resetting..." : err.message);
  } finally {
    isProcessing = false;
  }
}
