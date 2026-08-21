# 🤵 Paperwork Assistant: Hybrid Deterministic-AI Engine (Master Brain V5.0 - Practitioner Grade)

This document defines the high-level architecture of the document classification, legal parsing, and analysis pipeline. Any AI model or agent interacting with this codebase must adhere to these principles to maintain 100% data reliability, legal accuracy, and privacy.

---

## 🏛️ Core Philosophy: "Deterministic First, AI Second"
Most AI applications "ask" an LLM to find numbers and dates. This app **"tells"** the AI what data it found. We use JavaScript for **Reliability & Legal Proofs** (The Skeleton) and the LLM for **Narrative Intelligence** (The Flesh).

### 1. Zero-Hallucination Guardrails
- **Hard Truths**: IBANs, Amounts, Tax Rates, Reference IDs (Steuernummer, RV-Nummer, BG-Nummer, Aktenzeichen), and calculated legal deadlines are extracted via pure JS/Regex before the LLM is initialized.
- **Fact Injection**: These "Hard Truths" are injected into the AI's System Prompt (`src/ai/prompts.js`) as immutable constants.
- **The Absolute Command**: The AI is strictly forbidden from inventing, estimating, or contradicting these verified facts.

---

## ⚙️ The 5-Phase Analysis Pipeline

```
[ Local File (PDF / Image) ]
         │
         ▼
[ Phase 1: Local OCR Engine ] ──► Tesseract.js (Web Worker)
         │
         ▼
[ Phase 2: Deterministic Harvester ] ──► src/ai/extractor.js
   ├── Mathematical Validation (Net + Tax = Gross; 19%, 7%, 16%, 5%, 0%)
   ├── German Reference ID Parsing (Steuernummer, RV-Nummer, BG-Nummer, IBAN)
   ├── Administrative Legal Calculations (Widerspruch: Post-2025 4-day fiction + § 193 BGB weekend shift)
   ├── Threat & Enforcement Sentinel (Pfändung, Mahnung, Sanktion, Vollstreckung)
   └── Direct Debit Sentinel (Lastschrift immunity)
         │
         ▼
[ Phase 3: Sentence-Heal & Anchor Slicing ] ──► Context Optimizer (2048-token ceiling)
   ├── Letterhead & Header Preservation (1000 chars)
   ├── Surrounding Sentence Recovery for Verified Facts
   └── Footer/Payment Details (500 chars)
         │
         ▼
[ Phase 4: Constrained Narrative Inference ] ──► src/ai/prompts.js + WebLLM
   ├── Dynamic Tone Override (Urgent/Severe tone for Critical Enforcement Notices)
   └── Human-Centric Action Guide in User's Target Language (EN, DE, ES, FR, RO)
         │
         ▼
[ Phase 5: Resilient Rescue & Encrypted Storage ]
   ├── JSON-Hunter & deepCleanRescue Regex Fallback
   └── AES-GCM 256-bit Encrypted Vault (IndexedDB)
```

### Phase 1: Local OCR (Raw Harvest)
- **Tool**: Tesseract.js running in a dedicated local Web Worker thread.
- **Process**: Converts Image/PDF pixels into a raw text stream without network communication.

### Phase 2: Deterministic Harvester (`src/ai/extractor.js`)
- **Mathematical Tax Verification**: Scans for triplets of numbers where `Net + Tax = Gross` across standard (19%), reduced (7%), historical crisis rates (16%, 5%), and medical/tax-exempt (0%) exemptions.
- **German Institutional Identifiers**:
  - **Steuernummer**: Full support for all 16 Bundesländer formats (e.g., 3/4/4) and standard 13-digit Bundesschema.
  - **RV-Nummer**: 12-character Rentenversicherung pattern (2 digits, 6 birth digits, 1 letter, 3 digits).
  - **BG-Nummer**: Jobcenter / Bürgergeld Bedarfsgemeinschaft identifiers.
  - **IBAN & Reference Codes**: High-precision regex with letterhead proximity scoring.
- **Legal Deadline Calculations (`calculateWiderspruchDeadline`)**:
  - **Delivery Fiction**: If document date is $\ge$ 2025-01-01, applies the updated **4-day delivery fiction** (previously 3 days) + 1 month.
  - **§ 193 BGB Weekend Shift**: If the final calculated date falls on a Saturday or Sunday, it deterministically shifts forward to the next business Monday.
- **High-Severity Action Sentinel**: Scans for critical keywords (*Pfändungs- und Überweisungsbeschluss*, *Sanktion*, *Vollstreckung*, *Fahrverbot*) and sets `critical_action: true`.

### Phase 3: Context Sentinel (Anchor-Slicing)
- **VRAM Budget Compliance**: To guarantee safety across consumer GPUs and mobile WebGPU runtimes within a **2048-token context window**, we do NOT send raw full-text documents.
- **Sentence-Heal**: The engine identifies exact byte indices of verified facts and extracts complete, coherent surrounding sentences.
- **The "Highlights Reel"**: AI receives the Header (first 1000 chars) + Verified Fact Sentences + Document Footer (last 500 chars), capped at ~3000 chars.

### Phase 4: Restricted Narrative Inference (`src/ai/prompts.js`)
- **Engine**: WebLLM running Llama-3.2 (1B Lite / 3B Pro).
- **Role**: A seasoned bilingual administrative clerk explaining a briefing.
- **Critical Alert Override**: If `critical_action` is flagged, the prompt enforces a serious, urgent tone and explicitly mandates naming the specific legal threat in the first sentence.
- **Strict JSON Contract**: Forces structured output for UI hydration.

### Phase 5: Resilient Rescue & Sync
- **The Parser**: `parseAIResponse` executes regex JSON hunting across response boundaries.
- **The Rescue**: If the LLM generates conversational text or trailing garbage, `deepCleanRescue` strips markdown tags, backticks, and reconstructs the narrative fields.
- **Local Vault**: Data is stored securely in IndexedDB with optional AES-GCM 256-bit PIN encryption.

---

## 🏁 Golden Rules for Collaborators & Future Changes

1. **Never delegate factual extraction to the LLM**: Dates, numbers, currencies, and IDs belong in `extractor.js`.
2. **Preserve VRAM bounds**: Keep prompt context under 2500 characters / 2048 tokens to prevent `DXGI_ERROR_DEVICE_HUNG` crashes.
3. **Synchronize i18n**: Whenever a new category, status, or UI view is introduced, update all translation files (`en.json`, `de.json`, `es.json`, `fr.json`, `ro.json`).

**Goal**: 100% mathematical certainty under the hood; 100% clear, empathetic guidance on the surface.
