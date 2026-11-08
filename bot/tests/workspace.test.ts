import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { PDFDocument, degrees } from 'pdf-lib';
import type { AppConfig } from '../src/config.js';
import { createLanguageStore, dictionaryFor, translate, translationKeys } from '../src/bot/i18n.js';
import { mainMenuKeyboard, mainMenuText } from '../src/bot/ui.js';
import { workspacePanel } from '../src/bot/workspace-views.js';
import { cleanupWorkspaceRun, runWorkspacePipeline } from '../src/workspace/run.js';
import {
  addOperation,
  simulateWorkspace,
  validateWorkspace,
} from '../src/workspace/operations.js';
import { applyPreset } from '../src/workspace/presets.js';
import { createWorkspaceStore } from '../src/workspace/store.js';
import { DEFAULT_NUP_SETTINGS } from '../src/pdf/nup.js';
import type { Workspace, WorkspaceFile, WorkspaceOperation } from '../src/workspace/types.js';

const globalScope = globalThis as typeof globalThis & {
  DOMMatrix?: typeof DOMMatrix;
  ImageData?: typeof ImageData;
  Path2D?: typeof Path2D;
};
globalScope.DOMMatrix ??= DOMMatrix;
globalScope.ImageData ??= ImageData;
globalScope.Path2D ??= Path2D;

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

async function pdfText(path: string): Promise<string> {
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
    let text = '';
    for (let index = 1; index <= doc.numPages; index += 1) {
      const page = await doc.getPage(index);
      const content = await page.getTextContent();
      text += content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ');
      text += '\n';
      page.cleanup();
    }
    return text;
  } finally {
    await task.destroy();
  }
}

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
    rasterMaxPixelsPerPage: 4_000_000,
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
  pageCount: number,
  size: [number, number] = [300, 400],
): Promise<{ path: string; name: string; pages: number; bytes: number }> {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    const page = doc.addPage(size);
    page.drawText(`Page ${index + 1} of ${name}`, { x: 24, y: size[1] - 40, size: 14 });
  }
  const path = join(dir, name);
  const bytes = await doc.save();
  await writeFile(path, bytes);
  return { path, name, pages: pageCount, bytes: bytes.length };
}

interface WorkspaceOptions {
  mode?: 'combine' | 'individual';
  operations?: WorkspaceOperation[];
}

function buildWorkspace(
  store: ReturnType<typeof createWorkspaceStore>,
  files: Array<{ path: string; name: string; pages: number; bytes: number }>,
  options: WorkspaceOptions = {},
): Workspace {
  const { workspace } = store.start(42, 420);
  workspace.mode = options.mode ?? 'combine';
  workspace.files = files.map((file, index): WorkspaceFile => ({
    id: `f${index + 1}`,
    fileUniqueId: `unique-${index + 1}`,
    path: file.path,
    name: file.name,
    sizeBytes: file.bytes,
    pages: file.pages,
    uploadedAt: Date.now(),
  }));
  workspace.nextFileSeq = files.length + 1;
  workspace.operations = options.operations ?? [];
  workspace.awaitingUpload = false;
  workspace.awaitingText = null;
  workspace.status = 'ready';
  workspace.nextOpSeq = workspace.operations.length + 1;
  return workspace;
}

function runOptions(dir: string) {
  return {
    tmpDir: dir,
    maxOutputBytes: 49 * 1024 * 1024,
    maxPages: 300,
    mergeMaxFiles: 10,
    rasterMaxPages: 30,
    rasterMaxPixelsPerPage: 4_000_000,
    timeoutMs: 60_000,
  };
}

test('Bengali and English dictionaries share keys, values, and placeholders', () => {
  const en = dictionaryFor('en');
  const bn = dictionaryFor('bn');

  for (const key of translationKeys()) {
    assert.ok(en[key].trim().length > 0, `missing English value for ${key}`);
    assert.ok(bn[key].trim().length > 0, `missing Bengali value for ${key}`);

    const placeholders = (value: string): string[] =>
      [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
    assert.deepEqual(
      placeholders(bn[key]),
      placeholders(en[key]),
      `placeholder mismatch for ${key}`,
    );
  }

  assert.equal(translate('bn', 'ws.btn.process'), dictionaryFor('bn')['ws.btn.process']);
  assert.match(translate('en', 'ws.upload.added', { name: 'a.pdf', pages: 2, size: '1 KB' }), /a\.pdf/);
});

test('language store infers from Telegram and expires old preferences', () => {
  let now = 1_000;
  const store = createLanguageStore({ ttlMs: 100, now: () => now });

  assert.equal(store.resolve(1, 'bn-BD'), 'bn');
  assert.equal(store.resolve(2, 'en-US'), 'en');
  assert.equal(store.resolve(3, undefined), 'bn');
  assert.equal(store.get(1), 'bn');

  store.set(1, 'en');
  assert.equal(store.resolve(1, 'bn-BD'), 'en');

  now += 50;
  assert.equal(store.resolve(4, 'fr'), 'bn');

  now += 200;
  assert.equal(store.get(1), null);
  assert.equal(store.prune(), 3);
  assert.equal(store.size(), 0);
});

test('workspace store expires sessions, aborts work, and warns once', () => {
  let now = 1_000;
  const store = createWorkspaceStore({ ttlMs: 1_000, now: () => now });
  const { workspace } = store.start(7, 70);

  now += 800;
  assert.deepEqual(store.expiringSoon(500), [workspace]);
  assert.deepEqual(store.expiringSoon(500), []);
  assert.equal(store.activeCount(), 1);

  now += 400;
  const expired = store.prune();
  assert.equal(expired.length, 1);
  assert.equal(expired[0]?.userId, 7);
  assert.equal(workspace.controller.signal.aborted, true);
  assert.equal(store.activeCount(), 0);
  assert.equal(store.get(7), null);
});

test('simulation rejects invalid reorder, ranges, empty selections, and missing text', () => {
  const store = createWorkspaceStore({ ttlMs: 60_000 });
  const dir = tmpdir();
  const workspace = buildWorkspace(store, [
    { path: join(dir, 'unused.pdf'), name: 'a.pdf', pages: 4, bytes: 100 },
  ]);
  const limits = { maxPages: 300, rasterMaxPages: 30, mergeMaxFiles: 10 };

  workspace.operations = [{ id: 'o1', type: 'reorder', indices: [0, 0, 1, 2] }];
  const reorder = validateWorkspace(workspace, limits);
  assert.equal(reorder.ok, false);
  assert.equal(reorder.ok ? '' : reorder.issue.code, 'reorderMismatch');

  workspace.operations = [{ id: 'o1', type: 'select', mode: 'keep', indices: [0, 1, 2, 9] }];
  const range = validateWorkspace(workspace, limits);
  assert.equal(range.ok, false);
  assert.equal(range.ok ? '' : range.issue.code, 'pageRangeMax');

  workspace.operations = [
    { id: 'o1', type: 'select', mode: 'keep', indices: [0, 1, 2, 3] },
    { id: 'o2', type: 'select', mode: 'remove', indices: [0, 1, 2, 3] },
  ];
  const empty = validateWorkspace(workspace, limits);
  assert.equal(empty.ok, false);
  assert.equal(empty.ok ? '' : empty.issue.code, 'emptyResult');

  workspace.operations = [
    {
      id: 'o1',
      type: 'watermark',
      text: '',
      size: 40,
      opacity: 0.25,
      rotation: 45,
      position: 'center',
      scope: 'all',
    },
  ];
  const text = validateWorkspace(workspace, limits);
  assert.equal(text.ok, false);
  assert.equal(text.ok ? '' : text.issue.code, 'textRequired');

  workspace.operations = [
    { id: 'o1', type: 'metadata', title: '', author: '', subject: '', keywords: '' },
  ];
  const metadata = validateWorkspace(workspace, limits);
  assert.equal(metadata.ok, false);
  assert.equal(metadata.ok ? '' : metadata.issue.code, 'metadataEmpty');

  workspace.operations = [
    {
      id: 'o1',
      type: 'footer',
      text: '',
      pageNumbers: false,
      timestamp: false,
      position: 'center',
      size: 10,
    },
  ];
  const footer = validateWorkspace(workspace, limits);
  assert.equal(footer.ok, false);
  assert.equal(footer.ok ? '' : footer.issue.code, 'footerEmpty');

  workspace.operations = [
    {
      id: 'o1',
      type: 'watermark',
      text: 'গোপনীয়',
      size: 40,
      opacity: 0.25,
      rotation: 45,
      position: 'center',
      scope: 'all',
    },
  ];
  const bengali = validateWorkspace(workspace, limits);
  assert.equal(bengali.ok, false);
  assert.equal(bengali.ok ? '' : bengali.issue.code, 'unsupportedText');
});

test('combine pipeline merges inputs and applies organization, watermark, metadata, and footers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-workspace-'));
  const store = createWorkspaceStore({ ttlMs: 60_000 });
  try {
    const first = await makePdf(dir, 'lecture.pdf', 3);
    const second = await makePdf(dir, 'notes.pdf', 2);
    const workspace = buildWorkspace(store, [first, second], {
      mode: 'combine',
      operations: [
        { id: 'o1', type: 'rotate', angle: 90, scope: 'all' },
        { id: 'o2', type: 'select', mode: 'keep', indices: [0, 2, 4] },
        {
          id: 'o3',
          type: 'metadata',
          title: 'Merged Notes',
          author: 'NoteSprint',
          subject: 'Workspace',
          keywords: 'pdf, notes',
        },
        {
          id: 'o4',
          type: 'watermark',
          text: 'CONFIDENTIAL',
          size: 40,
          opacity: 0.25,
          rotation: 45,
          position: 'center',
          scope: 'all',
        },
        { id: 'o5', type: 'timestamp', customText: '' },
        {
          id: 'o6',
          type: 'footer',
          text: 'Lecture notes',
          pageNumbers: true,
          timestamp: false,
          position: 'center',
          size: 10,
        },
      ],
    });

    const simulation = simulateWorkspace(workspace, {
      maxPages: 300,
      rasterMaxPages: 30,
      mergeMaxFiles: 10,
    });
    assert.equal(simulation.stages.length, 6);
    assert.equal(simulation.finalFiles.length, 1);
    assert.equal(simulation.finalFiles[0]?.pages, 3);

    const result = await runWorkspacePipeline(workspace, runOptions(dir));
    try {
      assert.equal(result.zip, false);
      assert.equal(result.outputs.length, 1);
      assert.equal(result.totalPages, 3);
      assert.equal(result.outputName.endsWith('.pdf'), true);

      const output = await readFile(result.outputPath);
      const doc = await PDFDocument.load(output);
      assert.equal(doc.getPageCount(), 3);
      assert.equal(doc.getTitle(), 'Merged Notes');
      assert.equal(doc.getAuthor(), 'NoteSprint');
      assert.equal(doc.getSubject(), 'Workspace');
      assert.equal(doc.getKeywords(), 'pdf notes');
      for (const page of doc.getPages()) {
        assert.equal(page.getRotation().angle, 90);
        assert.ok(page.getHeight() > 400, 'footer band should extend the page');
      }

      const text = await pdfText(result.outputPath);
      assert.match(text, /CONFIDENTIAL/);
      assert.match(text, /Processed by NoteSprint/);
      assert.match(text, /BST/);
      assert.match(text, /Lecture notes/);
      assert.match(text, /1 \/ 3/);
    } finally {
      await cleanupWorkspaceRun(result);
    }
    await assert.rejects(stat(result.workDir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('individual split produces one PDF per page and packages multiple results as ZIP', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-workspace-'));
  const store = createWorkspaceStore({ ttlMs: 60_000 });
  try {
    const first = await makePdf(dir, 'alpha.pdf', 2);
    const second = await makePdf(dir, 'beta.pdf', 2);
    const workspace = buildWorkspace(store, [first, second], {
      mode: 'individual',
      operations: [{ id: 'o1', type: 'split', mode: 'every' }],
    });

    const simulation = simulateWorkspace(workspace, {
      maxPages: 300,
      rasterMaxPages: 30,
      mergeMaxFiles: 10,
    });
    assert.deepEqual(
      simulation.finalFiles.map((file) => file.name),
      ['alpha-page-1', 'alpha-page-2', 'beta-page-1', 'beta-page-2'],
    );
    assert.ok(simulation.warnings.some((warning) => warning.key === 'ws.review.individualZip'));

    const result = await runWorkspacePipeline(workspace, runOptions(dir));
    try {
      assert.equal(result.zip, true);
      assert.equal(result.outputs.length, 4);
      assert.equal(result.totalPages, 4);
      assert.match(result.outputName, /\.zip$/);
      assert.deepEqual(
        [...result.outputs].map((output) => output.name).sort(),
        ['alpha-page-1.pdf', 'alpha-page-2.pdf', 'beta-page-1.pdf', 'beta-page-2.pdf'],
      );

      const zipBytes = await readFile(result.outputPath);
      assert.equal(zipBytes.subarray(0, 4).toString('binary'), 'PK\u0003\u0004');
      assert.ok(zipBytes.length > 100);

      for (const output of result.outputs) {
        const doc = await PDFDocument.load(await readFile(output.path));
        assert.equal(doc.getPageCount(), 1);
      }
    } finally {
      await cleanupWorkspaceRun(result);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('raster and N-up operations respect page counts in a pipeline', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-workspace-'));
  const store = createWorkspaceStore({ ttlMs: 60_000 });
  try {
    const input = await makePdf(dir, 'scan.pdf', 3);
    const workspace = buildWorkspace(store, [input], {
      mode: 'combine',
      operations: [
        { id: 'o1', type: 'gray', quality: 'low' },
        { id: 'o2', type: 'nup', settings: { ...DEFAULT_NUP_SETTINGS, perPage: 2 } },
      ],
    });

    const simulation = simulateWorkspace(workspace, {
      maxPages: 300,
      rasterMaxPages: 30,
      mergeMaxFiles: 10,
    });
    assert.equal(simulation.finalFiles[0]?.pages, 2);

    const result = await runWorkspacePipeline(workspace, runOptions(dir));
    try {
      assert.equal(result.outputs.length, 1);
      const doc = await PDFDocument.load(await readFile(result.outputPath));
      assert.equal(doc.getPageCount(), 2);
    } finally {
      await cleanupWorkspaceRun(result);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('presets replace operations but keep uploaded files editable', () => {
  const store = createWorkspaceStore({ ttlMs: 60_000 });
  const workspace = buildWorkspace(store, [
    { path: join(tmpdir(), 'unused.pdf'), name: 'a.pdf', pages: 8, bytes: 100 },
  ]);

  workspace.operations = [{ id: 'o1', type: 'rotate', angle: 90, scope: 'all' }];
  const operations = applyPreset(workspace, 'paper');

  assert.equal(workspace.files.length, 1);
  assert.equal(operations.length, 2);
  assert.equal(operations[0]?.type, 'bw');
  assert.equal(operations[1]?.type, 'nup');
  assert.equal(operations[0]?.id, 'o1');
  assert.equal(workspace.operations[1]?.id, 'o2');
  assert.equal(workspace.awaitingText, null);

  const simulation = simulateWorkspace(workspace, {
    maxPages: 300,
    rasterMaxPages: 30,
    mergeMaxFiles: 10,
  });
  assert.equal(simulation.finalFiles[0]?.pages, 2);
});

test('workspace UI renders bilingual status, controls, and operation configuration', () => {
  const store = createWorkspaceStore({ ttlMs: 60_000 });
  const appConfig = config();
  const workspace = buildWorkspace(store, [
    { path: join(tmpdir(), 'unused.pdf'), name: 'a.pdf', pages: 4, bytes: 2_048 },
  ]);
  workspace.operations = [];
  addOperation(workspace, 'split');
  addOperation(workspace, 'watermark');
  workspace.operations[1] = {
    id: 'o2',
    type: 'watermark',
    text: 'DRAFT',
    size: 40,
    opacity: 0.25,
    rotation: 45,
    position: 'center',
    scope: 'all',
  };

  const english = workspacePanel('en', workspace, appConfig);
  assert.match(english.text, /PDF Workspace/);
  assert.match(english.text, /Files: 1 · Pages: 4/);
  assert.match(english.text, /Steps \(2\)/);
  assert.match(english.text, /Watermark: DRAFT/);
  const callbacks = english.keyboard.inline_keyboard.flat().map((button) => ('callback_data' in button ? button.callback_data : ''));
  assert.ok(callbacks.includes('ws:run'));
  assert.ok(callbacks.includes('ws:more'));
  assert.ok(callbacks.includes('ws:presets'));

  const bengali = workspacePanel('bn', workspace, appConfig);
  assert.match(bengali.text, /ধাপ \(2\)/);
  assert.match(bengali.text, /ওয়াটারমার্ক: DRAFT/);
  const bengaliButtons = bengali.keyboard.inline_keyboard.flat();
  assert.ok(bengaliButtons.some((button) => button.text.includes('Process Now')));

  const menuText = mainMenuText('bn', 'Rahim', workspace);
  assert.match(menuText, /সক্রিয় workspace: 1টি ফাইল, 2টি ধাপ/);
  const menu = mainMenuKeyboard('bn', appConfig, false, true).inline_keyboard.flat();
  assert.ok(menu.some((button) => button.text === '📂 PDF প্রসেসিং চালিয়ে যান'));
});

test('pipeline cleanup removes intermediates and cancellation aborts before delivery', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-workspace-'));
  const store = createWorkspaceStore({ ttlMs: 60_000 });
  try {
    const input = await makePdf(dir, 'cancel.pdf', 2);
    const workspace = buildWorkspace(store, [input], {
      mode: 'combine',
      operations: [{ id: 'o1', type: 'rotate', angle: 180, scope: 'all' }],
    });

    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      runWorkspacePipeline(workspace, {
        ...runOptions(dir),
        signal: controller.signal,
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'cancelled');
        return true;
      },
    );

    const original = await PDFDocument.load(await readFile(input.path));
    assert.equal(original.getPageCount(), 2);
    assert.equal(original.getPages()[0]?.getRotation().angle, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
