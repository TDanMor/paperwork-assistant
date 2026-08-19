import { CreateMLCEngine } from "@mlc-ai/web-llm";

export const MODEL_ID = "Llama-3.2-3B-Instruct-q4f16_1-MLC";
export let engine = null;
let aiActivated = false;
let isProcessing = false;
let isResetting = false;
let lastTaskResetDone = true; // 🧹 TRACKER: Is the KV cache already clean?

export async function loadModel(progressCallback) {
  if (isResetting || engine) return;
  
  try {
    engine = await CreateMLCEngine(
      MODEL_ID,
      { 
        initProgressCallback: (report) => {
          if (progressCallback && report && typeof report.progress !== 'undefined') {
            progressCallback(Math.round(report.progress * 100), report.text || '');
          }
        },
        context_window_size: 2048
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
      max_tokens: 450
      // 🛡️ REMOVED: response_format: { type: 'json_object' }
      // This causes a Wasm BindingError in some browsers/WebLLM versions.
      // We rely on the system prompt and instruction-following for JSON.
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
