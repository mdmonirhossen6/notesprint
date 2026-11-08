import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { AppConfig } from '../src/config.js';
import { createLanguageStore } from '../src/bot/i18n.js';
import { mainMenuKeyboard, helpKeyboard, tutorialKeyboard, tutorialText } from '../src/bot/ui.js';
import {
  advancedToolsPanel,
  cancelConfirmPanel,
  compressionPanel,
  customSettingsPanel,
  fileActionsPanel,
  languagePanel,
  modePanel,
  moreOptionsPanel,
  operationConfigPanel,
  operationsCatalogPanel,
  presetSummaryPanel,
  presetsPanel,
  replacePromptPanel,
  workspaceFilesPanel,
  workspaceOperationsPanel,
  workspacePanel,
} from '../src/bot/workspace-views.js';
import type { Panel } from '../src/bot/workspace-views.js';
import { addOperation } from '../src/workspace/operations.js';
import {
  PRESETS,
  applyPreset,
  applyPresetCustomization,
  readPresetSettings,
} from '../src/workspace/presets.js';
import { createWorkspaceStore } from '../src/workspace/store.js';
import { createTutorialStore } from '../src/bot/tutorial.js';
import type { PresetId, Workspace, WorkspaceFile } from '../src/workspace/types.js';

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

function buildWorkspace(pageCounts: number[] = [8]): Workspace {
  const store = createWorkspaceStore({ ttlMs: 60_000 });
  const { workspace } = store.start(42, 420);
  workspace.files = pageCounts.map(
    (pages, index): WorkspaceFile => ({
      id: `f${index + 1}`,
      fileUniqueId: `unique-${index + 1}`,
      path: join(tmpdir(), `notesprint-ux-${index + 1}.pdf`),
      name: `file-${index + 1}.pdf`,
      sizeBytes: 100 * (index + 1),
      pages,
      uploadedAt: Date.now(),
    }),
  );
  workspace.nextFileSeq = pageCounts.length + 1;
  workspace.awaitingUpload = false;
  workspace.awaitingText = null;
  workspace.status = 'ready';
  workspace.nextOpSeq = 1;
  return workspace;
}

function callbacks(panel: Panel): string[] {
  return panel.keyboard.inline_keyboard
    .flat()
    .flatMap((button) => ('callback_data' in button && button.callback_data ? [button.callback_data] : []));
}

function buttonLabels(panel: Panel): string[] {
  return panel.keyboard.inline_keyboard.flat().map((button) => button.text);
}

test('the four presets map to the promised one-tap workflows', () => {
  const paper = buildWorkspace();
  applyPreset(paper, 'paper');
  assert.equal(paper.operations.length, 2);
  assert.equal(paper.operations[0]?.type, 'bw');
  const paperNup = paper.operations[1];
  assert.equal(paperNup?.type, 'nup');
  if (paperNup?.type !== 'nup') throw new Error('missing nup');
  assert.equal(paperNup.settings.perPage, 4);
  assert.equal(paperNup.settings.paper, 'a4');
  assert.equal(paperNup.settings.orientation, 'portrait');
  assert.equal(paperNup.settings.margin, 'normal');
  assert.equal(paperNup.settings.separators, false);
  assert.equal(paperNup.settings.pageNumbers, false);

  const compact = buildWorkspace();
  applyPreset(compact, 'compact');
  assert.equal(compact.operations[0]?.type, 'gray');
  const compactNup = compact.operations[1];
  if (compactNup?.type !== 'nup') throw new Error('missing nup');
  assert.equal(compactNup.settings.perPage, 4);
  assert.equal(compactNup.settings.orientation, 'landscape');
  assert.equal(compactNup.settings.margin, 'compact');

  const presentation = buildWorkspace();
  applyPreset(presentation, 'presentation');
  assert.equal(presentation.operations.length, 1);
  const presentationNup = presentation.operations[0];
  if (presentationNup?.type !== 'nup') throw new Error('missing nup');
  assert.equal(presentationNup.settings.perPage, 2);
  assert.equal(presentationNup.settings.orientation, 'landscape');
  assert.equal(presentationNup.settings.separators, true);
  assert.equal(presentationNup.settings.pageNumbers, true);

  const original = buildWorkspace([3, 4]);
  applyPreset(original, 'original');
  assert.deepEqual(original.operations, []);
  assert.equal(original.mode, 'combine');
  assert.equal(original.presetId, 'original');

  for (const id of Object.keys(PRESETS) as PresetId[]) {
    assert.ok(PRESETS[id].labelKey.length > 0);
    assert.ok(PRESETS[id].descriptionKey.length > 0);
    assert.equal(typeof PRESETS[id].build, 'function');
  }
});

test('presets and custom settings never drop uploaded PDFs', () => {
  const workspace = buildWorkspace([4, 6]);
  workspace.mode = 'individual';
  workspace.operations = [{ id: 'o1', type: 'rotate', angle: 90, scope: 'all' }];
  const filesBefore = workspace.files.map((file) => ({ ...file }));

  applyPreset(workspace, 'paper');
  assert.deepEqual(workspace.files, filesBefore);
  assert.equal(workspace.mode, 'combine');
  assert.equal(workspace.presetId, 'paper');
  assert.equal(workspace.operations.length, 2);

  assert.equal(applyPresetCustomization(workspace, 'color:gray'), true);
  assert.equal(applyPresetCustomization(workspace, 'layout:2'), true);
  assert.equal(applyPresetCustomization(workspace, 'paper:a3'), true);
  assert.equal(applyPresetCustomization(workspace, 'orientation:landscape'), true);
  assert.equal(applyPresetCustomization(workspace, 'margin:wide'), true);
  assert.equal(applyPresetCustomization(workspace, 'sep:1'), true);
  assert.equal(applyPresetCustomization(workspace, 'pn:1'), true);

  assert.deepEqual(workspace.files, filesBefore);
  assert.deepEqual(readPresetSettings(workspace), {
    color: 'gray',
    perPage: 2,
    paper: 'a3',
    orientation: 'landscape',
    margin: 'wide',
    separators: true,
    pageNumbers: true,
  });
  assert.deepEqual(
    workspace.operations.map((operation) => operation.type),
    ['gray', 'nup'],
  );

  assert.equal(applyPresetCustomization(workspace, 'color:rainbow'), false);
  assert.equal(applyPresetCustomization(workspace, 'layout:3'), false);
  assert.equal(applyPresetCustomization(workspace, 'unknown:1'), false);
  assert.deepEqual(workspace.files, filesBefore);
  assert.equal(readPresetSettings(workspace).color, 'gray');
});

test('preset summary shows readable settings, Process Now, and customization', () => {
  const appConfig = config();
  const workspace = buildWorkspace([8]);
  applyPreset(workspace, 'paper');

  const summary = presetSummaryPanel('en', workspace, appConfig);
  assert.equal(summary.ok, true);
  assert.match(summary.panel.text, /Save Paper & Ink selected/);
  assert.match(summary.panel.text, /Input: 1 file\(s\) · 8 pages/);
  assert.match(summary.panel.text, /Color: Black & White/);
  assert.match(summary.panel.text, /Pages per sheet: 4/);
  assert.match(summary.panel.text, /Paper: A4 · Portrait/);
  assert.match(summary.panel.text, /Page numbers: No/);
  assert.match(summary.panel.text, /Output: 1 PDF/);

  const labels = buttonLabels(summary.panel);
  assert.ok(labels.some((label) => label.includes('Process Now')));
  assert.ok(labels.some((label) => label.includes('Custom Settings')));
  assert.ok(labels.some((label) => label.includes('Change preset')));
  assert.ok(callbacks(summary.panel).includes('ws:run'));
  assert.ok(callbacks(summary.panel).includes('ws:custom'));

  const custom = customSettingsPanel('en', workspace);
  assert.match(custom.text, /Pages per sheet: 4/);
  for (const data of [
    'ws:custom:color:bw',
    'ws:custom:color:gray',
    'ws:custom:color:none',
    'ws:custom:layout:1',
    'ws:custom:layout:9',
    'ws:custom:paper:a4',
    'ws:custom:paper:legal',
    'ws:custom:orientation:portrait',
    'ws:custom:orientation:auto',
    'ws:custom:margin:compact',
    'ws:custom:sep:1',
    'ws:custom:pn:1',
    'ws:summary',
    'ws:back',
  ]) {
    assert.ok(callbacks(custom).includes(data), `custom settings misses ${data}`);
  }

  const bengali = presetSummaryPanel('bn', workspace, appConfig);
  assert.equal(bengali.ok, true);
  assert.match(bengali.panel.text, /নির্বাচিত/);
  assert.ok(buttonLabels(bengali.panel).some((label) => label.includes('Process Now')));
});

test('empty workspaces are rejected by the summary instead of pretending to run', () => {
  const summary = presetSummaryPanel('en', buildWorkspace([]), config());
  assert.equal(summary.ok, false);
  assert.match(summary.panel.text, /Upload at least one PDF first/);
  assert.ok(!callbacks(summary.panel).includes('ws:run'));
});

test('original preset summary reflects merge-only behaviour', () => {
  const workspace = buildWorkspace([3, 5]);
  applyPreset(workspace, 'original');
  const summary = presetSummaryPanel('en', workspace, config());
  assert.equal(summary.ok, true);
  assert.match(summary.panel.text, /Merge PDFs: Yes/);
  assert.match(summary.panel.text, /Multiple PDFs are joined/);
  assert.match(summary.panel.text, /Original appearance/);
  assert.ok(callbacks(summary.panel).includes('ws:run'));
});

test('tutorial store remembers each user and expires old entries', () => {
  let now = 1_000;
  const store = createTutorialStore({ ttlMs: 100, now: () => now });

  assert.equal(store.seen(1), false);
  store.markSeen(1);
  assert.equal(store.seen(1), true);
  store.markSeen(1);

  now += 50;
  assert.equal(store.seen(1), true);

  now += 60;
  assert.equal(store.seen(1), false);
  assert.equal(store.size(), 0);

  store.markSeen(2);
  store.markSeen(3);
  assert.equal(store.size(), 2);
  now += 200;
  assert.equal(store.prune(), 2);
  assert.equal(store.size(), 0);
});

interface Registration {
  literal?: string;
  regex?: RegExp;
}

function matchesRegistration(registrations: Registration[], data: string): boolean {
  return registrations.some((entry) =>
    entry.literal !== undefined ? entry.literal === data : entry.regex?.test(data) === true,
  );
}

async function listSources(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listSources(path)));
    else if (entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}

async function loadRegistrations(): Promise<{
  registrations: Registration[];
  literals: string[];
  templates: string[];
}> {
  const botDir = fileURLToPath(new URL('../src/bot/', import.meta.url));
  const files = await listSources(botDir);
  const registrations: Registration[] = [];
  const literals: string[] = [];
  const templates: string[] = [];
  const registrationPattern = /callbackQuery\(\s*('(?:[^'\\]|\\.)*'|\/(?:\\.|[^/\\])+\/)\s*,/g;
  const callbackLiteral = /'((?:menu|ws|admin|tut|tool|merge|upload|verify|lang|channel|ts):[^'\n]*)'/g;
  const callbackTemplate = /`((?:menu|ws|admin|tut|tool|merge|upload|verify|lang|channel|ts):[^`\n]*)`/g;

  for (const file of files) {
    const original = await readFile(file, 'utf8');
    for (const match of original.matchAll(registrationPattern)) {
      const raw = match[1]!;
      if (raw.startsWith("'")) {
        registrations.push({ literal: raw.slice(1, -1) });
      } else {
        registrations.push({ regex: new RegExp(raw.slice(1, raw.lastIndexOf('/'))) });
      }
    }

    const stripped = original.replace(registrationPattern, 'callbackQuery(');
    for (const match of stripped.matchAll(callbackLiteral)) {
      const data = match[1]!;
      if (data.endsWith(':')) continue;
      literals.push(data);
    }
    for (const match of stripped.matchAll(callbackTemplate)) {
      const data = match[1]!;
      if (data.startsWith('${')) continue;
      templates.push(data);
    }
  }

  return { registrations, literals, templates };
}

test('every callback emitted by menus and panels has a registered handler', async () => {
  const { registrations, literals, templates } = await loadRegistrations();
  assert.ok(registrations.length >= 30, 'callback registrations were not discovered');

  for (const data of literals) {
    assert.ok(matchesRegistration(registrations, data), `dead button callback: ${data}`);
  }

  for (const template of templates) {
    const marker = template.indexOf('${');
    if (marker < 0) {
      assert.ok(matchesRegistration(registrations, template), `dead button callback: ${template}`);
      continue;
    }
    const prefix = template.slice(0, marker);
    const covered = registrations.some((entry) => {
      if (entry.literal !== undefined) return entry.literal.startsWith(prefix);
      if (entry.regex === undefined) return false;
      const source = entry.regex.source.replace(/^\^/, '');
      let staticEnd = 0;
      while (staticEnd < source.length && !'[(\\.^$|?*+{'.includes(source[staticEnd]!)) {
        staticEnd += 1;
      }
      const staticPrefix = source.slice(0, staticEnd);
      return source.startsWith(prefix) || (staticPrefix.length > 0 && prefix.startsWith(staticPrefix));
    });
    assert.ok(covered, `dead button callback prefix: ${prefix}`);
  }

  assert.ok(literals.length >= 20, 'callback literals were not discovered');
  assert.ok(templates.length >= 3, 'callback templates were not discovered');
});

test('every keyboard rendered for workspace screens is wired to a handler', async () => {
  const { registrations } = await loadRegistrations();
  const appConfig = config();
  const workspace = buildWorkspace([4, 6]);
  applyPreset(workspace, 'paper');

  const panels: Panel[] = [
    workspacePanel('en', workspace, appConfig),
    workspacePanel('en', { ...workspace, status: 'processing' }, appConfig),
    workspacePanel('en', { ...workspace, status: 'failed', lastError: 'failed' }, appConfig),
    workspacePanel('en', { ...workspace, files: [], presetId: null, operations: [] }, appConfig),
    presetSummaryPanel('en', workspace, appConfig).panel,
    presetsPanel('en', workspace),
    customSettingsPanel('en', workspace),
    moreOptionsPanel('en', workspace),
    workspaceFilesPanel('en', workspace),
    fileActionsPanel('en', workspace, workspace.files[0]!.id),
    replacePromptPanel('en', workspace, workspace.files[0]!.id),
    advancedToolsPanel('en'),
    operationsCatalogPanel('en', 'organization'),
    operationsCatalogPanel('en', 'color'),
    operationsCatalogPanel('en', 'layout'),
    operationsCatalogPanel('en', 'personalization'),
    workspaceOperationsPanel('en', workspace),
    operationConfigPanel('en', workspace, 0, appConfig),
    operationConfigPanel('en', workspace, 1, appConfig),
    modePanel('en', workspace),
    cancelConfirmPanel('en'),
    languagePanel('en'),
    compressionPanel('en'),
  ];

  const standaloneKeyboards = [helpKeyboard('en'), tutorialKeyboard('en')];

  const configured = buildWorkspace([5]);
  addOperation(configured, 'split');
  addOperation(configured, 'select');
  addOperation(configured, 'reorder');
  addOperation(configured, 'rotate');
  addOperation(configured, 'bw');
  addOperation(configured, 'clear');
  addOperation(configured, 'nup');
  addOperation(configured, 'watermark');
  addOperation(configured, 'metadata');
  addOperation(configured, 'timestamp');
  addOperation(configured, 'footer');
  for (let index = 0; index < configured.operations.length; index += 1) {
    panels.push(operationConfigPanel('en', configured, index, appConfig));
  }

  for (const workspaceButton of [false, true]) {
    const menu = mainMenuKeyboard('en', appConfig, workspaceButton, true);
    const data = menu.inline_keyboard
      .flat()
      .flatMap((button) => ('callback_data' in button && button.callback_data ? [button.callback_data] : []));
    for (const item of data) {
      assert.ok(matchesRegistration(registrations, item), `dead main menu callback: ${item}`);
    }
  }

  for (const keyboard of standaloneKeyboards) {
    const data = keyboard.inline_keyboard
      .flat()
      .flatMap((button) => ('callback_data' in button && button.callback_data ? [button.callback_data] : []));
    for (const item of data) {
      assert.ok(matchesRegistration(registrations, item), `dead keyboard callback: ${item}`);
    }
  }

  const seen = new Set<string>();
  for (const panel of panels) {
    for (const data of callbacks(panel)) {
      if (seen.has(data)) continue;
      seen.add(data);
      assert.ok(matchesRegistration(registrations, data), `dead panel callback: ${data}`);
    }
  }

  assert.ok(seen.size >= 40, `expected broad callback coverage, saw ${seen.size}`);
  assert.ok(tutorialText('bn').trim().length > 0);
  assert.ok(tutorialText('en').trim().length > 0);
  assert.equal(createLanguageStore({ ttlMs: 1_000 }).resolve(99, 'en'), 'en');
});
