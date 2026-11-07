import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DOMMatrix, ImageData, Path2D, createCanvas } from '@napi-rs/canvas';
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import sharp from 'sharp';
import { FileHandlingError } from '../src/files/errors.js';
import {
  DEFAULT_NUP_SETTINGS,
  NUP_PRESETS,
  PAPER_SIZES,
  nupPdf,
  resolveSheetSize,
} from '../src/pdf/nup.js';
import type { NupSettings, PaperSize } from '../src/pdf/nup.js';

const globalScope = globalThis as typeof globalThis & {
  DOMMatrix?: typeof DOMMatrix;
  ImageData?: typeof ImageData;
  Path2D?: typeof Path2D;
};
globalScope.DOMMatrix ??= DOMMatrix;
globalScope.ImageData ??= ImageData;
globalScope.Path2D ??= Path2D;

const MAX_OUTPUT = 49 * 1024 * 1024;
const requireFromHere = createRequire(import.meta.url);
const PDFJS_ROOT = dirname(requireFromHere.resolve('pdfjs-dist/package.json'));
const STANDARD_FONTS = `${pathToFileURL(join(PDFJS_ROOT, 'standard_fonts')).href}/`;
const CMAPS = `${pathToFileURL(join(PDFJS_ROOT, 'cmaps')).href}/`;
const WASM = `${pathToFileURL(join(PDFJS_ROOT, 'wasm')).href}/`;

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsPromise: Promise<PdfjsModule> | undefined;

function getPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

interface RenderedPage {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
}

async function renderPage(path: string, scale = 1.5): Promise<RenderedPage> {
  const bytes = new Uint8Array(await readFile(path));
  const pdfjs = await getPdfjs();
  const task = pdfjs.getDocument({
    data: bytes,
    standardFontDataUrl: STANDARD_FONTS,
    cMapUrl: CMAPS,
    cMapPacked: true,
    wasmUrl: WASM,
    useSystemFonts: true,
    disableFontFace: true,
  });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas: canvas as unknown as never, viewport }).promise;
    page.cleanup();
    const raw = await sharp(await canvas.encode('png'))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return {
      data: raw.data,
      width: raw.info.width,
      height: raw.info.height,
      channels: raw.info.channels,
    };
  } finally {
    await task.destroy();
  }
}

function pixel(image: RenderedPage, x: number, y: number): [number, number, number] {
  const index = (Math.floor(y) * image.width + Math.floor(x)) * image.channels;
  return [image.data[index] ?? 0, image.data[index + 1] ?? 0, image.data[index + 2] ?? 0];
}

function average(image: RenderedPage, x: number, y: number, radius = 3): [number, number, number] {
  const values = [0, 0, 0];
  let count = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const px = x + dx;
      const py = y + dy;
      if (px < 0 || py < 0 || px >= image.width || py >= image.height) continue;
      const [r, g, b] = pixel(image, px, py);
      values[0]! += r;
      values[1]! += g;
      values[2]! += b;
      count += 1;
    }
  }
  return [values[0]! / count, values[1]! / count, values[2]! / count];
}

function minimum(image: RenderedPage, x: number, y: number, radius = 1): number {
  let min = 255;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const px = x + dx;
      const py = y + dy;
      if (px < 0 || py < 0 || px >= image.width || py >= image.height) continue;
      min = Math.min(min, pixel(image, px, py)[0] ?? 255);
    }
  }
  return min;
}

type Colour = 'red' | 'green' | 'blue' | 'yellow';

const COLOURS: Record<Colour, [number, number, number]> = {
  red: [229, 25, 25],
  green: [25, 200, 25],
  blue: [25, 25, 229],
  yellow: [230, 210, 25],
};

async function makeColourPdf(
  dir: string,
  colours: Colour[],
  size: [number, number] = [300, 200],
  rotation = 0,
  name = 'input.pdf',
): Promise<string> {
  const doc = await PDFDocument.create();
  for (const colour of colours) {
    const page = doc.addPage(size);
    const [r, g, b] = COLOURS[colour];
    page.drawRectangle({
      x: 0,
      y: 0,
      width: size[0],
      height: size[1],
      color: rgb(r / 255, g / 255, b / 255),
    });
    if (rotation) page.setRotation(degrees(rotation));
  }
  const path = join(dir, name);
  await writeFile(path, await doc.save());
  return path;
}

function settings(overrides: Partial<NupSettings> = {}): NupSettings {
  return { ...DEFAULT_NUP_SETTINGS, ...overrides };
}

function options(overrides: Partial<NupSettings> = {}, maxPages = 300) {
  return {
    ...settings(overrides),
    maxPages,
    maxOutputBytes: MAX_OUTPUT,
    timeoutMs: 30_000,
  };
}

async function outputPages(path: string): Promise<Array<{ width: number; height: number }>> {
  const doc = await PDFDocument.load(await readFile(path));
  return doc.getPages().map((page) => page.getSize());
}

function nearColour(actual: [number, number, number], expected: [number, number, number]): boolean {
  return expected.every((value, index) => Math.abs(value - (actual[index] ?? 0)) <= 24);
}

test('resolveSheetSize honours paper, orientation, and auto', () => {
  const portrait = resolveSheetSize({ paper: 'a4', orientation: 'portrait' }, []);
  assert.equal(Math.round(portrait.width), 595);
  assert.equal(Math.round(portrait.height), 842);

  const landscape = resolveSheetSize({ paper: 'a4', orientation: 'landscape' }, []);
  assert.equal(Math.round(landscape.width), 842);
  assert.equal(Math.round(landscape.height), 595);

  const autoPortrait = resolveSheetSize({ paper: 'a4', orientation: 'auto' }, [
    { width: 300, height: 400 },
  ]);
  assert.equal(Math.round(autoPortrait.width), 595);

  const autoLandscape = resolveSheetSize({ paper: 'a4', orientation: 'auto' }, [
    { width: 400, height: 300 },
  ]);
  assert.equal(Math.round(autoLandscape.width), 842);
});

test('N-up places pages in reading order on one A4 sheet', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-nup-'));
  try {
    const input = await makeColourPdf(dir, ['red', 'green', 'blue', 'yellow']);
    const output = join(dir, 'out.pdf');

    const result = await nupPdf(
      input,
      output,
      options({ perPage: 4, paper: 'a4', orientation: 'portrait' }),
    );
    assert.equal(result.inputPages, 4);
    assert.equal(result.outputPages, 1);
    assert.equal(result.outputBytes > 0, true);

    const sizes = await outputPages(output);
    assert.equal(sizes.length, 1);
    assert.equal(Math.round(sizes[0]!.width), 595);
    assert.equal(Math.round(sizes[0]!.height), 842);

    const image = await renderPage(output);
    const cells: Array<[number, number, Colour]> = [
      [0.27, 0.27, 'red'],
      [0.73, 0.27, 'green'],
      [0.27, 0.73, 'blue'],
      [0.73, 0.73, 'yellow'],
    ];
    for (const [x, y, colour] of cells) {
      const sample = average(image, image.width * x, image.height * y);
      assert.ok(
        nearColour(sample, COLOURS[colour]),
        `${colour} cell was rgb(${sample.map((value) => Math.round(value)).join(',')})`,
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('N-up supports every advertised paper size and orientation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-nup-'));
  try {
    const input = await makeColourPdf(dir, ['red']);

    for (const paper of Object.keys(PAPER_SIZES) as PaperSize[]) {
      const output = join(dir, `${paper}.pdf`);
      await nupPdf(input, output, options({ paper, orientation: 'portrait' }));
      const [size] = await outputPages(output);
      const expected = PAPER_SIZES[paper];
      assert.equal(Math.round(size!.width), Math.round(expected.width));
      assert.equal(Math.round(size!.height), Math.round(expected.height));

      const landscapeOutput = join(dir, `${paper}-landscape.pdf`);
      await nupPdf(input, landscapeOutput, options({ paper, orientation: 'landscape' }));
      const [landscape] = await outputPages(landscapeOutput);
      assert.equal(Math.round(landscape!.width), Math.round(expected.height));
      assert.equal(Math.round(landscape!.height), Math.round(expected.width));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('N-up auto orientation follows the source pages', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-nup-'));
  try {
    const portrait = await makeColourPdf(dir, ['red'], [200, 300], 0, 'portrait.pdf');
    const landscape = await makeColourPdf(dir, ['blue'], [300, 200], 0, 'landscape.pdf');
    const portraitOut = join(dir, 'portrait-out.pdf');
    const landscapeOut = join(dir, 'landscape-out.pdf');

    await nupPdf(portrait, portraitOut, options({ orientation: 'auto' }));
    await nupPdf(landscape, landscapeOut, options({ orientation: 'auto' }));

    const [portraitSize] = await outputPages(portraitOut);
    const [landscapeSize] = await outputPages(landscapeOut);
    assert.ok(portraitSize!.height > portraitSize!.width);
    assert.ok(landscapeSize!.width > landscapeSize!.height);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('N-up supports 2, 6, and 9-in-1 layouts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-nup-'));
  try {
    for (const perPage of [2, 6, 9] as const) {
      const preset = NUP_PRESETS[perPage];
      const input = await makeColourPdf(
        dir,
        Array.from({ length: perPage }, () => 'red' as const),
      );
      const output = join(dir, `${perPage}.pdf`);
      const result = await nupPdf(input, output, options({ perPage }));
      assert.equal(result.outputPages, 1);
      assert.equal(preset.rows * preset.cols, perPage);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('N-up preserves a landscape aspect ratio inside the cell', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-nup-'));
  try {
    const input = await makeColourPdf(dir, ['red'], [300, 150]);
    const output = join(dir, 'out.pdf');

    await nupPdf(input, output, options({ perPage: 4, paper: 'a4', gap: 0 }));
    const image = await renderPage(output);

    let minX = image.width;
    let maxX = 0;
    let minY = image.height;
    let maxY = 0;
    for (let y = 0; y < image.height / 2; y += 1) {
      for (let x = 0; x < image.width / 2; x += 1) {
        const [r, g, b] = pixel(image, x, y);
        if (r > 180 && g < 90 && b < 90) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }

    const aspect = (maxX - minX + 1) / (maxY - minY + 1);
    assert.ok(Math.abs(aspect - 2) < 0.08, `aspect was ${aspect.toFixed(3)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('N-up renders rotated source pages upright', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-nup-'));
  try {
    const input = await makeColourPdf(dir, ['red'], [300, 150], 90);
    const output = join(dir, 'out.pdf');

    await nupPdf(input, output, options({ perPage: 4, paper: 'a4', gap: 0 }));
    const image = await renderPage(output);

    let minX = image.width;
    let maxX = 0;
    let minY = image.height;
    let maxY = 0;
    for (let y = 0; y < image.height / 2; y += 1) {
      for (let x = 0; x < image.width / 2; x += 1) {
        const [r, g, b] = pixel(image, x, y);
        if (r > 180 && g < 90 && b < 90) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }

    const aspect = (maxX - minX + 1) / (maxY - minY + 1);
    assert.ok(Math.abs(aspect - 0.5) < 0.06, `aspect was ${aspect.toFixed(3)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('N-up draws separators only when enabled', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-nup-'));
  try {
    const input = await makeColourPdf(dir, ['red', 'green', 'blue', 'yellow']);
    const plain = join(dir, 'plain.pdf');
    const separated = join(dir, 'separated.pdf');

    await nupPdf(input, plain, options({ perPage: 4, gap: 16, separators: false }));
    await nupPdf(input, separated, options({ perPage: 4, gap: 16, separators: true }));

    const withLines = await renderPage(separated, 1);
    const withoutLines = await renderPage(plain, 1);

    const x = withLines.width / 2;
    const y = withLines.height * 0.25;
    const linePixel = minimum(withLines, x, y, 2);
    const blankPixel = minimum(withoutLines, x, y, 2);

    assert.ok(linePixel < 245, `expected a separator line, darkest pixel was ${linePixel}`);
    assert.ok(blankPixel > 250, `expected blank space without separators, darkest was ${blankPixel}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('N-up page numbers start where configured and can be turned off', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-nup-'));
  try {
    const input = await makeColourPdf(
      dir,
      Array.from({ length: 5 }, () => 'red' as const),
      [300, 200],
    );
    const numbered = join(dir, 'numbered.pdf');
    const plain = join(dir, 'plain.pdf');

    await nupPdf(
      input,
      numbered,
      options({
        perPage: 2,
        pageNumbers: true,
        numberStart: 7,
        numberPosition: 'bottom-center',
        numberSize: 12,
      }),
    );
    await nupPdf(input, plain, options({ perPage: 2, pageNumbers: false }));

    const numberedImage = await renderPage(numbered);
    const plainImage = await renderPage(plain);

    const countDark = (image: RenderedPage, fromBottom: number): number => {
      let count = 0;
      const startY = Math.floor(image.height - fromBottom);
      for (let y = startY; y < image.height; y += 1) {
        for (let x = Math.floor(image.width * 0.35); x < image.width * 0.65; x += 1) {
          if ((pixel(image, x, y)[0] ?? 0) < 90) count += 1;
        }
      }
      return count;
    };

    const numberedPixels = countDark(numberedImage, 70);
    const plainPixels = countDark(plainImage, 70);
    assert.ok(numberedPixels > 20, `expected page-number pixels, found ${numberedPixels}`);
    assert.equal(plainPixels, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('N-up paginates the input across multiple sheets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-nup-'));
  try {
    const input = await makeColourPdf(
      dir,
      Array.from({ length: 5 }, () => 'red' as const),
    );
    const output = join(dir, 'out.pdf');
    const result = await nupPdf(input, output, options({ perPage: 2 }));
    assert.equal(result.inputPages, 5);
    assert.equal(result.outputPages, 3);
    assert.equal((await outputPages(output)).length, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('N-up rejects too many pages and invalid PDFs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-nup-'));
  try {
    const input = await makeColourPdf(dir, ['red', 'green']);
    await assert.rejects(nupPdf(input, join(dir, 'out.pdf'), options({}, 1)), (error) => {
      assert.ok(error instanceof FileHandlingError);
      assert.equal(error.code, 'too_many_pages');
      return true;
    });

    const broken = join(dir, 'broken.pdf');
    await writeFile(broken, 'not a pdf');
    await assert.rejects(nupPdf(broken, join(dir, 'broken-out.pdf'), options()), (error) => {
      assert.ok(error instanceof FileHandlingError);
      assert.equal(error.code, 'invalid_pdf');
      return true;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
