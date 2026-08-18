import { CreateMLCEngine } from "@mlc-ai/web-llm";

export const MODEL_ID = "Llama-3.2-3B-Instruct-q4f16_1-MLC";
export let engine = null;
let aiActivated = false;

export async function loadModel(progressCallback) {
  if (engine) return;
  
  try {
    engine = await CreateMLCEngine(
      MODEL_ID,
      { 
        initProgressCallback: (report) => {
          if (progressCallback && report && typeof report.progress !== 'undefined') {
            // Multiply by 100 and round off the long decimals! 
            progressCallback(Math.round(report.progress * 100));
          }
        } 
      }, 
      { context_window_size: 2560 }
    );
    aiActivated = true; 
  } catch (err) {
    console.error("Failed to load model:", err);
    throw err;
  }
}

export function isModelLoaded() {
  return aiActivated; 
}

export async function chat(systemPrompt, userMessage) {
  if (!engine && aiActivated) {
    console.log("Waking up AI engine from cache...");
    await loadModel();
  }
  
  if (!engine) throw new Error("Model not loaded");

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage }
  ];

  try {
    const reply = await engine.chat.completions.create({
      messages,
      temperature: 0.1, 
      max_tokens: 800   
    });

    const result = reply.choices[0].message.content;

    await engine.unload();
    engine = null;
    console.log("AI returned to sleep mode. GPU memory freed.");

    return result;
  } catch (err) {
    console.error("GPU Engine Error:", err);
    if (engine) {
      await engine.unload().catch(() => {});
      engine = null;
    }
    throw new Error("GPU crashed during analysis. Engine safely reset.");
  }
}
