import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import type { AppConfig } from '../src/config.js';
import { createMergeSessionStore } from '../src/files/merge-session.js';
import { countPdfPages, mergePdfs } from '../src/pdf/merge.js';
import { helpText, mainMenuKeyboard } from '../src/bot/ui.js';

const MAX_OUTPUT = 49 * 1024 * 1024;

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    logLevel: 'error',
    botToken: '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    botMode: 'webhook',
    botApiRoot: 'https://api.telegram.org',
    botApiAllowHttp: false,
    telegramApiId: undefined,
    telegramApiHash: undefined,
    localFileRoot: undefined,
    webhookUrl: 'https://notesprint.onrender.com/telegram',
    webhookSecret: 'abcdefghijklmnop',
    webhookPath: '/telegram',
    port: 8080,
    superAdminId: 5000,
    databasePath: ':memory:',
    tmpDir: join(tmpdir(), 'notesprint-test'),
    maxUploadMb: 19,
    maxOutputMb: 49,
    maxPdfPages: 300,
    mergeMaxFiles: 10,
    mergeMaxTotalMb: 40,
    rasterMaxPages: 30,
    rasterMaxPixelsPerPage: 4000000,
    processTimeoutSeconds: 180,
    processConcurrency: 1,
    downloadConcurrency: 2,
    fileTransferTimeoutSeconds: 120,
    minFreeDiskMb: 64,
    tempFileTtlMinutes: 60,
    uploadRateLimitCount: 10,
    uploadRateLimitWindowMinutes: 60,
    membershipCacheTtlSeconds: 180,
    requiredChannels: [],
    prostutiAppUrl: 'https://prostuti.bd',
    ...overrides,
  };
}

async function makePdf(
  dir: string,
  name: string,
  sizes: Array<[number, number]>,
): Promise<string> {
  const doc = await PDFDocument.create();
  for (const [width, height] of sizes) {
    doc.addPage([width, height]);
  }
  const path = join(dir, name);
  await writeFile(path, await doc.save());
  return path;
}

async function pageSizes(path: string): Promise<Array<{ width: number; height: number }>> {
  const doc = await PDFDocument.load(await readFile(path));
  return doc.getPages().map((page) => page.getSize());
}

test('merge preserves input order and page sizes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-merge-'));
  try {
    const first = await makePdf(dir, 'a.pdf', [
      [100, 200],
      [101, 201],
    ]);
    const second = await makePdf(dir, 'b.pdf', [[300, 400]]);
    const output = join(dir, 'out.pdf');

    const result = await mergePdfs([first, second], output, {
      maxOutputBytes: MAX_OUTPUT,
      maxPages: 300,
      maxFiles: 10,
      timeoutMs: 10_000,
    });

    assert.equal(result.files, 2);
    assert.equal(result.pages, 3);
    assert.equal(result.outputBytes > 0, true);

    const sizes = await pageSizes(output);
    assert.equal(sizes.length, 3);
    assert.equal(Math.round(sizes[0]?.width ?? 0), 100);
    assert.equal(Math.round(sizes[1]?.width ?? 0), 101);
    assert.equal(Math.round(sizes[2]?.width ?? 0), 300);
    assert.equal(Math.round(sizes[2]?.height ?? 0), 400);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('merge honours a reversed file order', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-merge-'));
  try {
    const first = await makePdf(dir, 'a.pdf', [[100, 200]]);
    const second = await makePdf(dir, 'b.pdf', [[300, 400]]);
    const output = join(dir, 'out.pdf');

    await mergePdfs([second, first], output, {
      maxOutputBytes: MAX_OUTPUT,
      maxPages: 300,
      maxFiles: 10,
      timeoutMs: 10_000,
    });

    const sizes = await pageSizes(output);
    assert.equal(Math.round(sizes[0]?.width ?? 0), 300);
    assert.equal(Math.round(sizes[1]?.width ?? 0), 100);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('merge rejects invalid input and removes the output file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-merge-'));
  try {
    const valid = await makePdf(dir, 'a.pdf', [[100, 200]]);
    const broken = join(dir, 'broken.pdf');
    await writeFile(broken, 'not a pdf');
    const output = join(dir, 'out.pdf');

    await assert.rejects(
      mergePdfs([valid, broken], output, {
        maxOutputBytes: MAX_OUTPUT,
        maxPages: 300,
        maxFiles: 10,
        timeoutMs: 10_000,
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'invalid_pdf');
        return true;
      },
    );
    assert.equal(existsSync(output), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('merge enforces file count, page, and output limits', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-merge-'));
  try {
    const first = await makePdf(dir, 'a.pdf', [
      [100, 200],
      [100, 200],
    ]);
    const second = await makePdf(dir, 'b.pdf', [
      [100, 200],
      [100, 200],
    ]);
    const output = join(dir, 'out.pdf');

    await assert.rejects(
      mergePdfs([first], output, {
        maxOutputBytes: MAX_OUTPUT,
        maxPages: 300,
        maxFiles: 10,
        timeoutMs: 10_000,
      }),
      (error: unknown) => (error as { code?: string }).code === 'too_few_files',
    );

    await assert.rejects(
      mergePdfs([first, second], output, {
        maxOutputBytes: MAX_OUTPUT,
        maxPages: 300,
        maxFiles: 1,
        timeoutMs: 10_000,
      }),
      (error: unknown) => (error as { code?: string }).code === 'too_many_files',
    );

    await assert.rejects(
      mergePdfs([first, second], output, {
        maxOutputBytes: MAX_OUTPUT,
        maxPages: 3,
        maxFiles: 10,
        timeoutMs: 10_000,
      }),
      (error: unknown) => (error as { code?: string }).code === 'too_many_pages',
    );

    await assert.rejects(
      mergePdfs([first, second], output, {
        maxOutputBytes: 10,
        maxPages: 300,
        maxFiles: 10,
        timeoutMs: 10_000,
      }),
      (error: unknown) => (error as { code?: string }).code === 'output_too_large',
    );
    assert.equal(existsSync(output), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('merge refuses to start when cancelled and never writes output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-merge-'));
  try {
    const first = await makePdf(dir, 'a.pdf', [[100, 200]]);
    const second = await makePdf(dir, 'b.pdf', [[300, 400]]);
    const output = join(dir, 'out.pdf');
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      mergePdfs([first, second], output, {
        maxOutputBytes: MAX_OUTPUT,
        maxPages: 300,
        maxFiles: 10,
        timeoutMs: 10_000,
        signal: controller.signal,
      }),
      (error: unknown) => (error as { code?: string }).code === 'cancelled',
    );
    assert.equal(existsSync(output), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('countPdfPages reads real page counts and rejects damaged files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-merge-'));
  try {
    const valid = await makePdf(dir, 'a.pdf', [
      [100, 200],
      [100, 200],
      [100, 200],
    ]);
    assert.equal(await countPdfPages(valid), 3);

    const broken = join(dir, 'broken.pdf');
    await writeFile(broken, 'broken');
    await assert.rejects(
      countPdfPages(broken),
      (error: unknown) => (error as { code?: string }).code === 'invalid_pdf',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('merge session orders files by Telegram message ID and tracks pending work', () => {
  let now = 1_000;
  const store = createMergeSessionStore({ ttlMs: 1_000, now: () => now });
  const session = store.start(42, 900);
  assert.equal(store.start(42, 900), session, 'starting again returns the same session');

  assert.equal(store.reserve(42), true);
  assert.equal(store.reserve(42), true);
  assert.equal(store.get(42)?.pending, 2);

  store.commit(42, 200, { path: '/tmp/b.pdf', name: 'b.pdf', sizeBytes: 10, pages: 1 });
  store.commit(42, 100, { path: '/tmp/a.pdf', name: 'a.pdf', sizeBytes: 20, pages: 2 });

  const ordered = store.get(42);
  assert.deepEqual(
    ordered?.files.map((file) => file.seq),
    [100, 200],
  );
  assert.equal(ordered?.pending, 0);

  store.reserve(42);
  store.fail(42);
  assert.equal(store.get(42)?.pending, 0);

  const removed = store.remove(42, 200);
  assert.equal(removed?.path, '/tmp/b.pdf');
  assert.equal(store.get(42)?.files.length, 1);

  const cleared = store.clear(42);
  assert.equal(cleared?.userId, 42);
  assert.equal(cleared?.controller.signal.aborted, true);

  now += 2_000;
  assert.equal(store.get(42), null);
  assert.equal(store.activeCount(), 0);
  assert.equal(session.controller.signal.aborted, true);
});

test('merge session prune returns expired sessions and aborts their controllers', () => {
  let now = 1_000;
  const store = createMergeSessionStore({ ttlMs: 500, now: () => now });
  const session = store.start(7, 70);
  store.reserve(7);

  now += 1_000;
  const expired = store.prune();
  assert.equal(expired.length, 1);
  assert.equal(expired[0]?.userId, 7);
  assert.equal(session.controller.signal.aborted, true);
  assert.equal(store.activeCount(), 0);
});

test('menu exposes implemented workspace tools but no unimplemented placeholders', () => {
  const buttons = mainMenuKeyboard('en', config(), false, false).inline_keyboard.flat();
  const labels = buttons.map((button) => button.text);

  assert.equal(labels.includes('🆕 New PDF Workspace'), true);
  assert.equal(labels.includes('🧰 Available PDF Tools'), true);
  assert.equal(labels.includes('🌐 Language: বাংলা / English'), true);
  assert.equal(labels.includes('✨ Enhance PDF'), false);
  assert.equal(labels.includes('Compress PDF'), true);

  const help = helpText('en', config());
  assert.match(help, /Workspace: up to 10 files, 40 MB/);
  assert.match(help, /\/workspace/);
});
