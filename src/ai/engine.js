import { CreateMLCEngine } from "@mlc-ai/web-llm";

export const MODELS = {
  pro: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
  lite: "Llama-3.2-1B-Instruct-q4f16_1-MLC"
};

// Default to pro, but can be changed by UI
export let activeModelId = localStorage.getItem('pa_model_pref') || MODELS.pro;
export let engine = null;
let aiActivated = false;
let isProcessing = false;
let isResetting = false;
let lastTaskResetDone = true;

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
  
  try {
    engine = await CreateMLCEngine(
      activeModelId,
      { 
        initProgressCallback: (report) => {
          if (progressCallback && report && typeof report.progress !== 'undefined') {
            progressCallback(Math.round(report.progress * 100), report.text || '');
          }
        },
        context_window_size: 2048,
        adapterOpts: { powerPreference: "high-performance" }
      }
    );
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
