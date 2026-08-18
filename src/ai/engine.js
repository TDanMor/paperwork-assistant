import { CreateMLCEngine } from "@mlc-ai/web-llm";

export const MODEL_ID = "Llama-3.2-3B-Instruct-q4f16_1-MLC";
export let engine = null;
let aiActivated = false;
let isProcessing = false;
let isResetting = false; // 🔄 RESET LOCK

export async function loadModel(progressCallback) {
  // If we are currently resetting or already active, don't double-load
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

export async function chat(systemPrompt, userMessage) {
  if (!engine) throw new Error("Model not loaded");
  if (isProcessing) throw new Error("AI is already busy with another document.");

  isProcessing = true; // Engage lock

  try {
    // 🧹 PRE-FLIGHT PURGE: Clear GPU cache before starting
    await engine.resetChat();

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage }
    ];

    const reply = await engine.chat.completions.create({
      messages,
      temperature: 0.1, 
      max_tokens: 500
    });

    const content = reply.choices[0].message.content;

    // 🧹 POST-FLIGHT PURGE: Clear GPU cache immediately after finish
    await engine.resetChat();

    return content;
  } catch (err) {
    console.error("GPU Engine Error:", err);

    const isFatal =
      err.message.includes("disposed") ||
      err.message.includes("lost") ||
      err.message.includes("Device was lost") ||
      err.message.includes("should not be 0");

    if (isFatal) {
      // Attempt clean unload if possible, then nullify
      try { await engine.unload(); } catch (e) {}
      resetEngineState();
    }

    throw new Error(isFatal ? "GPU Memory Crashed. The engine is resetting..." : err.message);
  } finally {
    isProcessing = false; // Always release lock
  }
}
