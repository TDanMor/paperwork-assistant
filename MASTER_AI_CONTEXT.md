Paperwork Assistant: Master Project Context & Architecture Specification
1. Core Vision & Product Goal
Paperwork Assistant is an offline-first, local-first personal document intelligence application. Its mission is to eliminate paperwork anxiety and administrative guesswork by ingesting complex foreign or domestic documents (invoices, tax bills, municipal notices), running local OCR, and using an on-device AI model (Llama-3.2-3B-Instruct via WebLLM/WebGPU) to extract zero-guesswork actionable intelligence in the user's preferred language.

2. Technical Stack & Architecture
Frontend: React, Vite, CSS.

Storage Layer: IndexedDB (idb) for local persistence of documents, binary file blobs, and OCR text.

AI Engine (src/ai/engine.js): Browser-based local inference capped at a context_window_size: 2048 token limit and MAX_CHARS = 2500 input budget to prevent consumer GPU VRAM exhaustion (DXGI_ERROR_DEVICE_HUNG crashes).

Prompt & Parser (src/ai/prompts.js): Enforces strict JSON schemas and uses resilient regex extraction with auto-repair for trailing commas.

UI Components (src/components/): Dashboard, Upload Queue, Settings, and DocumentDetail.jsx (featuring defensive type-coercion renderers to prevent React object-rendering crashes).

3. The "Zero Guesswork" AI Philosophy
No Vague Advice: The AI is strictly forbidden from giving lazy responses like "check the instructions" or "read the notes."

Hard Fact Extraction: Must aggressively extract exact monetary amounts, corporate headers, due dates, reference codes, and physical pickup logistics (operating hours, windows, and addresses like Schreiberhauer Straße).

4. Planned & Future Architecture: Google Calendar Sync (Option A)
Goal: Enable users to sync extracted deadlines, due dates, and pickup schedules directly to their calendar so they never miss an action item.

Implementation Strategy: Zero-setup, privacy-first Google Calendar Web URL generation.

Workflow:

User clicks "Add to Calendar" in DocumentDetail.jsx.

The app formats a dynamic web template URL ([https://calendar.google.com/calendar/render?action=TEMPLATE](https://calendar.google.com/calendar/render?action=TEMPLATE)...).

Pre-fills event title ([PAY / ATTEND] Sender), exact dates, and full summary/action steps into the description field.

Opens instantly in a new browser tab without requiring backend servers, OAuth tokens, or violating the offline-first privacy model.

5. Expected AI Output Schema (Strict JSON Contract)
JSON
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