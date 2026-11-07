import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DOMMatrix, ImageData, Path2D, createCanvas } from '@napi-rs/canvas';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { FileHandlingError } from '../files/errors.js';
import { cleanupFile } from '../files/paths.js';
import { PdfDeadline, savePdfFile } from './common.js';

const globalScope = globalThis as typeof globalThis & {
  DOMMatrix?: typeof DOMMatrix;
  ImageData?: typeof ImageData;
  Path2D?: typeof Path2D;
};
globalScope.DOMMatrix ??= DOMMatrix;
globalScope.ImageData ??= ImageData;
globalScope.Path2D ??= Path2D;

sharp.cache(false);
sharp.concurrency(1);

export type RasterFilter = 'gray' | 'bw' | 'invert' | 'clear';
export type RasterQuality = 'low' | 'medium' | 'high';
export type BwThreshold = 'light' | 'balanced' | 'strong';
export type ClearLevel = 'low' | 'medium' | 'high';

export interface RasterSettings {
  filter: RasterFilter;
  quality: RasterQuality;
  threshold?: BwThreshold | undefined;
  clearLevel?: ClearLevel | undefined;
}

export interface RasterOptions extends RasterSettings {
  maxPages: number;
  maxPixelsPerPage: number;
  maxOutputBytes: number;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
  onProgress?: ((done: number, total: number) => void) | undefined;
}

export interface RasterResult {
  pages: number;
  outputBytes: number;
  dpi: number;
}

export interface ProcessedImage {
  data: Buffer;
  format: 'jpeg' | 'png';
  width: number;
  height: number;
}

export const DPI_PRESETS: Record<RasterQuality, number> = {
  low: 100,
  medium: 150,
  high: 200,
};

export const RASTER_PAGE_LIMITS: Record<RasterQuality, number> = {
  low: 30,
  medium: 20,
  high: 12,
};

export const BW_PAGE_LIMITS: Record<RasterQuality, number> = {
  low: 20,
  medium: 12,
  high: 8,
};

export function rasterPageLimit(
  filter: RasterFilter,
  quality: RasterQuality,
  configuredMax: number,
): number {
  const qualityLimit = filter === 'bw' ? BW_PAGE_LIMITS[quality] : RASTER_PAGE_LIMITS[quality];
  return Math.min(configuredMax, qualityLimit);
}

export const JPEG_QUALITY: Record<RasterQuality, number> = {
  low: 0.62,
  medium: 0.8,
  high: 0.9,
};

export const BW_THRESHOLDS: Record<BwThreshold, number> = {
  light: 105,
  balanced: 128,
  strong: 160,
};

export const CLEAR_THRESHOLDS: Record<ClearLevel, number> = {
  low: 235,
  medium: 215,
  high: 195,
};

const requireFromHere = createRequire(import.meta.url);
const PDFJS_ROOT = dirname(requireFromHere.resolve('pdfjs-dist/package.json'));
const STANDARD_FONTS = `${pathToFileURL(join(PDFJS_ROOT, 'standard_fonts')).href}/`;
const CMAPS = `${pathToFileURL(join(PDFJS_ROOT, 'cmaps')).href}/`;
const WASM = `${pathToFileURL(join(PDFJS_ROOT, 'wasm')).href}/`;

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsPromise: Promise<PdfjsModule> | undefined;

function getPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.min.mjs');
  return pdfjsPromise;
}

export async function applyRasterFilter(
  input: Buffer,
  settings: RasterSettings,
): Promise<ProcessedImage> {
  const quality = Math.round(JPEG_QUALITY[settings.quality] * 100);

  if (settings.filter === 'gray') {
    const output = await sharp(input)
      .flatten({ background: '#ffffff' })
      .grayscale()
      .jpeg({ quality })
      .toBuffer({ resolveWithObject: true });
    return {
      data: output.data,
      format: 'jpeg',
      width: output.info.width,
      height: output.info.height,
    };
  }

  if (settings.filter === 'invert') {
    const output = await sharp(input)
      .flatten({ background: '#ffffff' })
      .negate({ alpha: false })
      .jpeg({ quality })
      .toBuffer({ resolveWithObject: true });
    return {
      data: output.data,
      format: 'jpeg',
      width: output.info.width,
      height: output.info.height,
    };
  }

  if (settings.filter === 'clear') {
    const threshold = CLEAR_THRESHOLDS[settings.clearLevel ?? 'medium'];
    const raw = await sharp(input)
      .flatten({ background: '#ffffff' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels = raw.data;
    for (let index = 0; index < pixels.length; index += 3) {
      if (
        pixels[index]! >= threshold &&
        pixels[index + 1]! >= threshold &&
        pixels[index + 2]! >= threshold
      ) {
        pixels[index] = 255;
        pixels[index + 1] = 255;
        pixels[index + 2] = 255;
      }
    }

    const output = await sharp(pixels, {
      raw: { width: raw.info.width, height: raw.info.height, channels: 3 },
    })
      .jpeg({ quality })
      .toBuffer({ resolveWithObject: true });

    return {
      data: output.data,
      format: 'jpeg',
      width: output.info.width,
      height: output.info.height,
    };
  }

  const threshold = BW_THRESHOLDS[settings.threshold ?? 'balanced'];
  const output = await sharp(input)
    .flatten({ background: '#ffffff' })
    .grayscale()
    .threshold(threshold)
    .png()
    .toBuffer({ resolveWithObject: true });

  return {
    data: output.data,
    format: 'png',
    width: output.info.width,
    height: output.info.height,
  };
}

function isPasswordError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: string }).name === 'PasswordException'
  );
}

export async function rasterizePdf(
  inputPath: string,
  outputPath: string,
  options: RasterOptions,
): Promise<RasterResult> {
  const deadline = new PdfDeadline(options.timeoutMs, options.signal);
  deadline.check();

  const bytes = await readFile(inputPath);
  if (bytes.length === 0) {
    throw new FileHandlingError('empty', 'Input PDF is empty');
  }

  const pdfjs = await getPdfjs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl: STANDARD_FONTS,
    cMapUrl: CMAPS,
    cMapPacked: true,
    wasmUrl: WASM,
    useSystemFonts: true,
    disableFontFace: true,
  });

  let document;
  try {
    document = await loadingTask.promise;
  } catch (error) {
    await loadingTask.destroy().catch(() => undefined);
    if (isPasswordError(error)) {
      throw new FileHandlingError(
        'invalid_pdf',
        'Password-protected PDFs cannot be processed. Remove the password and try again.',
      );
    }
    throw new FileHandlingError('invalid_pdf', 'This PDF could not be opened for rendering');
  }

  const dpi = DPI_PRESETS[options.quality];
  const baseScale = dpi / 72;
  let completed = false;

  try {
    const pageCount = document.numPages;
    if (pageCount > options.maxPages) {
      throw new FileHandlingError(
        'raster_page_limit',
        `This PDF has ${pageCount} pages. This operation is limited to ${options.maxPages} pages at ${options.quality} quality.`,
      );
    }

    const output = await PDFDocument.create();

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      deadline.check();
      const page = await document.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });

      let scale = baseScale;
      const projected = baseViewport.width * scale * baseViewport.height * scale;
      if (projected > options.maxPixelsPerPage) {
        scale *= Math.sqrt(options.maxPixelsPerPage / projected);
      }

      const viewport = page.getViewport({ scale });
      const width = Math.max(1, Math.ceil(viewport.width));
      const height = Math.max(1, Math.ceil(viewport.height));
      const canvas = createCanvas(width, height);
      const context = canvas.getContext('2d');

      try {
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);
        await page.render({
          canvas: canvas as unknown as never,
          viewport,
        }).promise;
      } catch (error) {
        if (isPasswordError(error)) {
          throw new FileHandlingError(
            'invalid_pdf',
            'Password-protected PDFs cannot be processed. Remove the password and try again.',
          );
        }
        throw new FileHandlingError(
          'process_failed',
          `Page ${pageNumber} could not be rendered. Try a lower quality preset.`,
        );
      }

      const canvasBuffer = await canvas.encode('png');
      canvas.width = 1;
      canvas.height = 1;
      page.cleanup();

      deadline.check();
      const processed = await applyRasterFilter(canvasBuffer, options);
      const image =
        processed.format === 'jpeg'
          ? await output.embedJpg(processed.data)
          : await output.embedPng(processed.data);

      output.addPage([baseViewport.width, baseViewport.height]).drawImage(image, {
        x: 0,
        y: 0,
        width: baseViewport.width,
        height: baseViewport.height,
      });

      options.onProgress?.(pageNumber, pageCount);

      options.onProgress?.(pageNumber, pageCount);

      if (pageNumber % 10 === 0) {
        await document.cleanup();
      }
    }

    const outputBytes = await savePdfFile(output, outputPath, {
      maxOutputBytes: options.maxOutputBytes,
      deadline,
    });

    completed = true;
    return { pages: pageCount, outputBytes, dpi };
  } finally {
    await loadingTask.destroy().catch(() => undefined);
    if (!completed) {
      await cleanupFile(outputPath).catch(() => undefined);
    }
  }
}
