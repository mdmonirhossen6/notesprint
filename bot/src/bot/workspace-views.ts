import { InlineKeyboard } from 'grammy';
import type { AppConfig } from '../config.js';
import { formatBytes } from '../lib/format.js';
import { formatPageList } from '../pdf/organize.js';
import {
  OPERATION_CATEGORIES,
  WorkspaceValidationError,
  maxPagesBeforeOperation,
  operationLabelKey,
  simulateWorkspace,
} from '../workspace/operations.js';
import type { OperationCategory, WorkspaceIssue } from '../workspace/operations.js';
import { PRESETS, PRESET_IDS, readPresetSettings } from '../workspace/presets.js';
import type { PresetId } from '../workspace/presets.js';
import {
  MAX_PIPELINE_FILES,
  MAX_WORKSPACE_FILES,
  WORKSPACE_TTL_MS,
} from '../workspace/types.js';
import type {
  NupOperation,
  RasterOperation,
  RemainingPagesConfig,
  Workspace,
  WorkspaceOperation,
} from '../workspace/types.js';
import { COMPRESSION_URL } from './compression.js';
import { formatDuration, languageLabel, translate } from './i18n.js';
import type { Lang, TranslationKey } from './i18n.js';

export interface Panel {
  text: string;
  keyboard: InlineKeyboard;
}

function t(lang: Lang, key: TranslationKey, params?: Record<string, string | number>): string {
  return translate(lang, key, params);
}

function valueLabel(lang: Lang, value: string): string {
  return t(lang, `value.${value}` as TranslationKey);
}

export function remainingConfig(config: AppConfig): RemainingPagesConfig {
  return {
    maxPages: config.maxPdfPages,
    rasterMaxPages: config.rasterMaxPages,
    mergeMaxFiles: config.mergeMaxFiles,
  };
}

export function workspaceTotals(workspace: Workspace): { pages: number; bytes: number } {
  return workspace.files.reduce(
    (totals, file) => ({
      pages: totals.pages + file.pages,
      bytes: totals.bytes + file.sizeBytes,
    }),
    { pages: 0, bytes: 0 },
  );
}

export function workspaceExpiryMinutes(workspace: Workspace, now = Date.now()): number {
  const remaining = workspace.updatedAt + WORKSPACE_TTL_MS - now;
  return Math.max(1, Math.ceil(remaining / 60_000));
}

export function modeLabel(lang: Lang, workspace: Workspace): string {
  return t(lang, workspace.mode === 'combine' ? 'ws.mode.combine' : 'ws.mode.individual');
}

export function operationSummary(lang: Lang, operation: WorkspaceOperation): string {
  switch (operation.type) {
    case 'split':
      if (operation.mode === 'every') return t(lang, 'ws.sum.split.every');
      if (operation.mode === 'groups') {
        return operation.groupSize
          ? t(lang, 'ws.sum.split.groups', { size: operation.groupSize })
          : t(lang, 'ws.sum.split.none');
      }
      if (operation.mode === 'extract') {
        return operation.indices?.length
          ? t(lang, 'ws.sum.split.extract', { pages: formatPageList(operation.indices) })
          : t(lang, 'ws.sum.split.none');
      }
      return t(lang, 'ws.sum.split.none');
    case 'select':
      if (operation.mode === 'keep' || operation.mode === 'remove') {
        const key = operation.mode === 'keep' ? 'ws.sum.select.keep' : 'ws.sum.select.remove';
        return operation.indices?.length
          ? t(lang, key, { pages: formatPageList(operation.indices) })
          : t(lang, 'ws.sum.select.none');
      }
      return t(lang, 'ws.sum.select.none');
    case 'reorder':
      return operation.indices?.length ? t(lang, 'ws.sum.reorder') : t(lang, 'ws.sum.reorder.none');
    case 'rotate': {
      const scope =
        operation.scope === 'selected'
          ? operation.indices?.length
            ? t(lang, 'ws.sum.rotate.selected', {
                pages: formatPageList(operation.indices),
              })
            : t(lang, 'ws.cfg.selected')
          : t(lang, 'ws.sum.rotate.all');
      return t(lang, 'ws.sum.rotate', { angle: operation.angle, scope });
    }
    case 'gray':
    case 'bw':
    case 'invert':
    case 'clear': {
      const label = t(lang, operationLabelKey(operation.type));
      const quality = valueLabel(lang, operation.quality);
      if (operation.type === 'bw' && operation.threshold) {
        return `${label} · ${quality} · ${valueLabel(lang, operation.threshold)}`;
      }
      if (operation.type === 'clear' && operation.clearLevel) {
        return `${label} · ${quality} · ${valueLabel(lang, operation.clearLevel)}`;
      }
      return `${label} · ${quality}`;
    }
    case 'nup':
      return t(lang, 'ws.sum.nup', {
        perPage: operation.settings.perPage,
        paper: operation.settings.paper.toUpperCase(),
        orientation: valueLabel(lang, operation.settings.orientation),
      });
    case 'watermark':
      return operation.text.trim()
        ? t(lang, 'ws.sum.watermark', { text: operation.text.trim() })
        : t(lang, 'ws.sum.watermark.empty');
    case 'metadata': {
      const fields = [
        operation.title,
        operation.author,
        operation.subject,
        operation.keywords,
      ].filter((value) => value.trim().length > 0).length;
      return fields > 0
        ? t(lang, 'ws.sum.metadata', { fields })
        : t(lang, 'ws.sum.metadata.empty');
    }
    case 'timestamp':
      return t(lang, 'ws.sum.timestamp');
    case 'footer': {
      const parts: string[] = [];
      if (operation.text.trim()) parts.push(operation.text.trim());
      if (operation.pageNumbers) parts.push(t(lang, 'ws.cfg.pageNumbers'));
      if (operation.timestamp) parts.push(t(lang, 'ws.sum.timestamp'));
      return parts.length > 0
        ? t(lang, 'ws.sum.footer', { parts: parts.join(' · ') })
        : t(lang, 'ws.ops.notConfigured');
    }
  }
}

function operationLine(lang: Lang, operation: WorkspaceOperation, index: number): string {
  return t(lang, 'ws.ops.step', {
    index: index + 1,
    summary: operationSummary(lang, operation),
  });
}

function colorLabel(lang: Lang, color: 'none' | 'gray' | 'bw'): string {
  if (color === 'bw') return t(lang, 'ws.custom.colorBw');
  if (color === 'gray') return t(lang, 'ws.custom.colorGray');
  return t(lang, 'ws.custom.colorNone');
}

function layoutLabel(lang: Lang, perPage: number): string {
  return perPage <= 1
    ? t(lang, 'ws.value.normalSheet')
    : t(lang, 'ws.value.perSheet', { count: perPage });
}

function paperLabel(lang: Lang, workspace: Workspace): string {
  const settings = readPresetSettings(workspace);
  if (settings.perPage <= 1) return t(lang, 'ws.value.originalSize');
  return `${settings.paper.toUpperCase()} · ${valueLabel(lang, settings.orientation)}`;
}

function hasPageNumbers(workspace: Workspace): boolean {
  if (readPresetSettings(workspace).pageNumbers) return true;
  return workspace.operations.some(
    (operation) => operation.type === 'footer' && operation.pageNumbers,
  );
}

function toggleLabel(lang: Lang, enabled: boolean): string {
  return t(lang, enabled ? 'ws.cfg.on' : 'ws.cfg.off');
}

function fileIndex(workspace: Workspace, fileId: string): number {
  return workspace.files.findIndex((file) => file.id === fileId);
}

export function presetLabel(lang: Lang, id: PresetId): string {
  return t(lang, PRESETS[id].labelKey);
}

function presetButtonLabel(lang: Lang, id: PresetId, selected: boolean): string {
  return `${presetLabel(lang, id)}${selected ? ' ✅' : ''}`;
}

export function workspacePanel(
  lang: Lang,
  workspace: Workspace,
  config: AppConfig,
  now = Date.now(),
): Panel {
  const totals = workspaceTotals(workspace);
  const processing = workspace.status === 'processing';
  const keyboard = new InlineKeyboard();
  const lines = [
    t(lang, 'ws.title'),
    '',
    t(lang, 'ws.summaryLine', {
      files: workspace.files.length,
      pages: totals.pages,
      size: formatBytes(totals.bytes),
    }),
  ];

  if (workspace.files.length === 0) {
    lines.push(
      '',
      t(lang, 'ws.noFiles'),
      '',
      t(lang, 'ws.uploadPrompt', {
        maxFiles: MAX_WORKSPACE_FILES,
        maxTotalMb: config.mergeMaxTotalMb,
        maxPages: config.maxPdfPages,
        maxUploadMb: config.maxUploadMb,
      }),
    );
  } else {
    lines.push('');
    workspace.files.forEach((file, index) => {
      lines.push(
        t(lang, 'ws.fileLine', {
          index: index + 1,
          name: file.name,
          pages: file.pages,
          size: formatBytes(file.sizeBytes),
        }),
      );
    });
    if (workspace.awaitingUpload) {
      lines.push('', t(lang, 'ws.upload.sendNow'), t(lang, 'ws.upload.moreHint'));
    }
  }

  if (processing) {
    lines.push('', t(lang, 'ws.status.processingNote'));
  } else if (workspace.status === 'failed' && workspace.lastError) {
    lines.push('', workspace.lastError);
  } else if (workspace.files.length > 0) {
    if (workspace.presetId) {
      lines.push(
        '',
        t(lang, 'ws.presetSelected', { name: presetLabel(lang, workspace.presetId) }),
      );
    }
    if (workspace.operations.length > 0) {
      lines.push('', t(lang, 'ws.pipeline', { count: workspace.operations.length }));
      for (const operation of workspace.operations) {
        lines.push(`• ${operationSummary(lang, operation)}`);
      }
    } else if (!workspace.presetId) {
      lines.push('', t(lang, 'ws.choosePreset'));
    }
  }

  lines.push('', t(lang, 'ws.expiresIn', { minutes: workspaceExpiryMinutes(workspace, now) }));

  if (processing) {
    keyboard
      .text(t(lang, 'ws.btn.cancelRun'), 'ws:cancelrun')
      .row()
      .text(t(lang, 'ws.btn.menu'), 'menu:home');
    return { text: lines.join('\n'), keyboard };
  }

  if (workspace.status === 'failed') {
    keyboard
      .text(t(lang, 'ws.btn.retry'), 'ws:retry')
      .text(t(lang, 'ws.btn.more'), 'ws:more')
      .row()
      .text(t(lang, 'ws.btn.menu'), 'menu:home');
    return { text: lines.join('\n'), keyboard };
  }

  if (workspace.files.length === 0) {
    keyboard
      .text(t(lang, 'ws.btn.add'), 'ws:add')
      .row()
      .text(t(lang, 'ws.btn.more'), 'ws:more')
      .text(t(lang, 'ws.btn.menu'), 'menu:home');
    return { text: lines.join('\n'), keyboard };
  }

  if (workspace.presetId) {
    keyboard
      .text(t(lang, 'ws.btn.processNow'), 'ws:run')
      .row()
      .text(t(lang, 'ws.btn.custom'), 'ws:custom')
      .text(t(lang, 'ws.btn.changePreset'), 'ws:presets')
      .row()
      .text(t(lang, 'ws.btn.more'), 'ws:more')
      .text(t(lang, 'ws.btn.menu'), 'menu:home');
    return { text: lines.join('\n'), keyboard };
  }

  if (workspace.operations.length > 0) {
    keyboard
      .text(t(lang, 'ws.btn.processNow'), 'ws:run')
      .row()
      .text(t(lang, 'ws.btn.changePreset'), 'ws:presets')
      .text(t(lang, 'ws.btn.more'), 'ws:more')
      .row()
      .text(t(lang, 'ws.btn.menu'), 'menu:home');
    return { text: lines.join('\n'), keyboard };
  }

  for (let index = 0; index < PRESET_IDS.length; index += 2) {
    const first = PRESET_IDS[index]!;
    const second = PRESET_IDS[index + 1];
    keyboard.text(t(lang, PRESETS[first].labelKey), `ws:preset:${first}`);
    if (second) keyboard.text(t(lang, PRESETS[second].labelKey), `ws:preset:${second}`);
    keyboard.row();
  }

  keyboard
    .text(t(lang, 'ws.btn.more'), 'ws:more')
    .text(t(lang, 'ws.btn.menu'), 'menu:home');

  return { text: lines.join('\n'), keyboard };
}

export function presetSummaryPanel(
  lang: Lang,
  workspace: Workspace,
  config: AppConfig,
): { panel: Panel; ok: boolean; issue?: WorkspaceIssue } {
  const totals = workspaceTotals(workspace);
  const settings = readPresetSettings(workspace);
  let issue: WorkspaceIssue | undefined;
  let simulation: ReturnType<typeof simulateWorkspace> | null = null;

  try {
    simulation = simulateWorkspace(workspace, remainingConfig(config));
  } catch (error) {
    issue = error instanceof WorkspaceValidationError ? error.issue : undefined;
  }

  const ok = issue === undefined && simulation !== null;
  const name = workspace.presetId
    ? presetLabel(lang, workspace.presetId)
    : t(lang, 'ws.review.title');
  const lines = [
    workspace.presetId ? t(lang, 'ws.summary.title', { name }) : name,
    '',
    t(lang, 'ws.summary.filesLine', {
      files: workspace.files.length,
      pages: totals.pages,
      size: formatBytes(totals.bytes),
    }),
    '',
    t(lang, 'ws.summary.settings'),
    t(lang, 'ws.summary.merge', {
      value: t(
        lang,
        workspace.mode === 'combine' && workspace.files.length > 1 ? 'ws.value.yes' : 'ws.value.no',
      ),
    }),
    t(lang, 'ws.summary.color', { value: colorLabel(lang, settings.color) }),
    t(lang, 'ws.summary.layout', { value: layoutLabel(lang, settings.perPage) }),
    t(lang, 'ws.summary.paper', { value: paperLabel(lang, workspace) }),
    t(lang, 'ws.summary.numbers', {
      value: t(lang, hasPageNumbers(workspace) ? 'ws.value.yes' : 'ws.value.no'),
    }),
  ];

  if (simulation) {
    lines.push(
      t(lang, 'ws.summary.output', {
        value: t(
          lang,
          simulation.finalFiles.length <= 1 ? 'ws.summary.outputOne' : 'ws.summary.outputZip',
        ),
      }),
    );
  }

  if (settings.color === 'none' && settings.perPage <= 1) {
    lines.push('', t(lang, 'ws.summary.plain'));
  }
  if (workspace.mode === 'combine' && workspace.files.length > 1) {
    lines.push(t(lang, 'ws.summary.mergeNote'));
  }
  if (workspace.operations.length === 0 && ok) {
    lines.push('', t(lang, 'ws.review.noOps'));
  }
  if (issue) {
    lines.push('', issueText(lang, issue, workspace, config));
  } else if (simulation && simulation.warnings.length > 0) {
    lines.push('', t(lang, 'ws.review.warnings'));
    for (const warning of simulation.warnings) {
      lines.push(`• ${t(lang, warning.key, warning.params)}`);
    }
  }

  const keyboard = new InlineKeyboard();
  if (ok) keyboard.text(t(lang, 'ws.btn.processNow'), 'ws:run').row();
  if (workspace.presetId) {
    keyboard
      .text(t(lang, 'ws.btn.custom'), 'ws:custom')
      .text(t(lang, 'ws.btn.changePreset'), 'ws:presets')
      .row();
  }
  if (!ok || !workspace.presetId) {
    keyboard.text(t(lang, 'ws.btn.tools'), 'ws:tools').row();
  }
  keyboard.text(t(lang, 'ws.btn.back'), 'ws:back').text(t(lang, 'ws.btn.menu'), 'menu:home');

  return {
    panel: { text: lines.join('\n'), keyboard },
    ok,
    ...(issue ? { issue } : {}),
  };
}


export function customSettingsPanel(lang: Lang, workspace: Workspace): Panel {
  const settings = readPresetSettings(workspace);
  const keyboard = new InlineKeyboard()
    .text(t(lang, 'ws.custom.colorBw'), 'ws:custom:color:bw')
    .text(t(lang, 'ws.custom.colorGray'), 'ws:custom:color:gray')
    .text(t(lang, 'ws.custom.colorNone'), 'ws:custom:color:none')
    .row();

  keyboard.text(t(lang, 'ws.value.normalSheet'), 'ws:custom:layout:1');
  ([2, 4, 6, 9] as const).forEach((value) => {
    keyboard.text(String(value), `ws:custom:layout:${value}`);
  });
  keyboard.row();

  if (settings.perPage > 1) {
    (['a4', 'a3', 'a5', 'letter', 'legal'] as const).forEach((value) => {
      keyboard.text(value.toUpperCase(), `ws:custom:paper:${value}`);
    });
    keyboard.row();

    (['portrait', 'landscape', 'auto'] as const).forEach((value) => {
      keyboard.text(valueLabel(lang, value), `ws:custom:orientation:${value}`);
    });
    keyboard.row();

    (['compact', 'normal', 'wide'] as const).forEach((value) => {
      keyboard.text(valueLabel(lang, value), `ws:custom:margin:${value}`);
    });
    keyboard.row();

    keyboard
      .text(
        `${t(lang, 'ws.custom.separators')}: ${toggleLabel(lang, settings.separators)}`,
        `ws:custom:sep:${settings.separators ? 0 : 1}`,
      )
      .text(
        `${t(lang, 'ws.custom.pageNumbers')}: ${toggleLabel(lang, settings.pageNumbers)}`,
        `ws:custom:pn:${settings.pageNumbers ? 0 : 1}`,
      )
      .row();
  }

  keyboard
    .text(t(lang, 'ws.custom.done'), 'ws:summary')
    .text(t(lang, 'ws.btn.back'), 'ws:back');

  const lines = [
    t(lang, 'ws.custom.title'),
    '',
    t(lang, 'ws.custom.hint'),
    '',
    `${t(lang, 'ws.custom.color')}: ${colorLabel(lang, settings.color)}`,
    `${t(lang, 'ws.custom.layout')}: ${layoutLabel(lang, settings.perPage)}`,
  ];

  if (settings.perPage > 1) {
    lines.push(
      `${t(lang, 'ws.custom.paper')}: ${settings.paper.toUpperCase()}`,
      `${t(lang, 'ws.custom.orientation')}: ${valueLabel(lang, settings.orientation)}`,
      `${t(lang, 'ws.custom.margins')}: ${valueLabel(lang, settings.margin)}`,
      `${t(lang, 'ws.custom.separators')}: ${toggleLabel(lang, settings.separators)}`,
      `${t(lang, 'ws.custom.pageNumbers')}: ${toggleLabel(lang, settings.pageNumbers)}`,
    );
  }

  lines.push('', t(lang, 'ws.custom.note'));

  return { text: lines.join('\n'), keyboard };
}

export function moreOptionsPanel(lang: Lang, workspace: Workspace): Panel {
  const keyboard = new InlineKeyboard()
    .text(t(lang, 'ws.btn.add'), 'ws:add')
    .text(t(lang, 'ws.btn.files'), 'ws:files')
    .row()
    .text(t(lang, 'ws.btn.tools'), 'ws:tools')
    .text(t(lang, 'ws.btn.presets'), 'ws:presets')
    .row();

  if (workspace.operations.length > 0) {
    keyboard.text(t(lang, 'ws.btn.ops'), 'ws:ops').row();
  }

  keyboard
    .text(t(lang, 'ws.btn.mode'), 'ws:mode')
    .row()
    .text(t(lang, 'ws.btn.cancel'), 'ws:cancel')
    .row()
    .text(t(lang, 'ws.btn.back'), 'ws:back')
    .text(t(lang, 'ws.btn.menu'), 'menu:home');

  const lines = [t(lang, 'ws.more.title'), '', t(lang, 'ws.more.hint')];
  if (workspace.awaitingUpload) {
    lines.push('', t(lang, 'ws.upload.sendNow'));
  }

  return { text: lines.join('\n'), keyboard };
}

export function presetsPanel(
  lang: Lang,
  workspace: Workspace,
  backAction = 'ws:back',
): Panel {
  const keyboard = new InlineKeyboard();
  for (const id of PRESET_IDS) {
    keyboard
      .text(presetButtonLabel(lang, id, workspace.presetId === id), `ws:preset:${id}`)
      .row();
  }
  keyboard.text(t(lang, 'ws.btn.back'), backAction).text(t(lang, 'ws.btn.menu'), 'menu:home');

  const text = [
    t(lang, 'ws.presets.title'),
    '',
    t(lang, 'ws.presets.hint'),
    '',
    ...PRESET_IDS.map(
      (id) => `${presetLabel(lang, id)} — ${t(lang, PRESETS[id].descriptionKey)}`,
    ),
    '',
    t(lang, 'ws.presets.cost'),
  ].join('\n');

  return { text, keyboard };
}

export function workspaceFilesPanel(lang: Lang, workspace: Workspace): Panel {
  const totals = workspaceTotals(workspace);
  const keyboard = new InlineKeyboard();
  const lines = [t(lang, 'ws.files.title'), t(lang, 'ws.files.hint'), ''];

  if (workspace.files.length === 0) {
    lines.push(t(lang, 'ws.noFiles'));
  } else {
    lines.push(t(lang, 'ws.files.pick'));
    workspace.files.forEach((file, index) => {
      lines.push(
        t(lang, 'ws.fileLine', {
          index: index + 1,
          name: file.name,
          pages: file.pages,
          size: formatBytes(file.sizeBytes),
        }),
      );
      keyboard.text(`${index + 1}. ${file.name}`.slice(0, 60), `ws:file:sel:${file.id}`).row();
    });
    lines.push('', t(lang, 'ws.total', { pages: totals.pages, size: formatBytes(totals.bytes) }));
  }

  keyboard
    .text(t(lang, 'ws.btn.add'), 'ws:add')
    .row()
    .text(t(lang, 'ws.btn.back'), 'ws:back')
    .text(t(lang, 'ws.btn.menu'), 'menu:home');

  return { text: lines.join('\n'), keyboard };
}

export function fileActionsPanel(lang: Lang, workspace: Workspace, fileId: string): Panel {
  const index = fileIndex(workspace, fileId);
  const file = workspace.files[index];
  if (!file) return workspaceFilesPanel(lang, workspace);

  const keyboard = new InlineKeyboard();
  if (index > 0) keyboard.text('⬆️', `ws:file:up:${file.id}`);
  if (index < workspace.files.length - 1) keyboard.text('⬇️', `ws:file:dn:${file.id}`);
  if (index > 0 || index < workspace.files.length - 1) keyboard.row();

  keyboard
    .text(t(lang, 'ws.btn.replace'), `ws:file:rp:${file.id}`)
    .text(t(lang, 'ws.btn.remove'), `ws:file:rm:${file.id}`)
    .row()
    .text(t(lang, 'ws.btn.back'), 'ws:files')
    .text(t(lang, 'ws.btn.menu'), 'menu:home');

  const text = [
    t(lang, 'ws.files.actionsTitle', { name: file.name }),
    '',
    t(lang, 'ws.files.actionsHint'),
    '',
    t(lang, 'ws.files.position', {
      index: index + 1,
      total: workspace.files.length,
      pages: file.pages,
      size: formatBytes(file.sizeBytes),
    }),
  ].join('\n');

  return { text, keyboard };
}

export function replacePromptPanel(lang: Lang, workspace: Workspace, fileId: string): Panel {
  const file = workspace.files[fileIndex(workspace, fileId)];
  const text = file
    ? t(lang, 'ws.files.replacePrompt', { name: file.name })
    : t(lang, 'ws.files.noReplace');
  return {
    text,
    keyboard: new InlineKeyboard()
      .text(t(lang, 'ws.btn.back'), 'ws:repcancel')
      .text(t(lang, 'ws.btn.menu'), 'menu:home'),
  };
}

export function advancedToolsPanel(lang: Lang): Panel {
  const keyboard = new InlineKeyboard();
  for (const [id, definition] of Object.entries(OPERATION_CATEGORIES)) {
    keyboard.text(t(lang, definition.labelKey), `ws:cat:${id}`).row();
  }
  keyboard
    .text(t(lang, 'ws.cat.merge'), 'ws:merge')
    .row()
    .text(t(lang, 'ws.btn.back'), 'ws:more')
    .text(t(lang, 'ws.btn.menu'), 'menu:home');

  const lines = [t(lang, 'ws.advanced.title'), '', t(lang, 'ws.advanced.hint'), ''];
  for (const definition of Object.values(OPERATION_CATEGORIES)) {
    lines.push(
      `${t(lang, definition.labelKey)} — ${t(lang, `${definition.labelKey}.desc` as TranslationKey)}`,
    );
  }

  return { text: lines.join('\n'), keyboard };
}

export function operationsCatalogPanel(lang: Lang, category?: OperationCategory): Panel {
  if (!category) return advancedToolsPanel(lang);

  const keyboard = new InlineKeyboard();
  const definition = OPERATION_CATEGORIES[category];
  const lines = [
    t(lang, definition.labelKey),
    '',
    t(lang, `${definition.labelKey}.desc` as TranslationKey),
    '',
    t(lang, 'ws.advanced.chooseTool'),
    '',
    ...definition.types.map((type) => `• ${t(lang, operationLabelKey(type))}`),
  ];
  for (const type of definition.types) {
    keyboard.text(t(lang, operationLabelKey(type)), `ws:addop:${type}`).row();
  }
  if (category === 'organization') {
    keyboard.text(t(lang, 'ws.cat.merge'), 'ws:merge').row();
  }
  keyboard
    .text(t(lang, 'ws.btn.back'), 'ws:tools')
    .text(t(lang, 'ws.btn.menu'), 'menu:home');

  return { text: lines.join('\n'), keyboard };
}

function pagesForOperation(
  workspace: Workspace,
  operation: WorkspaceOperation,
  config: AppConfig,
): number {
  const index = workspace.operations.findIndex((entry) => entry.id === operation.id);
  const pages =
    index >= 0 ? maxPagesBeforeOperation(workspace, index, remainingConfig(config)) : 0;
  if (pages > 0) return pages;
  return workspace.files.reduce((sum, file) => sum + file.pages, 0) || 1;
}

function pageOrderExample(pages: number): string {
  if (pages <= 1) return '1';
  if (pages <= 8) {
    const remaining = Array.from({ length: pages }, (_, index) => index + 1).filter(
      (page) => page !== 3,
    );
    return [3, ...remaining].slice(0, pages).join(', ');
  }
  return `${pages}, 1, 2, 3, 4, ...`;
}

export function promptText(
  lang: Lang,
  workspace: Workspace,
  operation: WorkspaceOperation,
  config: AppConfig,
): string {
  const awaiting = workspace.awaitingText;
  if (!awaiting || awaiting.operationId !== operation.id) return '';
  const pages = pagesForOperation(workspace, operation, config);

  switch (awaiting.field) {
    case 'ranges':
      return t(lang, 'ws.prompt.ranges', { pages });
    case 'order':
      return t(lang, 'ws.prompt.order', { example: pageOrderExample(pages), pages });
    case 'group-size':
      return t(lang, 'ws.prompt.groupSize', { pages });
    case 'number-start':
      return t(lang, 'ws.prompt.numberStart');
    case 'watermark-text':
      return t(lang, 'ws.prompt.watermark');
    case 'footer-text':
      return t(lang, 'ws.prompt.footer');
    case 'timestamp-text':
      return t(lang, 'ws.prompt.timestamp');
    case 'metadata-title':
      return t(lang, 'ws.prompt.metadata.title');
    case 'metadata-author':
      return t(lang, 'ws.prompt.metadata.author');
    case 'metadata-subject':
      return t(lang, 'ws.prompt.metadata.subject');
    case 'metadata-keywords':
      return t(lang, 'ws.prompt.metadata.keywords');
  }
}

function addRasterButtons(
  keyboard: InlineKeyboard,
  lang: Lang,
  index: number,
  operation: RasterOperation,
): void {
  const prefix = `ws:set:${index}:`;
  const values = ['low', 'medium', 'high'] as const;
  values.forEach((value) => {
    keyboard.text(valueLabel(lang, value), `${prefix}q:${value}`);
  });
  keyboard.row();

  if (operation.type === 'bw') {
    (['light', 'balanced', 'strong'] as const).forEach((value) => {
      keyboard.text(valueLabel(lang, value), `${prefix}th:${value}`);
    });
    keyboard.row();
  }
  if (operation.type === 'clear') {
    (['low', 'medium', 'high'] as const).forEach((value) => {
      keyboard.text(`${t(lang, 'ws.cfg.cleanup')} ${valueLabel(lang, value)}`, `${prefix}cl:${value}`);
    });
    keyboard.row();
  }
}

function addNupButtons(
  keyboard: InlineKeyboard,
  lang: Lang,
  index: number,
  operation: NupOperation,
): void {
  const prefix = `ws:set:${index}:`;
  const settings = operation.settings;

  ([2, 4, 6, 9] as const).forEach((value) => {
    keyboard.text(`${value}-in-1`, `${prefix}np:${value}`);
  });
  keyboard.row();

  (['a4', 'a3', 'a5', 'letter', 'legal'] as const).forEach((value) => {
    keyboard.text(value.toUpperCase(), `${prefix}pa:${value}`);
  });
  keyboard.row();

  (['portrait', 'landscape', 'auto'] as const).forEach((value) => {
    keyboard.text(valueLabel(lang, value), `${prefix}or:${value}`);
  });
  keyboard.row();

  (['compact', 'normal', 'wide'] as const).forEach((value) => {
    keyboard.text(valueLabel(lang, value), `${prefix}mg:${value}`);
  });
  keyboard.row();

  ([0, 8, 16] as const).forEach((value) => {
    keyboard.text(`${t(lang, 'ws.cfg.gap')} ${value}`, `${prefix}gp:${value}`);
  });
  keyboard.row();

  keyboard
    .text(
      `${t(lang, 'ws.cfg.separators')} ${t(lang, settings.separators ? 'ws.cfg.on' : 'ws.cfg.off')}`,
      `${prefix}sep:${settings.separators ? 0 : 1}`,
    )
    .text(
      `${t(lang, 'ws.cfg.pageNumbers')} ${t(lang, settings.pageNumbers ? 'ws.cfg.on' : 'ws.cfg.off')}`,
      `${prefix}pn:${settings.pageNumbers ? 0 : 1}`,
    )
    .row();

  keyboard.text(t(lang, 'ws.cfg.startNumber', { value: settings.numberStart }), `${prefix}ns:start`).row();

  (['bottom-center', 'bottom-right', 'top-center'] as const).forEach((value) => {
    const labelKey =
      value === 'bottom-center'
        ? 'value.bottomCenter'
        : value === 'bottom-right'
          ? 'value.bottomRight'
          : 'value.topCenter';
    keyboard.text(t(lang, labelKey), `${prefix}pp:${value}`);
  });
  keyboard.row();

  ([8, 10, 12] as const).forEach((value) => {
    keyboard.text(`${t(lang, 'ws.cfg.size')} ${value}`, `${prefix}ps:${value}`);
  });
  keyboard.row();
}

function addWatermarkButtons(
  keyboard: InlineKeyboard,
  lang: Lang,
  index: number,
  operation: WorkspaceOperation & { type: 'watermark' },
): void {
  const prefix = `ws:set:${index}:`;
  keyboard.text(t(lang, 'ws.cfg.editText'), `${prefix}wm:text`).row();

  ([32, 48, 64, 96] as const).forEach((value) => {
    keyboard.text(`${t(lang, 'ws.cfg.size')} ${value}`, `${prefix}wm:size:${value}`);
  });
  keyboard.row();

  ([15, 25, 40, 60] as const).forEach((value) => {
    keyboard.text(`${t(lang, 'ws.cfg.opacity')} ${value}%`, `${prefix}wm:opacity:${value}`);
  });
  keyboard.row();

  ([0, 45, 90] as const).forEach((value) => {
    keyboard.text(`${value}°`, `${prefix}wm:rot:${value}`);
  });
  keyboard.row();

  const positions = [
    ['center', 'value.center'],
    ['top', 'value.top'],
    ['bottom', 'value.bottom'],
  ] as const;
  positions.forEach(([value, labelKey]) => {
    keyboard.text(t(lang, labelKey), `${prefix}wm:pos:${value}`);
  });
  keyboard.row();

  const corners = [
    ['top-left', 'value.topLeft'],
    ['top-right', 'value.topRight'],
    ['bottom-left', 'value.bottomLeft'],
    ['bottom-right', 'value.bottomRight'],
  ] as const;
  corners.forEach(([value, labelKey]) => {
    keyboard.text(t(lang, labelKey), `${prefix}wm:pos:${value}`);
  });
  keyboard.row();

  keyboard
    .text(t(lang, 'ws.cfg.scopeAll'), `${prefix}wm:scope:all`)
    .text(t(lang, 'ws.cfg.scopeSelected'), `${prefix}wm:scope:selected`);
  if (operation.scope === 'selected') {
    keyboard.text(t(lang, 'ws.cfg.setPages'), `${prefix}wm:pages`);
  }
  keyboard.row();
}

export function operationConfigPanel(
  lang: Lang,
  workspace: Workspace,
  index: number,
  config: AppConfig,
): Panel {
  const operation = workspace.operations[index];
  const keyboard = new InlineKeyboard();
  if (!operation) {
    return workspaceOperationsPanel(lang, workspace);
  }

  const lines = [t(lang, operationLabelKey(operation.type)), '', operationSummary(lang, operation)];
  const prompt = promptText(lang, workspace, operation, config);
  if (prompt) lines.push('', prompt);

  const prefix = `ws:set:${index}:`;

  switch (operation.type) {
    case 'split':
      keyboard
        .text(t(lang, 'ws.cfg.splitEvery'), `${prefix}sp:every`)
        .text(t(lang, 'ws.cfg.splitGroups'), `${prefix}sp:groups`)
        .row()
        .text(t(lang, 'ws.cfg.splitExtract'), `${prefix}sp:extract`);
      if (operation.mode === 'extract') {
        keyboard.text(t(lang, 'ws.cfg.setPages'), `${prefix}sp:pages`);
      }
      keyboard.row();
      break;
    case 'select':
      keyboard
        .text(t(lang, 'ws.cfg.keep'), `${prefix}sel:keep`)
        .text(t(lang, 'ws.cfg.remove'), `${prefix}sel:remove`);
      if (operation.mode) {
        keyboard.row().text(t(lang, 'ws.cfg.setPages'), `${prefix}sel:pages`);
      }
      keyboard.row();
      break;
    case 'reorder':
      keyboard.text(t(lang, 'ws.cfg.setOrder'), `${prefix}ro:order`).row();
      break;
    case 'rotate':
      ([90, 180, 270] as const).forEach((angle) => {
        keyboard.text(`${angle}°`, `${prefix}an:${angle}`);
      });
      keyboard
        .row()
        .text(t(lang, 'ws.cfg.all'), `${prefix}sc:all`)
        .text(t(lang, 'ws.cfg.selected'), `${prefix}sc:sel`);
      if (operation.scope === 'selected') {
        keyboard.text(t(lang, 'ws.cfg.setPages'), `${prefix}sc:pages`);
      }
      keyboard.row();
      break;
    case 'gray':
    case 'bw':
    case 'invert':
    case 'clear':
      addRasterButtons(keyboard, lang, index, operation);
      break;
    case 'nup':
      addNupButtons(keyboard, lang, index, operation);
      break;
    case 'watermark':
      addWatermarkButtons(keyboard, lang, index, operation);
      break;
    case 'metadata':
      keyboard
        .text(t(lang, 'ws.cfg.title'), `${prefix}md:title`)
        .text(t(lang, 'ws.cfg.author'), `${prefix}md:author`)
        .row()
        .text(t(lang, 'ws.cfg.subject'), `${prefix}md:subject`)
        .text(t(lang, 'ws.cfg.keywords'), `${prefix}md:keywords`)
        .row();
      break;
    case 'timestamp':
      keyboard.text(t(lang, 'ws.cfg.prefix'), `${prefix}ts:text`).row();
      break;
    case 'footer':
      keyboard
        .text(t(lang, 'ws.cfg.editText'), `${prefix}ft:text`)
        .row()
        .text(
          `${t(lang, 'ws.cfg.pageNumbers')} ${t(lang, operation.pageNumbers ? 'ws.cfg.on' : 'ws.cfg.off')}`,
          `${prefix}ft:num:${operation.pageNumbers ? 0 : 1}`,
        )
        .text(
          `${t(lang, 'ws.sum.timestamp')} ${t(lang, operation.timestamp ? 'ws.cfg.on' : 'ws.cfg.off')}`,
          `${prefix}ft:ts:${operation.timestamp ? 0 : 1}`,
        )
        .row()
        .text(t(lang, 'value.left'), `${prefix}ft:pos:left`)
        .text(t(lang, 'value.center'), `${prefix}ft:pos:center`)
        .text(t(lang, 'value.right'), `${prefix}ft:pos:right`)
        .row();
      ([8, 10, 12] as const).forEach((value) => {
        keyboard.text(`${t(lang, 'ws.cfg.size')} ${value}`, `${prefix}ft:size:${value}`);
      });
      keyboard.row();
      break;
  }

  keyboard.text(t(lang, 'ws.btn.back'), 'ws:ops').text(t(lang, 'ws.btn.menu'), 'menu:home');

  return { text: lines.join('\n'), keyboard };
}

export function workspaceOperationsPanel(lang: Lang, workspace: Workspace): Panel {
  const keyboard = new InlineKeyboard();
  const lines = [t(lang, 'ws.ops.title'), ''];

  if (workspace.operations.length === 0) {
    lines.push(t(lang, 'ws.ops.empty'));
  } else {
    workspace.operations.forEach((operation, index) => {
      lines.push(operationLine(lang, operation, index));
      keyboard
        .text('✏️', `ws:op:conf:${index}`)
        .text('⬆️', `ws:op:up:${index}`)
        .text('⬇️', `ws:op:dn:${index}`)
        .text('🗑', `ws:op:rm:${index}`)
        .row();
    });
  }

  if (workspace.files.length > 0 && workspace.operations.length > 0) {
    keyboard.text(t(lang, 'ws.btn.processNow'), 'ws:run').row();
  }

  keyboard.text(t(lang, 'ws.btn.addOp'), 'ws:tools').row();

  if (workspace.operations.length > 0) {
    keyboard.text(t(lang, 'ws.btn.clearOps'), 'ws:clearops').row();
  }

  keyboard.text(t(lang, 'ws.btn.back'), 'ws:back').text(t(lang, 'ws.btn.menu'), 'menu:home');

  return { text: lines.join('\n'), keyboard };
}

export function modePanel(lang: Lang, workspace: Workspace): Panel {
  const keyboard = new InlineKeyboard()
    .text(t(lang, 'ws.mode.combine'), 'ws:mode:c')
    .row()
    .text(t(lang, 'ws.mode.individual'), 'ws:mode:i')
    .row()
    .text(t(lang, 'ws.btn.back'), 'ws:more')
    .text(t(lang, 'ws.btn.menu'), 'menu:home');

  const text = [
    t(lang, 'ws.modes.title'),
    '',
    `${t(lang, 'ws.mode.combine')}: ${t(lang, 'ws.modes.combine')}`,
    '',
    `${t(lang, 'ws.mode.individual')}: ${t(lang, 'ws.modes.individual')}`,
    '',
    t(lang, 'ws.modes.splitNote'),
    '',
    t(lang, 'ws.mode', { mode: modeLabel(lang, workspace) }),
  ].join('\n');

  return { text, keyboard };
}

export function cancelConfirmPanel(lang: Lang): Panel {
  return {
    text: [t(lang, 'ws.cancel.title'), '', t(lang, 'ws.cancel.body')].join('\n'),
    keyboard: new InlineKeyboard()
      .text(t(lang, 'ws.btn.cancelConfirm'), 'ws:cancelconfirm')
      .row()
      .text(t(lang, 'ws.btn.cancelKeep'), 'ws:cancelkeep')
      .row()
      .text(t(lang, 'ws.btn.menu'), 'menu:home'),
  };
}

export function issueText(
  lang: Lang,
  issue: WorkspaceIssue,
  workspace: Workspace,
  config: AppConfig,
): string {
  const params = issue.params ?? {};
  const index = issue.operationIndex;
  const operation = index === undefined ? undefined : workspace.operations[index];
  const labelKey =
    issue.operationLabelKey ?? (operation ? operationLabelKey(operation.type) : undefined);
  const label = labelKey ? t(lang, labelKey) : '';

  switch (issue.code) {
    case 'noFiles':
      return t(lang, 'ws.err.noFiles');
    case 'configure':
      return t(lang, 'ws.err.configureOp', {
        index: index === undefined ? 1 : index + 1,
        label,
      });
    case 'tooManyOutputs':
      return t(lang, 'ws.err.tooManyOutputs', {
        count: Number(params.count ?? 0),
        max: Number(params.max ?? MAX_PIPELINE_FILES),
      });
    case 'pageRangeMax':
      return t(lang, 'ws.err.pageRangeMax', {
        pages: Number(params.pages ?? config.maxPdfPages),
      });
    case 'emptyResult':
      return t(lang, 'ws.err.emptyResult');
    case 'reorderMismatch':
      return t(lang, 'ws.err.reorderMismatch');
    case 'groupSize':
      return t(lang, 'ws.err.groupSize', {
        pages: Number(params.pages ?? config.maxPdfPages),
      });
    case 'rasterLimit': {
      const issueLabel = params.labelKey ? t(lang, params.labelKey as TranslationKey) : label;
      return t(lang, 'ws.err.rasterLimit', {
        label: issueLabel,
        limit: Number(params.limit ?? 0),
        quality: valueLabel(lang, String(params.quality ?? 'medium')),
        name: String(params.name ?? ''),
        pages: Number(params.pages ?? 0),
      });
    }
    case 'metadataEmpty':
      return t(lang, 'ws.err.metadataEmpty');
    case 'textRequired':
      return t(lang, 'ws.err.textRequired');
    case 'unsupportedText':
      return t(lang, 'ws.err.unsupportedText');
    case 'footerEmpty':
      return t(lang, 'ws.err.footerEmpty');
    case 'mergeFiles':
      return t(lang, 'ws.err.mergeFiles', {
        max: Number(params.max ?? config.mergeMaxFiles),
      });
    case 'totalPages':
      return t(lang, 'ws.err.totalPages', {
        max: Number(params.max ?? config.maxPdfPages),
      });
  }
}

export function languagePanel(lang: Lang): Panel {
  const keyboard = new InlineKeyboard()
    .text(`${languageLabel('bn')}${lang === 'bn' ? ' ✅' : ''}`, 'lang:set:bn')
    .text(`${languageLabel('en')}${lang === 'en' ? ' ✅' : ''}`, 'lang:set:en')
    .row()
    .text(t(lang, 'menu.back'), 'menu:home');

  const text = [
    t(lang, 'language.title'),
    '',
    t(lang, 'language.prompt'),
    '',
    t(lang, 'language.current', { language: languageLabel(lang) }),
    '',
    t(lang, 'language.note'),
  ].join('\n');

  return { text, keyboard };
}

export function compressionPanel(lang: Lang): Panel {
  const keyboard = new InlineKeyboard()
    .url(t(lang, 'menu.compress'), COMPRESSION_URL)
    .row()
    .text(t(lang, 'menu.back'), 'menu:home');

  const text = [
    t(lang, 'compression.title'),
    '',
    t(lang, 'compression.step1'),
    t(lang, 'compression.step2'),
    t(lang, 'compression.step3'),
    t(lang, 'compression.step4'),
    t(lang, 'compression.step5'),
    t(lang, 'compression.step6'),
    '',
    t(lang, 'compression.external'),
    t(lang, 'compression.neverUpload'),
    t(lang, 'compression.sensitive'),
  ].join('\n');

  return { text, keyboard };
}

export function progressText(
  lang: Lang,
  step: number,
  total: number,
  label: string,
): string {
  return [t(lang, 'ws.run.progress', { step, total, label }), '', t(lang, 'ws.run.cancelHint')].join(
    '\n',
  );
}

export function rasterProgressText(
  lang: Lang,
  step: number,
  total: number,
  label: string,
  done: number,
  totalPages: number,
): string {
  return [
    t(lang, 'ws.run.rasterProgress', { step, total, label, done, totalPages }),
    '',
    t(lang, 'ws.run.cancelHint'),
  ].join('\n');
}

export interface CompletionInfo {
  outputName: string;
  zip: boolean;
  fileCount: number;
  pages: number;
  tools: number;
  outputBytes: number;
  durationMs: number;
}

export function completionText(lang: Lang, info: CompletionInfo): string {
  const lines = [t(lang, 'ws.run.completeTitle'), ''];
  if (info.zip) {
    lines.push(
      t(lang, 'ws.run.completeFiles', { count: info.fileCount }),
      t(lang, 'ws.run.completeFile', { name: info.outputName }),
    );
  } else {
    lines.push(t(lang, 'ws.run.completeFile', { name: info.outputName }));
  }
  lines.push(
    t(lang, 'ws.run.pages', { pages: info.pages }),
    t(lang, 'ws.run.tools', { count: info.tools }),
    t(lang, 'ws.run.duration', { duration: formatDuration(lang, Math.max(0, info.durationMs)) }),
    info.zip
      ? t(lang, 'ws.run.outputZip', { size: formatBytes(info.outputBytes) })
      : t(lang, 'ws.run.output', { size: formatBytes(info.outputBytes) }),
    '',
    t(lang, 'ws.run.expiredNote'),
  );
  return lines.join('\n');
}

export function failureText(lang: Lang, message: string, failedLabel?: string): string {
  const lines = [t(lang, 'ws.run.failedTitle')];
  if (failedLabel) lines.push(t(lang, 'ws.run.failedStep', { label: failedLabel }));
  lines.push(t(lang, 'ws.run.error', { error: message }), '', t(lang, 'ws.run.originalsKept'));
  return lines.join('\n');
}

export function retryKeyboard(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, 'ws.btn.retry'), 'ws:retry')
    .row()
    .text(t(lang, 'ws.btn.back'), 'ws:back')
    .text(t(lang, 'ws.btn.menu'), 'menu:home');
}

export function resultKeyboard(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, 'ws.run.newWorkspace'), 'ws:new')
    .row()
    .text(t(lang, 'ws.btn.menu'), 'menu:home');
}

export function processingKeyboard(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, 'ws.btn.cancelRun'), 'ws:cancelrun')
    .row()
    .text(t(lang, 'ws.btn.menu'), 'menu:home');
}
