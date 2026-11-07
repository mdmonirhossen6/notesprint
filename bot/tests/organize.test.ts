import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, degrees } from 'pdf-lib';
import { FileHandlingError } from '../src/files/errors.js';
import {
  complementPages,
  extractPdfPages,
  parseGroupSize,
  parsePageRanges,
  rotatePdfPages,
  splitPdf,
} from '../src/pdf/organize.js';

const MAX_OUTPUT = 49 * 1024 * 1024;
const OPTIONS = { maxOutputBytes: MAX_OUTPUT, timeoutMs: 20_000 };

async function makePdf(
  dir: string,
  name: string,
  sizes: Array<[number, number]>,
  rotations: number[] = [],
): Promise<string> {
  const doc = await PDFDocument.create();
  sizes.forEach(([width, height], index) => {
    const page = doc.addPage([width, height]);
    const rotation = rotations[index] ?? 0;
    if (rotation) page.setRotation(degrees(rotation));
  });
  const path = join(dir, name);
  await writeFile(path, await doc.save());
  return path;
}

async function pageSizes(path: string): Promise<Array<{ width: number; height: number }>> {
  const doc = await PDFDocument.load(await readFile(path));
  return doc.getPages().map((page) => page.getSize());
}

async function pageRotations(path: string): Promise<number[]> {
  const doc = await PDFDocument.load(await readFile(path));
  return doc.getPages().map((page) => page.getRotation().angle);
}

function errorCode(error: unknown): string | undefined {
  return error instanceof FileHandlingError ? error.code : undefined;
}

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('Expected the function to throw');
}

test('parsePageRanges accepts ranges, spaces, and duplicates', () => {
  assert.deepEqual(parsePageRanges('1 - 3, 5', 5), [0, 1, 2, 4]);
  assert.deepEqual(parsePageRanges('1;2 2,3', 3), [0, 1, 2]);
  assert.deepEqual(parsePageRanges('2-2', 3), [1]);
  assert.throws(() => parsePageRanges('  ', 3));
});

test('parsePageRanges rejects invalid input', () => {
  for (const raw of ['', '0', '6', '4-2', '1-', 'a']) {
    assert.throws(() => parsePageRanges(raw, 5));
  }
  assert.equal(errorCode(thrownBy(() => parsePageRanges('4-2', 5))), 'invalid_range');
});

test('parsePageRanges permutation requires every page exactly once', () => {
  assert.deepEqual(parsePageRanges('3,1,2,5,4', 5, 'permutation'), [2, 0, 1, 4, 3]);
  assert.throws(() => parsePageRanges('1,2,3,4', 5, 'permutation'));
  assert.throws(() => parsePageRanges('1,1,2,3,4,5', 5, 'permutation'));
  assert.throws(() => parsePageRanges('1-5,3', 5, 'permutation'));
});

test('parseGroupSize validates the range', () => {
  assert.equal(parseGroupSize('3', 10), 3);
  for (const raw of ['0', '-1', '11', '2.5', 'x', '']) {
    assert.throws(() => parseGroupSize(raw, 10));
  }
});

test('complementPages keeps the pages that were not removed', () => {
  assert.deepEqual(complementPages(5, [0, 2, 4]), [1, 3]);
  assert.deepEqual(complementPages(3, []), [0, 1, 2]);
});

test('extractPdfPages preserves page order and dimensions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-organize-'));
  try {
    const input = await makePdf(dir, 'input.pdf', [
      [100, 200],
      [101, 201],
      [102, 202],
      [103, 203],
      [104, 204],
    ]);
    const output = join(dir, 'out.pdf');

    const result = await extractPdfPages(input, output, [4, 0, 2], OPTIONS);
    assert.equal(result.pages, 3);
    assert.equal(result.outputBytes > 0, true);

    const sizes = await pageSizes(output);
    assert.deepEqual(
      sizes.map((size) => [Math.round(size.width), Math.round(size.height)]),
      [
        [104, 204],
        [100, 200],
        [102, 202],
      ],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('extractPdfPages rejects empty and oversized output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-organize-'));
  try {
    const input = await makePdf(dir, 'input.pdf', [[100, 200]]);
    const output = join(dir, 'out.pdf');

    await assert.rejects(extractPdfPages(input, output, [], OPTIONS), (error) => {
      assert.equal(errorCode(error), 'empty_selection');
      return true;
    });

    await assert.rejects(
      extractPdfPages(input, output, [0], { maxOutputBytes: 32, timeoutMs: 20_000 }),
      (error) => {
        assert.equal(errorCode(error), 'output_too_large');
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('extractPdfPages maps invalid PDFs and cancellation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-organize-'));
  try {
    const broken = join(dir, 'broken.pdf');
    await writeFile(broken, 'not a pdf');
    const output = join(dir, 'out.pdf');

    await assert.rejects(extractPdfPages(broken, output, [0], OPTIONS), (error) => {
      assert.equal(errorCode(error), 'invalid_pdf');
      return true;
    });

    const valid = await makePdf(dir, 'valid.pdf', [[100, 200]]);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      extractPdfPages(valid, output, [0], { ...OPTIONS, signal: controller.signal }),
      (error) => {
        assert.equal(errorCode(error), 'cancelled');
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rotatePdfPages rotates all or selected pages and keeps dimensions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-organize-'));
  try {
    const input = await makePdf(
      dir,
      'input.pdf',
      [
        [100, 200],
        [101, 201],
        [102, 202],
      ],
      [0, 90, 270],
    );
    const all = join(dir, 'all.pdf');
    const some = join(dir, 'some.pdf');

    const result = await rotatePdfPages(input, all, 90, null, OPTIONS);
    assert.equal(result.pages, 3);
    assert.deepEqual(await pageRotations(all), [90, 180, 0]);

    await rotatePdfPages(input, some, 180, [0, 2], OPTIONS);
    assert.deepEqual(await pageRotations(some), [180, 90, 90]);
    const sizes = await pageSizes(some);
    assert.deepEqual(
      sizes.map((size) => [Math.round(size.width), Math.round(size.height)]),
      [
        [100, 200],
        [101, 201],
        [102, 202],
      ],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rotatePdfPages rejects an empty selection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-organize-'));
  try {
    const input = await makePdf(dir, 'input.pdf', [[100, 200]]);
    await assert.rejects(
      rotatePdfPages(input, join(dir, 'out.pdf'), 90, [], OPTIONS),
      (error) => {
        assert.equal(errorCode(error), 'empty_selection');
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('splitPdf every page produces a ZIP of single-page PDFs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-organize-'));
  try {
    const input = await makePdf(dir, 'input.pdf', [
      [100, 200],
      [101, 201],
      [102, 202],
    ]);
    const workDir = join(dir, 'work');
    const output = join(dir, 'split.zip');
    await mkdir(workDir);

    const result = await splitPdf(input, workDir, output, 'every', 1, OPTIONS);
    assert.equal(result.zipped, true);
    assert.equal(result.files.length, 3);
    assert.equal(result.pages, 3);
    assert.equal(result.outputName.endsWith('.zip'), true);
    assert.equal(result.outputBytes > 0, true);

    const bytes = await readFile(output);
    assert.equal(bytes.subarray(0, 4).toString('latin1'), 'PK\x03\x04');
    const text = bytes.toString('latin1');
    for (const name of [
      'notesprint-page-1.pdf',
      'notesprint-page-2.pdf',
      'notesprint-page-3.pdf',
    ]) {
      assert.equal(text.includes(name), true, `ZIP should contain ${name}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('splitPdf groups pages and keeps the last group smaller', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-organize-'));
  try {
    const input = await makePdf(dir, 'input.pdf', [
      [100, 200],
      [101, 201],
      [102, 202],
      [103, 203],
      [104, 204],
    ]);
    const workDir = join(dir, 'work');
    const output = join(dir, 'split.zip');
    await mkdir(workDir);

    const result = await splitPdf(input, workDir, output, 'groups', 2, OPTIONS);
    assert.equal(result.zipped, true);
    assert.equal(result.files.length, 3);
    assert.deepEqual(
      result.files.map((file) => file.pages),
      [2, 2, 1],
    );

    const bytes = await readFile(output);
    const text = bytes.toString('latin1');
    assert.equal(text.includes('notesprint-group-3-page-5.pdf'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('splitPdf with one group returns a single PDF outside the work directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-organize-'));
  try {
    const input = await makePdf(dir, 'input.pdf', [
      [100, 200],
      [101, 201],
    ]);
    const workDir = join(dir, 'work');
    const output = join(dir, 'single.pdf');
    await mkdir(workDir);

    const result = await splitPdf(input, workDir, output, 'groups', 2, OPTIONS);
    assert.equal(result.zipped, false);
    assert.equal(result.outputPath, output);
    assert.equal(result.files.length, 1);
    assert.equal(result.outputBytes > 0, true);
    assert.equal((await pageSizes(output)).length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('splitPdf validates group size', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-organize-'));
  try {
    const input = await makePdf(dir, 'input.pdf', [[100, 200]]);
    const workDir = join(dir, 'work');
    const output = join(dir, 'split.zip');
    await mkdir(workDir);

    await assert.rejects(splitPdf(input, workDir, output, 'groups', 0, OPTIONS), (error) => {
      assert.equal(errorCode(error), 'invalid_range');
      return true;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
