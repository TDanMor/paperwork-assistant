/**
 * Vision Utilities for Photo Quality Assessment
 * Uses Laplacian Variance to detect blurriness.
 */

/**
 * Calculates the variance of the Laplacian of an image to estimate focus.
 * Higher value = sharper image. Lower value = blurrier image.
 * Threshold of ~100 is usually a good cutoff for OCR viability.
 */
export async function assessClarity(source) {
  return new Promise((resolve) => {
    const img = new Image();
    const isBlob = source instanceof Blob;

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // Instead of downscaling (which destroys high-frequency edge details needed for blur detection),
      // we take a 1000x1000 center crop at 1:1 original pixel scale.
      const cropWidth = Math.min(1000, img.width);
      const cropHeight = Math.min(1000, img.height);
      const startX = (img.width - cropWidth) / 2;
      const startY = (img.height - cropHeight) / 2;

      canvas.width = cropWidth;
      canvas.height = cropHeight;

      // Draw only the center portion, with no resizing
      ctx.drawImage(img, startX, startY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const width = imageData.width;
      const height = imageData.height;

      // 1. Grayscale
      const gray = new Float32Array(width * height);
      for (let i = 0; i < data.length; i += 4) {
        gray[i / 4] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }

      // 2. Laplacian filter kernel
      // [ 0,  1, 0 ]
      // [ 1, -4, 1 ]
      // [ 0,  1, 0 ]
      const laplacian = new Float32Array(width * height);
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = y * width + x;
          laplacian[idx] =
            gray[idx - width] +
            gray[idx - 1] - 4 * gray[idx] + gray[idx + 1] +
            gray[idx + width];
        }
      }

      // 3. Calculate Variance
      let sum = 0;
      for (let i = 0; i < laplacian.length; i++) sum += laplacian[i];
      const mean = sum / laplacian.length;

      let varianceSum = 0;
      for (let i = 0; i < laplacian.length; i++) {
        varianceSum += Math.pow(laplacian[i] - mean, 2);
      }
      const score = varianceSum / laplacian.length;

      resolve({
        score: Math.round(score),
        isBlurry: score < 80, // Adjustable threshold
        isLowContrast: score < 30 // Extremely low detail
      });
    };

    if (isBlob) {
      img.src = URL.createObjectURL(source);
    } else {
      // Source might be a canvas or string URL
      img.src = source;
    }
  });
}
