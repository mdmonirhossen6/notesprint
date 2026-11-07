import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, rgb } from 'pdf-lib';
import sharp from 'sharp';
import { FileHandlingError } from '../src/files/errors.js';
import {
  BW_PAGE_LIMITS,
  RASTER_PAGE_LIMITS,
  applyRasterFilter,
  rasterPageLimit,
  rasterizePdf,
} from '../src/pdf/raster.js';
import type { RasterSettings } from '../src/pdf/raster.js';

const MAX_OUTPUT = 49 * 1024 * 1024;

test('quality-aware raster page limits are conservative and configurable', () => {
  assert.deepEqual(RASTER_PAGE_LIMITS, { low: 30, medium: 20, high: 12 });
  assert.deepEqual(BW_PAGE_LIMITS, { low: 20, medium: 12, high: 8 });

  for (const quality of ['low', 'medium', 'high'] as const) {
    assert.equal(rasterPageLimit('gray', quality, 100), RASTER_PAGE_LIMITS[quality]);
    assert.equal(rasterPageLimit('invert', quality, 100), RASTER_PAGE_LIMITS[quality]);
    assert.equal(rasterPageLimit('bw', quality, 100), BW_PAGE_LIMITS[quality]);
    assert.ok(rasterPageLimit('bw', quality, 100) <= rasterPageLimit('gray', quality, 100));
  }

  assert.equal(rasterPageLimit('gray', 'medium', 5), 5);
  assert.equal(rasterPageLimit('bw', 'high', 5), 5);
});

interface RawImage {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
}

async function fixtureImage(): Promise<Buffer> {
  const canvas = createCanvas(100, 60);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 100, 60);
  ctx.fillStyle = '#d02020';
  ctx.fillRect(0, 0, 30, 30);
  ctx.fillStyle = '#808080';
  ctx.fillRect(30, 0, 30, 30);
  ctx.fillStyle = '#fafafa';
  ctx.fillRect(60, 0, 30, 30);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 30, 30, 30);
  ctx.fillStyle = '#787878';
  ctx.fillRect(30, 30, 30, 30);
  return canvas.encode('png');
}

async function decode(buffer: Buffer): Promise<RawImage> {
  const raw = await sharp(buffer).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  return {
    data: raw.data,
    width: raw.info.width,
    height: raw.info.height,
    channels: raw.info.channels,
  };
}

function pixel(image: RawImage, x: number, y: number): [number, number, number] {
  const index = (y * image.width + x) * image.channels;
  return [image.data[index] ?? 0, image.data[index + 1] ?? 0, image.data[index + 2] ?? 0];
}

function expectNear(actual: number, expected: number, tolerance = 12): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

async function filtered(settings: RasterSettings): Promise<RawImage> {
  return decode((await applyRasterFilter(await fixtureImage(), settings)).data);
}

test('grayscale removes colour while keeping tone', async () => {
  const image = await filtered({ filter: 'gray', quality: 'medium' });

  const red = pixel(image, 10, 10);
  expectNear(red[0], red[1]);
  expectNear(red[1], red[2]);
  assert.ok(red[0] < 120);

  const white = pixel(image, 90, 10);
  assert.ok(white.every((value) => value >= 240));
});

test('invert flips light and dark pixels', async () => {
  const image = await filtered({ filter: 'invert', quality: 'medium' });

  const white = pixel(image, 90, 10);
  assert.ok(white.every((value) => value <= 30));

  const dark = pixel(image, 10, 40);
  assert.ok(dark.every((value) => value >= 220));

  const red = pixel(image, 10, 10);
  assert.ok(red[0] < 100);
  assert.ok(red[1] > 170);
  assert.ok(red[2] > 170);
});

test('clear background whitens off-white paper without destroying dark text', async () => {
  const image = await filtered({ filter: 'clear', quality: 'medium', clearLevel: 'medium' });

  const paper = pixel(image, 90, 10);
  assert.ok(paper.every((value) => value >= 250), `paper was ${paper.join(',')}`);

  const text = pixel(image, 10, 40);
  assert.ok(text.every((value) => value <= 30), `text was ${text.join(',')}`);

  const midtone = pixel(image, 40, 10);
  assert.ok(midtone.every((value) => value >= 110 && value <= 145));
});

test('black and white produces true monochrome with selectable thresholds', async () => {
  const balanced = await filtered({ filter: 'bw', quality: 'medium', threshold: 'balanced' });
  for (let index = 0; index < balanced.data.length; index += balanced.channels) {
    const value = balanced.data[index] ?? 0;
    assert.ok(value === 0 || value === 255, `pixel ${value} is not monochrome`);
  }

  const white = pixel(balanced, 90, 10);
  assert.deepEqual(white, [255, 255, 255]);
  const black = pixel(balanced, 10, 40);
  assert.deepEqual(black, [0, 0, 0]);

  const light = await filtered({ filter: 'bw', quality: 'medium', threshold: 'light' });
  const strong = await filtered({ filter: 'bw', quality: 'medium', threshold: 'strong' });
  const midtoneLight = pixel(light, 40, 40);
  const midtoneStrong = pixel(strong, 40, 40);
  assert.deepEqual(midtoneLight, [255, 255, 255]);
  assert.deepEqual(midtoneStrong, [0, 0, 0]);
});

async function makePdf(dir: string, pages: number, width = 300, height = 200): Promise<string> {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) {
    const page = doc.addPage([width, height]);
    page.drawRectangle({
      x: 20,
      y: 20,
      width: width - 40,
      height: height - 40,
      color: rgb(0.8, 0.2, 0.2),
    });
    page.drawRectangle({
      x: 40,
      y: 40,
      width: 80,
      height: 40,
      color: rgb(0.1, 0.1, 0.1),
    });
  }
  const path = join(dir, 'input.pdf');
  await writeFile(path, await doc.save());
  return path;
}

async function outputInfo(path: string): Promise<{ pages: number; width: number; height: number }> {
  const doc = await PDFDocument.load(await readFile(path));
  const size = doc.getPage(0).getSize();
  return {
    pages: doc.getPageCount(),
    width: Math.round(size.width),
    height: Math.round(size.height),
  };
}

test('rasterizePdf writes valid PDFs for every colour filter', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-raster-'));
  try {
    const input = await makePdf(dir, 1);

    for (const filter of ['gray', 'bw', 'invert', 'clear'] as const) {
      const output = join(dir, `${filter}.pdf`);
      const result = await rasterizePdf(input, output, {
        filter,
        quality: 'medium',
        maxPages: 30,
        maxPixelsPerPage: 4_000_000,
        maxOutputBytes: MAX_OUTPUT,
        timeoutMs: 30_000,
      });

      assert.equal(result.pages, 1);
      assert.equal(result.dpi, 150);
      assert.equal(result.outputBytes > 0, true);

      const info = await outputInfo(output);
      assert.equal(info.pages, 1);
      assert.equal(info.width, 300);
      assert.equal(info.height, 200);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rasterizePdf reports DPI presets and keeps page dimensions when clamping pixels', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-raster-'));
  try {
    const input = await makePdf(dir, 1);

    const low = await rasterizePdf(input, join(dir, 'low.pdf'), {
      filter: 'gray',
      quality: 'low',
      maxPages: 30,
      maxPixelsPerPage: 4_000_000,
      maxOutputBytes: MAX_OUTPUT,
      timeoutMs: 30_000,
    });
    assert.equal(low.dpi, 100);

    const high = await rasterizePdf(input, join(dir, 'high.pdf'), {
      filter: 'gray',
      quality: 'high',
      maxPages: 30,
      maxPixelsPerPage: 1_000,
      maxOutputBytes: MAX_OUTPUT,
      timeoutMs: 30_000,
    });
    assert.equal(high.dpi, 200);

    const info = await outputInfo(join(dir, 'high.pdf'));
    assert.equal(info.width, 300);
    assert.equal(info.height, 200);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rasterizePdf rejects too many pages and cleans up', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-raster-'));
  try {
    const input = await makePdf(dir, 2);
    const output = join(dir, 'out.pdf');

    await assert.rejects(
      rasterizePdf(input, output, {
        filter: 'gray',
        quality: 'low',
        maxPages: 1,
        maxPixelsPerPage: 4_000_000,
        maxOutputBytes: MAX_OUTPUT,
        timeoutMs: 30_000,
      }),
      (error) => {
        assert.ok(error instanceof FileHandlingError);
        assert.equal(error.code, 'raster_page_limit');
        return true;
      },
    );

    await assert.rejects(readFile(output));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rasterizePdf rejects invalid and already-cancelled input', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-raster-'));
  try {
    const broken = join(dir, 'broken.pdf');
    await writeFile(broken, 'not a pdf');
    const output = join(dir, 'out.pdf');

    await assert.rejects(
      rasterizePdf(broken, output, {
        filter: 'gray',
        quality: 'low',
        maxPages: 30,
        maxPixelsPerPage: 4_000_000,
        maxOutputBytes: MAX_OUTPUT,
        timeoutMs: 30_000,
      }),
      (error) => {
        assert.ok(error instanceof FileHandlingError);
        assert.equal(error.code, 'invalid_pdf');
        return true;
      },
    );

    const valid = await makePdf(dir, 1);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      rasterizePdf(valid, output, {
        filter: 'gray',
        quality: 'low',
        maxPages: 30,
        maxPixelsPerPage: 4_000_000,
        maxOutputBytes: MAX_OUTPUT,
        timeoutMs: 30_000,
        signal: controller.signal,
      }),
      (error) => {
        assert.ok(error instanceof FileHandlingError);
        assert.equal(error.code, 'cancelled');
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
