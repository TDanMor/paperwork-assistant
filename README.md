# Paperwork Assistant 📄🤖

[![Live Demo](https://img.shields.io/badge/Live%20App-paperworkassistant.pages.dev-blue?style=for-the-badge&logo=cloudflarepages)](https://paperworkassistant.pages.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Privacy: 100% Local](https://img.shields.io/badge/Privacy-100%25%20On--Device-success?style=for-the-badge)](https://paperworkassistant.pages.dev/)

**Paperwork Assistant** is a 100% offline-first, local-first document intelligence web application. It is purpose-built to eliminate paperwork anxiety and administrative guesswork—especially for non-native speakers, expats, and the elderly navigating bureaucratic letters, tax assessments, utility bills, and official notices in Germany and beyond.

🌐 **Live Application**: [https://paperworkassistant.pages.dev/](https://paperworkassistant.pages.dev/)

---

## 🏛️ Core Philosophy: "Deterministic First, AI Second"

Unlike typical AI apps that ask an LLM to guess dates, numbers, and legal consequences, Paperwork Assistant uses a **hybrid deterministic-AI engine**:
1. **Mathematical & Legal Proofs First**: Pure JavaScript and battle-tested regex extract hard truths (IBANs, Steuernummern, RV-Nummern, BG-Nummern, Aktenzeichen, and exact math sums) before any AI model is initialized.
2. **Legal Deadline Math**: Evaluates German administrative appeal rules (§ 193 BGB weekend shifts and post-2025 4-day delivery fictions) deterministically.
3. **Fact Injection**: Injects harvested facts into the on-device LLM as immutable constraints—completely preventing hallucinated deadlines or incorrect amounts.
4. **Human-Centric Summary**: The local LLM is tasked only with explaining the context and concrete action steps in the user's preferred language.

---

## 🚀 Key Features

- 🔒 **100% Private & Offline-First**: Powered by **WebLLM** (Phi-3.5-Mini / Qwen2.5-1.5B running via WebGPU) and local **Tesseract.js** OCR. Your documents, images, and personal data never leave your browser.
- ⏱️ **Deadline & Timeline Tracking**: Dedicated chronological **Timeline & Deadlines** view categorizing upcoming action items, current month tasks, and past archives.
- ⚖️ **Practitioner-Grade German Bureaucracy Support**:
  - Full **Steuernummer** (all 16 Bundesländer + 13-digit standard Bundesschema), **RV-Nummer** (Rentenversicherung), and **BG-Nummer** (Jobcenter) recognition.
  - Automatic **Widerspruch (Appeal)** calculation adhering to official notification fiction rules.
  - Mathematical tax validation supporting standard (19%), reduced (7%), historical (16%, 5%), and tax-exempt (0%) rates.
  - **High-Severity Threat Sentinel**: Flags critical enforcement notices (e.g., *Pfändung*, *Vollstreckungsankündigung*, *Sanktionsbescheid*).
- 🌍 **Multilingual Intelligence**: Full UI and AI translation across **English, German, Spanish, French, and Romanian**.
- 📅 **One-Click Calendar Sync**: Generate zero-setup, privacy-first Google Calendar URLs with pre-filled event titles, due dates, reference codes, and action steps.
- 🔐 **Personal Encryption Vault**: Sensitive documents, summaries, and OCR transcripts are encrypted with **AES-GCM 256-bit** derived via **PBKDF2 (600,000 iterations)** using a 6-digit PIN.
- 📱 **Mobile & Desktop Responsive**: Clean UI with touch optimizations and fixed navigation on mobile.

---

## 🛠️ Technical Architecture & Pipeline

```
[ Upload Image / PDF ]
         │
         ▼
[ Phase 1: Local OCR (Tesseract.js) ]
         │
         ▼
[ Phase 2: Deterministic Harvester (extractor.js) ]
   ├── Mathematical Validation (Net + Tax = Gross)
   ├── ID & Reference Parsers (IBAN, Steuernummer, RV-Nr, BG-Nr)
   ├── Legal Deadline Calculations (§ 193 BGB + Post-2025 Fiction)
   └── Critical Keyword Sentinel (Enforcements / Sanctions)
         │
         ▼
[ Phase 3: Sentence-Heal & Anchor Slicing ]
   └── High-value context reel within 2048-token budget
         │
         ▼
[ Phase 4: Constrained On-Device LLM (WebLLM / prompts.js) ]
   └── Injects Immutable Facts -> Generates Action Plan & Summary
         │
         ▼
[ Phase 5: JSON Hunter & Local Encrypted Storage (IndexedDB) ]
```

---

## 💻 Tech Stack

- **Frontend Framework**: React 18 + Vite
- **Local AI Inference**: [@mlc-ai/web-llm](https://github.com/mlc-ai/web-llm) (Phi-3.5-Mini / Qwen2.5-1.5B via WebGPU)
- **Local OCR**: Tesseract.js
- **Persistence & Storage**: IndexedDB (`idb`) + Web Crypto API (AES-GCM-256)
- **Styling**: Modern CSS with CSS custom properties & mobile-first layout
- **Deployment**: Cloudflare Pages

---

## 🏁 Getting Started

### Prerequisites
- A browser with **WebGPU** support (Google Chrome, Microsoft Edge, Brave, etc.).
- A system with an integrated or dedicated GPU (2GB+ VRAM recommended for 1B Lite; 4GB+ for 3B Pro).

### Local Development

1. **Clone the repository:**
   ```bash
   git clone https://github.com/TDanMor/paperwork-assistant.git
   cd paperwork-assistant
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the local Vite dev server:**
   ```bash
   npm run dev
   ```

4. **Build for production:**
   ```bash
   npm run build
   ```

---

## 🔒 Safety & Privacy Guarantee

- **Zero Cloud Leakage**: No external telemetry, tracking, or cloud OCR/LLM APIs.
- **Client-Side Encryption**: Encrypted in IndexedDB at rest. Keys exist only in non-extractable session RAM and are cleared upon tab close or inactivity timeout.
- **VRAM & Hardware Sentinels**: Automatic hardware detection, VRAM guards, and context slicing to avoid browser GPU timeouts (`DXGI_ERROR_DEVICE_HUNG`).

---

Built with ❤️ to make paperwork transparent, actionable, and accessible to everyone.
