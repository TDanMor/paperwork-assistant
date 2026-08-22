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
    // Lite: 1024 tokens keeps VRAM under ~600MB total.
    // Pro:  2048 tokens for full structured output quality.
    context_window_size: isLiteModel ? 1024 : 2048,
    adapterOpts: { powerPreference: "high-performance" }
  };

  // Mobile-specific VRAM safety caps (Lite tier only)
  if (isLiteModel) {
    engineConfig.gpu_memory_utilization = 0.6;   // Reserve 40% VRAM for OS/browser
    engineConfig.max_num_sequence = 1;            // Single sequence — no parallel decoding
    engineConfig.prefill_chunk_size = 256;        // Smaller prefill chunks to avoid spikes
  }

  try {
    engine = await CreateMLCEngine(activeModelId, engineConfig);
    aiActivated = true; 
  } catch (err) {
    console.error("Failed to load model:", err);
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
    console.error("GPU Engine Error:", err);

    const isFatal =
      err.message.includes("disposed") ||
      err.message.includes("lost") ||
      err.message.includes("Device was lost") ||
      err.message.includes("should not be 0");

    if (isFatal) {
      try { await engine.unload(); } catch (e) {}
      resetEngineState();
    }

    throw new Error(isFatal ? "GPU Memory Crashed. The engine is resetting..." : err.message);
  } finally {
    isProcessing = false;
  }
}
