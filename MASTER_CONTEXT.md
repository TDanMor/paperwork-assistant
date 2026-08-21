# Paperwork Assistant: Master Project Context & Architecture Specification

## 1. Core Vision & Product Goal
Paperwork Assistant is an offline-first, local-first personal document intelligence application. Its mission is to eliminate paperwork anxiety and administrative guesswork by ingesting complex foreign or domestic documents (invoices, tax bills, municipal notices, employment contracts), running local OCR, and using an on-device local engine (Llama-3.2 via WebLLM/WebGPU) combined with high-precision deterministic extractors to produce zero-guesswork actionable intelligence in the user's preferred language.

Live Deployment: [https://paperworkassistant.pages.dev/](https://paperworkassistant.pages.dev/)

---

## 2. Technical Stack & Architecture
- **Frontend**: React 18, Vite, responsive custom CSS with mobile touch and desktop-optimized layouts.
- **Storage Layer**: IndexedDB (`idb`) for local persistence of documents, binary file blobs, OCR text, and user settings.
- **Security & Vault**: Web Crypto API (PBKDF2 with 600,000 iterations + AES-GCM 256-bit) with session-only volatile key caching.
- **Deterministic Harvester (`src/ai/extractor.js`)**: Pure JavaScript parser extracting validated math facts, German institutional IDs (Steuernummer, RV-Nummer, BG-Nummer), legal appeal deadlines (§ 193 BGB weekend shifts & post-2025 4-day delivery fictions), and high-severity threat keywords (*Pfändung*, *Sanktion*, *Vollstreckung*).
- **Inference Engine (`src/ai/engine.js` & `src/ai/prompts.js`)**: Browser-based local inference capped at a `context_window_size: 2048` token limit and MAX_CHARS = 2500 input budget to prevent consumer GPU VRAM exhaustion (`DXGI_ERROR_DEVICE_HUNG`).
- **UI Components (`src/components/`)**:
  - `Dashboard.jsx`: Urgency-grouped task cards and action items.
  - `Upload.jsx`: Queue management and local processing.
  - `FolderView.jsx`: Category and sender-based file organization.
  - `TimelineView.jsx`: Chronological overview mapping paperwork across time (upcoming, current month, past archive).
  - `DocumentDetail.jsx`: Split view with document preview, verified fact metadata, OCR raw inspection, and direct Google Calendar integration.
  - `Settings.jsx` & `NavBar.jsx`: Multi-language selector (EN, DE, ES, FR, RO) and GPU sentinel monitor.

---

## 3. The "Zero Guesswork" Philosophy
- **No Vague Advice**: Responses must never be lazy (e.g., "check the instructions" or "read the notes").
- **Hard Fact Extraction**: Always prioritizes exact monetary sums, verified mathematical proofs (Net + Tax = Gross), corporate headers, due dates, reference codes (Aktenzeichen/Steuernummer), and physical pickup logistics.
- **Immutable Injection**: Verified facts discovered by the deterministic layer are passed as hard constraints to the LLM.

---

## 4. Integrated Integrations: Google Calendar Sync
- **Implementation**: Zero-setup, privacy-first Google Calendar Web URL generation.
- **Workflow**:
  1. User clicks "Add to Calendar" in `DocumentDetail.jsx`.
  2. The app formats a dynamic template URL (`https://calendar.google.com/calendar/render?action=TEMPLATE...`).
  3. Pre-fills event title (`[PAY / ATTEND] Sender`), exact dates, and full summary/action steps into the description field.
  4. Opens in a new browser tab without backend servers, OAuth tokens, or violating the offline-first privacy model.

---

## 5. Expected Output Schema (Strict JSON Contract)
```json
{
  "sender": "Exact corporate or personal name from document header",
  "document_type": "invoice | insurance | government | healthcare | bank | appointment | tax | contract | letter | other",
  "dates": {
    "document_date": "YYYY-MM-DD or null",
    "due_date": "YYYY-MM-DD or null",
    "appointment_date": "YYYY-MM-DD or null"
  },
  "money": {
    "amount": 0.00,
    "currency": "EUR"
  },
  "main_category": "Insurance | Finance | Government | Healthcare | Housing | Employment | Utility | Other",
  "sub_category": "Car | House | Tax | Bank | Visa | University | Internet | Electricity | Water | Other",
  "action_required": "pay | renew | attend | respond | file | none",
  "urgency": "overdue | urgent | upcoming | informational",
  "summary": "Detailed 2-3 information-dense sentences in the target language capturing exact amounts, deadlines, and core requirements.",
  "action_steps": "1. Concrete instruction with exact dates, times, and reference numbers.\n2. Next step if applicable."
}
```