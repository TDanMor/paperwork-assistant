# Paperwork Assistant 📄🤖

**Paperwork Assistant** is a 100% offline-first, local document intelligence application. It is designed to help non-native speakers and the elderly understand complex documents (invoices, government letters, appointments) by providing simple, direct summaries and actionable steps in their preferred language.

## 🚀 Key Features

- **Offline-First AI**: Powered by **WebLLM** (Llama-3.2-3B-Instruct) running directly in your browser. Your documents never leave your computer.
- **Direct Logistics Guide**: Specifically optimized to extract "hard facts" like total amounts, IBANs, exact addresses, and pickup windows.
- **Multilingual Support**: Supports document analysis and translation across **English, German, Spanish, French, and Romanian**.
- **Smart OCR Slicing**: Handles multi-page PDFs and images efficiently by preserving document headers and scanning for high-value logistics "hot zones."
- **Privacy by Design**: No cloud API calls, no data tracking. Fully private document processing using local GPU acceleration (WebGPU).

## 🛠️ Technical Highlights

- **Hardware Resilience**: Optimized to stay within a **2048 token VRAM budget** to prevent GPU driver crashes on consumer hardware.
- **Stable Pipeline**: Implements a strictly sequential processing lock and post-analysis memory purging to ensure system stability during batch uploads.
- **Fuzzy Data Harvesting**: Robust regex-based fallback logic to "rescue" facts even if the AI response is not perfectly formatted.
- **Defensive UI**: React frontend built with resilience to handle varying AI output structures without crashing.

## 💻 Tech Stack

- **Frontend**: React + Vite
- **AI Engine**: WebLLM (MLC AI)
- **OCR**: Tesseract.js
- **Storage**: IndexedDB (Local database)
- **Styling**: Modern CSS / Material Design principles

## 🏁 Getting Started

### Prerequisites
- A browser with **WebGPU** support (e.g., Chrome, Edge, or Brave).
- A computer with a dedicated or integrated GPU (at least 4GB VRAM recommended for smooth performance).

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/TDanMor/paperwork-assistant.git
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```

## 🔒 Safety & Privacy Guarantee

- **Personal Vault**: All sensitive data (Sender, Summary, OCR text) is encrypted at rest using **AES-GCM 256-bit**.
- **PIN Protection**: Access requires a **6-digit PIN** (providing ~1 million combinations).
- **Hardened Key Derivation**: Uses **PBKDF2-HMAC-SHA256** with **600,000 iterations**, making offline brute-force attacks computationally expensive.
- **Session-Based Security**: Encryption keys exist only in volatile RAM and are wiped when the browser tab is closed.
- **Hardware Resilience**: The app includes built-in "Patience Loops" and automatic engine resets to manage GPU memory.

---
Built with ❤️ to make paperwork understandable for everyone.
