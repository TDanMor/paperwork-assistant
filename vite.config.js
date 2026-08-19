import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';

const gitHash = execSync('git rev-parse --short HEAD').toString().trim();

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(gitHash),
  },
  server: {
    headers: {
      // WebLLM needs SharedArrayBuffer for parallel model downloading.
      // These two headers are required to enable it in modern browsers.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  optimizeDeps: {
    // WebLLM loads itself and model weights dynamically at runtime.
    // Telling Vite NOT to pre-bundle it prevents build-time crashes.
    exclude: ['@mlc-ai/web-llm'],
  },
});