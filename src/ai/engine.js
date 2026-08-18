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
            progressCallback(Math.round(report.progress * 100));
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
    throw err;
  }
}

export function isModelLoaded() {
  return aiActivated && engine !== null; 
}

export async function chat(systemPrompt, userMessage) {
  if (!engine) throw new Error("Model not loaded");

  // Safely clear memory between runs without causing disposal crashes
  await engine.resetChat();

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

    return reply.choices[0].message.content;
  } catch (err) {
    console.error("GPU Engine Error:", err);
    throw new Error("GPU memory overwhelmed. Please refresh the page to reset the graphics driver.");
  }
}
