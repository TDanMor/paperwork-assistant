// ocr/processor.js — Extracts text from uploaded PDFs and images.
import Tesseract   from 'tesseract.js';
import * as pdfjs  from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { assessClarity } from '../utils/vision.js';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

async function extractFromPDF(file, onProgress) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf         = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  let   fullText    = '';
  let   worstClarityScore = Infinity;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    onProgress?.(Math.round((pageNum / pdf.numPages) * 60));

    const page    = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ').trim();

    if (pageText.length >= 50) {
      fullText += pageText + '\n\n';
    } else {
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas   = document.createElement('canvas');
      canvas.width   = viewport.width;
      canvas.height  = viewport.height;

      await page.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
      }).promise;

      // Clarity check on rendered page
      const clarity = await assessClarity(canvas.toDataURL());
      if (clarity.score < worstClarityScore) worstClarityScore = clarity.score;

      const ocrResult = await Tesseract.recognize(canvas, 'eng+deu', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            onProgress?.(60 + Math.round(m.progress * 35));
          }
        },
      });
      fullText += ocrResult.data.text + '\n\n';
    }
  }

  onProgress?.(100);
  return {
    text: fullText.trim(),
    quality: { score: worstClarityScore === Infinity ? null : worstClarityScore, isBlurry: worstClarityScore < 80 }
  };
}

async function extractFromImage(file, onProgress) {
  const clarity = await assessClarity(file);

  const result = await Tesseract.recognize(file, 'eng+deu', {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        onProgress?.(Math.round(m.progress * 100));
      }
    },
  });

  return {
    text: result.data.text.trim(),
    quality: clarity
  };
}

export async function processFile(file, onProgress) {
  if (file.type === 'application/pdf') {
    return extractFromPDF(file, onProgress);
  } else if (file.type.startsWith('image/')) {
    return extractFromImage(file, onProgress);
  } else {
    throw new Error(`Unsupported file type: ${file.type}`);
  }
}
