# 🤵 Paperwork Assistant: Hybrid Deterministic-AI Engine (Master Brain V4.1)

This document defines the high-level architecture of the document classification and analysis pipeline. Any AI model or agent interacting with this codebase must adhere to these principles to maintain 100% data reliability and privacy.

---

## 🏛️ Core Philosophy: "Deterministic First, AI Second"
Most AI applications "ask" the AI to find data. This app **"tells"** the AI what data it found. We use JavaScript for **Reliability** (The Skeleton) and the LLM for **Narrative Intelligence** (The Flesh).

### 1. Zero-Hallucination Guardrails
- **Hard Truths**: IBANs, Amounts, Dates, and Reference IDs are extracted via pure JS/Regex before the AI is initialized.
- **Fact Injection**: These "Hard Truths" are injected into the AI's System Prompt as immutable constants.
- **The Command**: The AI is strictly forbidden from contradicting these facts.

---

## ⚙️ The 5-Phase Analysis Pipeline

### Phase 1: Local OCR (Raw Harvest)
- **Tool**: Tesseract.js (Local Browser Thread).
- **Process**: Converts Image/PDF pixels into a raw string.
- **Output**: A potentially noisy raw text string.

### Phase 2: Deterministic Harvester (`src/ai/extractor.js`)
- **Mathematical Validation**: Scans for triplets of numbers where `Net + Tax (7%/19%) = Gross` to verify invoices.
- **Sender Scoring Engine**: Uses a global frequency counter + "Letterhead Bonus" (matches in the first 1000 chars get 10x points) + "URL Immunity" (ignores matches inside web links).
- **Legal Scanners**: Detects document stages (`Bescheid`, `Mahnung`, `Kündigung`) and calculates the **Widerspruch (Appeal)** deadline using the German 3-day delivery fiction rule (+3 days + 1 month).
- **Direct Debit Sentinel**: Scans for `Lastschrift` keywords to prevent the system from demanding payment for automated bills.

### Phase 3: Context Sentinel (Anchor-Slicing)
- **Optimization**: To fit within the 2048-token limits of 1B mobile models, we do NOT send the whole document.
- **Sentence-Heal**: The engine identifies the exact indices of discovered facts and "cuts out" the **full surrounding sentences**.
- **The "Highlights Reel"**: AI receives the Header (1000 chars) + The Fact Sentences + The Footer (500 chars). Total context is capped at ~3000 chars.

### Phase 4: Restricted Narrative Inference (`src/ai/prompts.js`)
- **Model**: Llama-3.2 (1B Lite / 3B Pro).
- **Role**: A "Professional Clerk" explaining a briefing.
- **Input**: The Fact JSON + The Context Sentences.
- **Instruction**: "Explain the WHY using the snippets, but respect the HOW MUCH found by the extractor."

### Phase 5: Resilient Rescue & Sync
- **The Parser**: `parseAIResponse` uses an aggressive "JSON-Hunter" (finding the outermost `{}`).
- **The Rescue**: If the AI returns plain text instead of JSON, the `deepCleanRescue` function surgically removes technical noise, XML tags, and prefixes to rescue the human narrative.
- **Local Vault**: Data is encrypted via AES-GCM (Browser Crypto API) and saved to IndexedDB.

---

## 🏁 Summary for Collaborating AIs
When modifying the engine:
1. **Never** move a "Hard Fact" (Amount/IBAN/Date) from `extractor.js` into the AI prompt for "discovery."
2. **Always** update `extractor.js` logic if a specific document type is being misidentified.
3. **Ensure** that any new category or state added to the logic is also reflected in the `i18n` JSON files to prevent technical leakage in the UI.

**Goal**: Keep the UI data 100% mathematical and the summary 100% human.
