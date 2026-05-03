export interface FilterOptions {
  invert: boolean;
  clearBg: boolean;
  grayscale: boolean;
  blackAndWhite: boolean;
}

export function applyFiltersToCanvas(
  sourceCanvas: HTMLCanvasElement, 
  targetCanvas: HTMLCanvasElement, 
  options: FilterOptions
) {
  const ctx = targetCanvas.getContext('2d');
  const srcCtx = sourceCanvas.getContext('2d');
  
  if (!ctx || !srcCtx) return;

  targetCanvas.width = sourceCanvas.width;
  targetCanvas.height = sourceCanvas.height;
  
  // Draw original image first
  ctx.drawImage(sourceCanvas, 0, 0);
  
  // If no filters, return early
  if (!options.invert && !options.clearBg && !options.grayscale && !options.blackAndWhite) {
    return;
  }

  const imageData = ctx.getImageData(0, 0, targetCanvas.width, targetCanvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    
    // 1. Invert
    if (options.invert) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }
    
    // 2. Clear Background (make light gray/off-white pure white)
    if (options.clearBg) {
      // Simple threshold for "close to white"
      if (r > 200 && g > 200 && b > 200) {
        r = 255;
        g = 255;
        b = 255;
      }
    }
    
    // 3. Grayscale
    if (options.grayscale || options.blackAndWhite) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = gray;
      g = gray;
      b = gray;
      
      // 4. Black & White (Thresholding)
      if (options.blackAndWhite) {
        const threshold = 128; // Simple threshold
        const bw = gray > threshold ? 255 : 0;
        r = bw;
        g = bw;
        b = bw;
      }
    }
    
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }

  ctx.putImageData(imageData, 0, 0);
}
