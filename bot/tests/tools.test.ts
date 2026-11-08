import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InlineKeyboard } from 'grammy';
import { PDFDocument, degrees } from 'pdf-lib';
import type { AppConfig } from '../src/config.js';
import { FileHandlingError } from '../src/files/errors.js';
import { createTempWorkDir } from '../src/files/paths.js';
import { createToolSessionStore } from '../src/files/tool-session.js';
import type { ToolSession, ToolSettings } from '../src/files/tool-session.js';
import { cleanupToolSession } from '../src/bot/handlers/tools.js';
import { mainMenuKeyboard, colorToolsKeyboard } from '../src/bot/ui.js';
import {
  inputPromptKeyboard,
  inputPromptText,
  toolErrorKeyboard,
  toolPanel,
  toolResultKeyboard,
  toolUploadKeyboard,
  toolUploadText,
} from '../src/bot/tool-views.js';
import { TOOL_DEFINITIONS, TOOL_IDS, isToolId } from '../src/tools/definitions.js';
import type { ToolId } from '../src/tools/definitions.js';
import { runTool } from '../src/tools/run.js';
import type { RunToolOptions } from '../src/tools/run.js';
import { DEFAULT_NUP_SETTINGS } from '../src/pdf/nup.js';

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

function makeSession(
  filePath: string,
  pages: number,
  tool: ToolId,
  settings: ToolSettings,
): ToolSession {
  return {
    userId: 1,
    chatId: 2,
    tool,
    filePath,
    fileName: 'input.pdf',
    sizeBytes: 1024,
    pages,
    uploading: false,
    settings,
    controller: new AbortController(),
    createdAt: 0,
    updatedAt: 0,
  };
}

function runOptions(outputPath: string, overrides: Partial<RunToolOptions> = {}): RunToolOptions {
  return {
    tmpDir: join(tmpdir(), 'notesprint-tools'),
    outputPath,
    maxOutputBytes: MAX_OUTPUT,
    maxPages: 300,
    rasterMaxPages: 30,
    rasterMaxPixelsPerPage: 4_000_000,
    timeoutMs: 30_000,
    ...overrides,
  };
}

async function pageSizes(path: string): Promise<Array<[number, number]>> {
  const doc = await PDFDocument.load(await readFile(path));
  return doc
    .getPages()
    .map((page) => page.getSize())
    .map((size) => [Math.round(size.width), Math.round(size.height)]);
}

async function pageRotations(path: string): Promise<number[]> {
  const doc = await PDFDocument.load(await readFile(path));
  return doc.getPages().map((page) => page.getRotation().angle);
}

function errorCode(error: unknown): string | undefined {
  return error instanceof FileHandlingError ? error.code : undefined;
}

function callbackData(keyboard: InlineKeyboard): string[] {
  return keyboard.inline_keyboard
    .flat()
    .map((button) => ('callback_data' in button ? button.callback_data : undefined))
    .filter((value): value is string => Boolean(value));
}

test('tool session store isolates users, expires, and aborts controllers', () => {
  let now = 1000;
  const store = createToolSessionStore({ ttlMs: 500, now: () => now });

  const first = store.start(1, 10, 'split');
  assert.equal(first.previous, null);
  assert.equal(store.activeCount(), 1);
  assert.equal(store.get(1), first.session);

  now += 300;
  store.touch(1);
  now += 300;
  assert.equal(store.get(1), first.session, 'touch should extend the session');

  const second = store.start(1, 10, 'nup');
  assert.equal(second.previous, first.session);
  assert.equal(first.session.controller.signal.aborted, true);

  assert.equal(store.activeCount(), 1);
  assert.equal(store.get(1), second.session);

  now += 600;
  assert.equal(store.get(1), null);
  assert.equal(second.session.controller.signal.aborted, true);

  const expired = store.prune();
  assert.equal(expired.length, 1);
  assert.equal(expired[0], second.session);

  const third = store.start(2, 20, 'rotate');
  assert.equal(store.clear(2), third.session);
  assert.equal(third.session.controller.signal.aborted, true);
  assert.equal(store.activeCount(), 0);
});

test('cleanupToolSession removes the temporary file once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-tools-'));
  const logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
  } as never;
  try {
    const input = await makePdf(dir, 'input.pdf', [[100, 200]]);
    const session = makeSession(input, 1, 'split', {});
    await cleanupToolSession(session, logger);
    await assert.rejects(stat(input));
    await cleanupToolSession(session, logger);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runTool extracts, selects, reorders, and rotates pages', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-tools-'));
  try {
    const input = await makePdf(dir, 'input.pdf', [
      [100, 200],
      [101, 201],
      [102, 202],
      [103, 203],
      [104, 204],
    ]);

    const extracted = join(dir, 'extract.pdf');
    const extractResult = await runTool(
      makeSession(input, 5, 'split', { mode: 'extract', indices: [4, 0, 2] }),
      runOptions(extracted),
    );
    assert.equal(extractResult.pages, 3);
    assert.equal(extractResult.zip, false);
    assert.deepEqual(await pageSizes(extracted), [
      [104, 204],
      [100, 200],
      [102, 202],
    ]);

    const kept = join(dir, 'kept.pdf');
    await runTool(
      makeSession(input, 5, 'select', { mode: 'keep', indices: [2, 0, 4] }),
      runOptions(kept),
    );
    assert.deepEqual(await pageSizes(kept), [
      [100, 200],
      [102, 202],
      [104, 204],
    ]);

    const removed = join(dir, 'removed.pdf');
    await runTool(
      makeSession(input, 5, 'select', { mode: 'remove', indices: [0, 1, 2, 3] }),
      runOptions(removed),
    );
    assert.deepEqual(await pageSizes(removed), [[104, 204]]);

    const reordered = join(dir, 'reordered.pdf');
    await runTool(
      makeSession(input, 5, 'reorder', { indices: [2, 0, 1, 4, 3] }),
      runOptions(reordered),
    );
    assert.deepEqual(await pageSizes(reordered), [
      [102, 202],
      [100, 200],
      [101, 201],
      [104, 204],
      [103, 203],
    ]);

    const rotated = join(dir, 'rotated.pdf');
    await runTool(
      makeSession(input, 5, 'rotate', { angle: 90, scope: 'selected', indices: [1, 3] }),
      runOptions(rotated),
    );
    assert.deepEqual(await pageRotations(rotated), [0, 90, 0, 90, 0]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runTool splits into ZIP output and rejects removing every page', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-tools-'));
  try {
    const input = await makePdf(dir, 'input.pdf', [
      [100, 200],
      [101, 201],
      [102, 202],
      [103, 203],
      [104, 204],
    ]);

    const zipPath = join(dir, 'split.zip');
    const result = await runTool(
      makeSession(input, 5, 'split', { mode: 'groups', groupSize: 2 }),
      runOptions(zipPath),
    );
    assert.equal(result.zip, true);
    assert.equal(result.fileCount, 3);
    assert.equal(result.outputName, 'notesprint-split.zip');
    const bytes = await readFile(zipPath);
    assert.equal(bytes.subarray(0, 4).toString('latin1'), 'PK\x03\x04');

    await assert.rejects(
      runTool(
        makeSession(input, 5, 'select', { mode: 'remove', indices: [0, 1, 2, 3, 4] }),
        runOptions(join(dir, 'empty.pdf')),
      ),
      (error) => {
        assert.equal(errorCode(error), 'empty_selection');
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runTool requires complete settings', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-tools-'));
  try {
    const input = await makePdf(dir, 'input.pdf', [[100, 200]]);

    await assert.rejects(
      runTool(makeSession(input, 1, 'split', {}), runOptions(join(dir, 'out.pdf'))),
      (error) => {
        assert.equal(errorCode(error), 'process_failed');
        return true;
      },
    );

    await assert.rejects(
      runTool(
        makeSession(input, 1, 'split', { mode: 'extract' }),
        runOptions(join(dir, 'out.pdf')),
      ),
      (error) => {
        assert.equal(errorCode(error), 'empty_selection');
        return true;
      },
    );

    await assert.rejects(
      runTool(makeSession(input, 1, 'rotate', { angle: 90 }), runOptions(join(dir, 'out.pdf'))),
      (error) => {
        assert.equal(errorCode(error), 'process_failed');
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runTool builds N-up sheets and converts to grayscale', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-tools-'));
  try {
    const input = await makePdf(dir, 'input.pdf', [
      [300, 200],
      [300, 200],
      [300, 200],
      [300, 200],
      [300, 200],
    ]);

    const nup = join(dir, 'nup.pdf');
    const nupResult = await runTool(
      makeSession(input, 5, 'nup', {
        nup: { ...DEFAULT_NUP_SETTINGS, orientation: 'portrait' },
      }),
      runOptions(nup, { maxPages: 300 }),
    );
    assert.equal(nupResult.pages, 5);
    assert.equal(nupResult.detail.includes('2 sheets'), true);
    assert.equal((await pageSizes(nup)).length, 2);
    assert.deepEqual(await pageSizes(nup), [
      [595, 842],
      [595, 842],
    ]);

    const gray = join(dir, 'gray.pdf');
    const grayResult = await runTool(
      makeSession(input, 5, 'gray', { quality: 'low' }),
      runOptions(gray, { rasterMaxPages: 30 }),
    );
    assert.equal(grayResult.pages, 5);
    assert.equal(grayResult.detail.includes('100 DPI'), true);
    assert.deepEqual(await pageSizes(gray), [
      [300, 200],
      [300, 200],
      [300, 200],
      [300, 200],
      [300, 200],
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('raster limits tighten with quality and for black and white', async () => {
  const appConfig = config();

  const bwHigh = makeSession('x.pdf', 9, 'bw', {
    quality: 'high',
    threshold: 'balanced',
  });
  const bwPanel = toolPanel(bwHigh, appConfig);
  assert.ok(bwPanel.text.includes('Limit: 8 at high quality'));
  assert.ok(bwPanel.text.includes('Choose a lower quality'));

  const bwAllowed = makeSession('x.pdf', 8, 'bw', { quality: 'high' });
  assert.equal(toolPanel(bwAllowed, appConfig).text.includes('⚠️'), false);

  const dir = await mkdtemp(join(tmpdir(), 'notesprint-tools-'));
  try {
    const input = await makePdf(
      dir,
      'many.pdf',
      Array.from({ length: 13 }, (_, index) => [100 + index, 200 + index]),
    );
    await assert.rejects(
      runTool(
        makeSession(input, 13, 'gray', { quality: 'high' }),
        runOptions(join(dir, 'too-many.pdf')),
      ),
      (error) => {
        assert.equal(errorCode(error), 'raster_page_limit');
        assert.match(String((error as FileHandlingError).message), /12 pages at high quality/);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runTool enforces the raster page limit and output size', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-tools-'));
  const workDir = await createTempWorkDir(join(tmpdir(), 'notesprint-tools'));
  try {
    const input = await makePdf(dir, 'input.pdf', [
      [100, 200],
      [101, 201],
    ]);

    await assert.rejects(
      runTool(
        makeSession(input, 2, 'invert', { quality: 'low' }),
        runOptions(join(dir, 'limited.pdf'), { rasterMaxPages: 1 }),
      ),
      (error) => {
        assert.equal(errorCode(error), 'raster_page_limit');
        return true;
      },
    );

    await assert.rejects(
      runTool(
        makeSession(input, 2, 'split', { mode: 'every' }),
        runOptions(join(workDir, 'small.zip'), { maxOutputBytes: 200 }),
      ),
      (error) => {
        assert.equal(errorCode(error), 'output_too_large');
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
  }
});

test('every advertised tool is defined and the menu exposes it', () => {
  assert.deepEqual([...TOOL_IDS].sort(), [
    'bw',
    'clear',
    'gray',
    'invert',
    'nup',
    'reorder',
    'rotate',
    'select',
    'split',
  ]);
  for (const tool of TOOL_IDS) {
    assert.equal(TOOL_DEFINITIONS[tool].id, tool);
    assert.equal(isToolId(tool), true);
  }
  assert.equal(isToolId('process'), false);

  const menu = callbackData(mainMenuKeyboard('en', config(), false, false));
  for (const action of ['menu:new', 'menu:tools', 'menu:language'] as const) {
    assert.ok(menu.includes(action), `menu should contain ${action}`);
  }
  const colourMenu = callbackData(colorToolsKeyboard());
  for (const tool of ['gray', 'bw', 'invert', 'clear'] as const) {
    assert.ok(colourMenu.includes(`tool:${tool}`), `colour menu should contain tool:${tool}`);
  }
  assert.ok(menu.includes('admin:home') === false, 'regular users must not see admin');
  assert.ok(callbackData(mainMenuKeyboard('en', config(), true, false)).includes('admin:home'));
});

test('split, selection, reorder, and rotate panels expose the expected actions', () => {
  const appConfig = config();
  const split = makeSession('x.pdf', 5, 'split', {});
  const splitMenu = toolPanel(split, appConfig);
  assert.ok(splitMenu.text.includes('Choose how to split'));
  const splitActions = callbackData(splitMenu.keyboard);
  assert.ok(splitActions.includes('ts:split:extract'));
  assert.ok(splitActions.includes('ts:split:every'));
  assert.ok(splitActions.includes('ts:split:groups'));

  const extract = makeSession('x.pdf', 5, 'split', {
    mode: 'extract',
    indices: [0, 1, 2, 4],
  });
  const extractPanel = toolPanel(extract, appConfig);
  assert.ok(extractPanel.text.includes('Selected: 1, 2, 3, 5'));
  assert.ok(callbackData(extractPanel.keyboard).includes('ts:go'));

  const selection = makeSession('x.pdf', 5, 'select', { mode: 'keep' });
  assert.ok(toolPanel(selection, appConfig).text.includes('Send the pages to keep'));
  selection.settings.indices = [1, 3];
  const selectionPanel = toolPanel(selection, appConfig);
  assert.ok(selectionPanel.text.includes('Result: 2 pages'));
  assert.ok(callbackData(selectionPanel.keyboard).includes('ts:go'));

  const reorder = makeSession('x.pdf', 5, 'reorder', {});
  assert.ok(toolPanel(reorder, appConfig).text.includes('Send the new page order'));
  reorder.settings.indices = [2, 0, 1, 4, 3];
  assert.ok(toolPanel(reorder, appConfig).text.includes('New order: 3, 1, 2, 5, 4'));

  const rotate = makeSession('x.pdf', 5, 'rotate', {});
  assert.ok(toolPanel(rotate, appConfig).text.includes('Choose a rotation'));
  rotate.settings.angle = 90;
  assert.ok(toolPanel(rotate, appConfig).text.includes('every page or selected pages'));
  rotate.settings.scope = 'selected';
  const rotatePrompt = toolPanel(rotate, appConfig);
  assert.ok(rotatePrompt.text.includes('Send the pages to rotate'));
  rotate.settings.indices = [0, 2];
  assert.ok(callbackData(toolPanel(rotate, appConfig).keyboard).includes('ts:go'));
});

test('colour and N-up panels expose presets and limits', () => {
  const appConfig = config({ rasterMaxPages: 12 });

  const gray = makeSession('x.pdf', 5, 'gray', { quality: 'medium' });
  const grayPanel = toolPanel(gray, appConfig);
  assert.ok(grayPanel.text.includes('Limit: 12'));
  assert.ok(grayPanel.text.includes('150 DPI'));
  assert.ok(callbackData(grayPanel.keyboard).includes('ts:q:high'));

  const bw = makeSession('x.pdf', 5, 'bw', { quality: 'medium', threshold: 'strong' });
  const bwPanel = toolPanel(bw, appConfig);
  assert.ok(bwPanel.text.includes('Threshold: strong (160)'));
  const bwActions = callbackData(bwPanel.keyboard);
  assert.ok(bwActions.includes('ts:thr:light'));
  assert.ok(bwActions.includes('ts:thr:balanced'));
  assert.ok(bwActions.includes('ts:thr:strong'));

  const clear = makeSession('x.pdf', 5, 'clear', { quality: 'low', clearLevel: 'high' });
  const clearPanel = toolPanel(clear, appConfig);
  assert.ok(clearPanel.text.includes('Cleanup: high (threshold 195)'));
  assert.ok(callbackData(clearPanel.keyboard).includes('ts:clear:medium'));

  const nup = makeSession('x.pdf', 5, 'nup', { nup: { ...DEFAULT_NUP_SETTINGS } });
  const nupPanel = toolPanel(nup, appConfig);
  const nupActions = callbackData(nupPanel.keyboard);
  assert.ok(nupPanel.text.includes('Output: 2 sheets'));
  assert.ok(nupActions.includes('ts:nup:2'));
  assert.ok(nupActions.includes('ts:nup:9'));
  assert.ok(nupActions.includes('ts:paper:legal'));
  assert.ok(nupActions.includes('ts:orient:auto'));
  assert.ok(nupActions.includes('ts:margin:wide'));
  assert.ok(nupActions.includes('ts:sep:on'));
  assert.ok(nupActions.includes('ts:num:on'));
  assert.ok(nupActions.includes('ts:go'));

  nup.settings.nup = {
    ...nup.settings.nup!,
    pageNumbers: true,
    numberPosition: 'top-center',
    numberSize: 12,
    numberStart: 3,
  };
  const numbered = toolPanel(nup, appConfig);
  assert.ok(numbered.text.includes('Page numbers: on · start 3 · top center · 12 pt'));
  assert.ok(callbackData(numbered.keyboard).includes('ts:numstart:prompt'));
  assert.ok(callbackData(numbered.keyboard).includes('ts:numpos:top-center'));
});

test('tool prompts, upload text, and result keyboards are wired', () => {
  const appConfig = config();
  const split = makeSession('x.pdf', 5, 'split', { awaiting: 'ranges' });
  assert.ok(inputPromptText(split).includes('1-5, 8, 10-15'));
  assert.ok(callbackData(inputPromptKeyboard(split)).includes('ts:cancel'));

  const groups = makeSession('x.pdf', 5, 'split', { awaiting: 'group-size' });
  const groupActions = callbackData(inputPromptKeyboard(groups));
  assert.ok(groupActions.includes('ts:groupsize:2'));
  assert.ok(groupActions.includes('ts:groupsize:5'));
  assert.ok(groupActions.includes('ts:groupsize:10') === false);

  assert.ok(toolUploadText(TOOL_DEFINITIONS.gray, 19, 30).includes('limited to 30 pages'));
  assert.ok(toolUploadText(TOOL_DEFINITIONS.split, 19, 30).includes('deleted immediately'));
  assert.ok(callbackData(toolUploadKeyboard()).includes('ts:cancel'));

  assert.ok(callbackData(toolResultKeyboard('split')).includes('ts:retry:split'));
  assert.ok(callbackData(toolErrorKeyboard('nup')).includes('ts:retry:nup'));
  assert.ok(inputPromptText(makeSession('x.pdf', 1, 'rotate', { awaiting: 'number-start' })).includes('first sheet number'));
  assert.ok(toolPanel(makeSession('x.pdf', 1, 'nup', { nup: undefined }), appConfig).text.includes('unavailable'));
});
