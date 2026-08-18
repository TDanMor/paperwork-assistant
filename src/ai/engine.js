import { CreateMLCEngine } from "@mlc-ai/web-llm";

export const MODEL_ID = "Llama-3.2-3B-Instruct-q4f16_1-MLC";
export let engine = null;
let aiActivated = false;

export async function loadModel(progressCallback) {
  // If engine exists but was lost/disposed, we need to rebuild it
  if (engine) return;
  
  try {
    engine = await CreateMLCEngine(
      MODEL_ID,
      { 
        initProgressCallback: (report) => {
          if (progressCallback && report && typeof report.progress !== 'undefined') {
            progressCallback(Math.round(report.progress * 100), report.text || '');
          }
        },
        // 🚀 THE GOLDILOCKS ZONE 🚀
        // 2048 tokens allows ~8,000 characters. 
        // This is small enough to completely prevent the GPU "Device Hung" crashes, 
        // but large enough to give the AI plenty of "brainpower" to write detailed steps!
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
  return aiActivated && engine !== null; 
}

// NEW: Allow force resetting the engine from the UI if a crash is detected
export function resetEngineState() {
  engine = null;
  aiActivated = false;
}

export async function chat(systemPrompt, userMessage) {
  if (!engine) throw new Error("Model not loaded");

  try {
    // Safely clear memory between runs
    await engine.resetChat();

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage }
    ];

    const reply = await engine.chat.completions.create({
      messages,
      temperature: 0.1, 
      max_tokens: 500 // Reduced from 800 to save VRAM headroom
    });

    return reply.choices[0].message.content;
  } catch (err) {
    console.error("GPU Engine Error:", err);

    // If the device is lost or object disposed, we MUST reset the engine
    const isFatal = err.message.includes("disposed") || err.message.includes("lost") || err.message.includes("Device was lost");

    if (isFatal) {
      // Attempt clean unload if possible, then nullify
      try { await engine.unload(); } catch (e) {}
      resetEngineState();
    }

    throw new Error(isFatal ? "GPU Memory Crashed. The engine is resetting..." : err.message);
  }
}
