import { InlineKeyboard } from 'grammy';
import type { AppConfig } from '../config.js';
import type { ToolSession } from '../files/tool-session.js';
import { formatPageList } from '../pdf/organize.js';
import {
  BW_THRESHOLDS,
  CLEAR_THRESHOLDS,
  DPI_PRESETS,
  JPEG_QUALITY,
  rasterPageLimit,
} from '../pdf/raster.js';
import type { RasterFilter } from '../pdf/raster.js';
import { NUP_PRESETS, PAPER_SIZES } from '../pdf/nup.js';
import type { ToolDefinition, ToolId } from '../tools/definitions.js';

function mark(active: boolean, label: string): string {
  return active ? `✅ ${label}` : label;
}

export function toolUploadText(
  definition: ToolDefinition,
  maxUploadMb: number,
  rasterMaxPages: number,
): string {
  const lines = [
    definition.uploadTitle,
    '',
    definition.uploadPrompt,
    '',
    `Send it as a document up to ${maxUploadMb} MB.`,
  ];

  if (['gray', 'bw', 'invert', 'clear'].includes(definition.id)) {
    lines.push(
      `Color operations are limited to ${rasterMaxPages} pages, with lower caps at higher quality.`,
    );
  } else {
    lines.push('The PDF is deleted immediately after delivery.');
  }

  return lines.join('\n');
}

export function toolUploadKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('Cancel', 'ts:cancel');
}

export function inputPromptText(session: ToolSession): string {
  const awaiting = session.settings.awaiting;
  if (awaiting === 'group-size') {
    return [
      `Send a group size from 1 to ${session.pages}, or tap a preset below.`,
      `This PDF has ${session.pages} pages.`,
    ].join('\n');
  }
  if (awaiting === 'number-start') {
    return 'Send the first sheet number (1 or higher).';
  }
  if (awaiting === 'order' || (session.tool === 'reorder' && !session.settings.indices)) {
    return [
      'Send the new page order using every page exactly once.',
      `Example: ${exampleOrder(session.pages)}`,
      '',
      `Total pages: ${session.pages}.`,
    ].join('\n');
  }

  const action =
    session.tool === 'select'
      ? session.settings.mode === 'keep'
        ? 'pages to keep'
        : 'pages to remove'
      : session.tool === 'rotate'
        ? 'pages to rotate'
        : 'pages to extract';

  return [
    `Send the ${action} in this chat.`,
    'Use commas or ranges: 1-5, 8, 10-15.',
    '',
    `Total pages: ${session.pages}.`,
  ].join('\n');
}

export function inputPromptKeyboard(session: ToolSession): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (session.settings.awaiting === 'group-size') {
    for (const size of [2, 5, 10]) {
      if (size <= session.pages) keyboard.text(String(size), `ts:groupsize:${size}`);
    }
    keyboard.row();
  }

  return keyboard.text('Cancel', 'ts:cancel');
}

function exampleOrder(pageCount: number): string {
  const pages = Array.from({ length: Math.min(pageCount, 6) }, (_, index) => index + 1);
  if (pages.length > 2) {
    [pages[0], pages[1]] = [pages[1]!, pages[0]!];
  }
  return pages.join(',');
}

function baseHeader(session: ToolSession): string[] {
  return [`File: ${session.fileName || 'PDF'}`, `Pages: ${session.pages}`];
}

export function toolPanel(session: ToolSession, config: AppConfig): {
  text: string;
  keyboard: InlineKeyboard;
} {
  switch (session.tool) {
    case 'split':
      return splitPanel(session);
    case 'select':
      return selectionPanel(session);
    case 'reorder':
      return reorderPanel(session);
    case 'rotate':
      return rotatePanel(session);
    case 'gray':
    case 'bw':
    case 'invert':
    case 'clear':
      return rasterPanel(session, config);
    case 'nup':
      return nupPanel(session);
  }
}

function splitPanel(session: ToolSession): { text: string; keyboard: InlineKeyboard } {
  const { mode, indices, groupSize } = session.settings;

  if (mode === 'extract') {
    if (!indices) {
      return {
        text: inputPromptText(session),
        keyboard: inputPromptKeyboard(session),
      };
    }
    return {
      text: [
        '✂️ Extract pages',
        ...baseHeader(session),
        '',
        `Selected: ${formatPageList(indices)}`,
        `Output: one PDF with ${indices.length} page${indices.length === 1 ? '' : 's'}.`,
      ].join('\n'),
      keyboard: new InlineKeyboard()
        .text('✅ Process', 'ts:go')
        .row()
        .text('Change pages', 'ts:split:extract')
        .text('Back', 'ts:split:menu')
        .row()
        .text('Cancel', 'ts:cancel'),
    };
  }

  if (mode === 'every') {
    return {
      text: [
        '✂️ Split every page',
        ...baseHeader(session),
        '',
        `Output: ${session.pages} single-page PDFs in one ZIP.`,
      ].join('\n'),
      keyboard: new InlineKeyboard()
        .text('✅ Process', 'ts:go')
        .row()
        .text('Back', 'ts:split:menu')
        .text('Cancel', 'ts:cancel'),
    };
  }

  if (mode === 'groups') {
    if (!groupSize) {
      return {
        text: inputPromptText(session),
        keyboard: inputPromptKeyboard(session),
      };
    }
    const groups = Math.ceil(session.pages / groupSize);
    return {
      text: [
        '✂️ Split into equal groups',
        ...baseHeader(session),
        '',
        `Group size: ${groupSize} pages`,
        `Output: ${groups} PDF${groups === 1 ? '' : 's'} in one ZIP (the last group may be smaller).`,
      ].join('\n'),
      keyboard: new InlineKeyboard()
        .text('✅ Process', 'ts:go')
        .row()
        .text('Change size', 'ts:split:groups')
        .text('Back', 'ts:split:menu')
        .row()
        .text('Cancel', 'ts:cancel'),
    };
  }

  return {
    text: ['✂️ Split PDF', ...baseHeader(session), '', 'Choose how to split:'].join('\n'),
    keyboard: new InlineKeyboard()
      .text('✂️ Extract pages', 'ts:split:extract')
      .row()
      .text('📄 Every page (ZIP)', 'ts:split:every')
      .row()
      .text('📚 Equal groups', 'ts:split:groups')
      .row()
      .text('Cancel', 'ts:cancel'),
  };
}

function selectionPanel(session: ToolSession): { text: string; keyboard: InlineKeyboard } {
  const { mode, indices } = session.settings;

  if (mode === 'keep' || mode === 'remove') {
    if (!indices) {
      return {
        text: inputPromptText(session),
        keyboard: inputPromptKeyboard(session),
      };
    }

    const resulting = mode === 'keep' ? indices.length : session.pages - indices.length;
    return {
      text: [
        mode === 'keep' ? '📑 Keep selected pages' : '📑 Remove selected pages',
        ...baseHeader(session),
        '',
        `Selected: ${formatPageList(indices)}`,
        `Result: ${resulting} page${resulting === 1 ? '' : 's'}.`,
      ].join('\n'),
      keyboard: new InlineKeyboard()
        .text('✅ Process', 'ts:go')
        .row()
        .text('Change pages', `ts:sel:${mode}`)
        .text('Back', 'ts:sel:menu')
        .row()
        .text('Cancel', 'ts:cancel'),
    };
  }

  return {
    text: ['📑 Page Selection', ...baseHeader(session), '', 'Choose what to do with the pages:'].join(
      '\n',
    ),
    keyboard: new InlineKeyboard()
      .text('✅ Keep selected', 'ts:sel:keep')
      .row()
      .text('🗑 Remove selected', 'ts:sel:remove')
      .row()
      .text('Cancel', 'ts:cancel'),
  };
}

function reorderPanel(session: ToolSession): { text: string; keyboard: InlineKeyboard } {
  const { indices } = session.settings;

  if (!indices) {
    return {
      text: inputPromptText(session),
      keyboard: inputPromptKeyboard(session),
    };
  }

  return {
    text: [
      '🔀 Page Reorder',
      ...baseHeader(session),
      '',
      `New order: ${formatPageList(indices)}`,
      `All ${session.pages} pages are included once.`,
    ].join('\n'),
    keyboard: new InlineKeyboard()
      .text('✅ Process', 'ts:go')
      .row()
      .text('Change order', 'ts:reorder:prompt')
      .row()
      .text('Cancel', 'ts:cancel'),
  };
}

function rotatePanel(session: ToolSession): { text: string; keyboard: InlineKeyboard } {
  const { angle, scope, indices } = session.settings;

  if (angle !== 90 && angle !== 180 && angle !== 270) {
    return {
      text: ['🔄 Rotate PDF', ...baseHeader(session), '', 'Choose a rotation:'].join('\n'),
      keyboard: new InlineKeyboard()
        .text('↻ 90° clockwise', 'ts:angle:90')
        .text('↻ 180°', 'ts:angle:180')
        .row()
        .text('↻ 270° clockwise', 'ts:angle:270')
        .row()
        .text('Cancel', 'ts:cancel'),
    };
  }

  if (!scope) {
    return {
      text: [
        '🔄 Rotate PDF',
        ...baseHeader(session),
        '',
        `Rotation: ${angle}° clockwise`,
        'Rotate every page or selected pages?',
      ].join('\n'),
      keyboard: new InlineKeyboard()
        .text('All pages', 'ts:scope:all')
        .row()
        .text('Selected pages', 'ts:scope:selected')
        .row()
        .text('Change angle', 'ts:angle:menu')
        .text('Cancel', 'ts:cancel'),
    };
  }

  if (scope === 'selected' && !indices) {
    return {
      text: inputPromptText(session),
      keyboard: inputPromptKeyboard(session),
    };
  }

  const count = scope === 'all' ? session.pages : indices?.length ?? 0;
  return {
    text: [
      '🔄 Rotate PDF',
      ...baseHeader(session),
      '',
      `Rotation: ${angle}° clockwise`,
      scope === 'all'
        ? `Pages: all ${session.pages}`
        : `Pages: ${formatPageList(indices ?? [])}`,
      `Output: ${count} rotated page${count === 1 ? '' : 's'}.`,
    ].join('\n'),
    keyboard: new InlineKeyboard()
      .text('✅ Process', 'ts:go')
      .row()
      .text('Change angle', 'ts:angle:menu')
      .text('Cancel', 'ts:cancel'),
  };
}

function rasterPanel(
  session: ToolSession,
  config: AppConfig,
): { text: string; keyboard: InlineKeyboard } {
  const quality = session.settings.quality ?? 'medium';
  const dpi = DPI_PRESETS[quality];
  const jpeg = Math.round(JPEG_QUALITY[quality] * 100);
  const keyboard = new InlineKeyboard()
    .text(mark(quality === 'low', `Low ${DPI_PRESETS.low} DPI`), 'ts:q:low')
    .text(mark(quality === 'medium', `Medium ${DPI_PRESETS.medium}`), 'ts:q:medium')
    .text(mark(quality === 'high', `High ${DPI_PRESETS.high}`), 'ts:q:high')
    .row();

  const limit = rasterPageLimit(session.tool as RasterFilter, quality, config.rasterMaxPages);
  const lines = [`Pages: ${session.pages} · Limit: ${limit} at ${quality} quality`];
  if (session.pages > limit) {
    lines.push(`⚠️ Choose a lower quality or a shorter PDF to continue.`);
  }
  const labels: Record<string, string> = {
    gray: '⚪ Grayscale',
    bw: '⚫ Black & White',
    invert: '🌗 Invert Colors',
    clear: '🧽 Clear Background',
  };

  if (session.tool !== 'bw') {
    lines.push(`Quality: ${quality} · ${dpi} DPI · JPEG ${jpeg}%`);
  } else {
    lines.push(`Quality: ${quality} · ${dpi} DPI`);
  }

  if (session.tool === 'bw') {
    const threshold = session.settings.threshold ?? 'balanced';
    lines.push(
      '',
      `Threshold: ${threshold} (${BW_THRESHOLDS[threshold]}). Higher = more black.`,
    );
    keyboard
      .text(mark(threshold === 'light', 'Light'), 'ts:thr:light')
      .text(mark(threshold === 'balanced', 'Balanced'), 'ts:thr:balanced')
      .text(mark(threshold === 'strong', 'Strong'), 'ts:thr:strong')
      .row();
  }

  if (session.tool === 'clear') {
    const level = session.settings.clearLevel ?? 'medium';
    lines.push(
      '',
      `Cleanup: ${level} (threshold ${CLEAR_THRESHOLDS[level]}). Higher cleans more off-white.`,
    );
    keyboard
      .text(mark(level === 'low', 'Low'), 'ts:clear:low')
      .text(mark(level === 'medium', 'Medium'), 'ts:clear:medium')
      .text(mark(level === 'high', 'High'), 'ts:clear:high')
      .row();
  }

  keyboard.text('✅ Process', 'ts:go').row().text('Cancel', 'ts:cancel');

  return {
    text: [labels[session.tool]!, ...baseHeader(session), '', ...lines].join('\n'),
    keyboard,
  };
}

function orientationLabel(orientation: 'portrait' | 'landscape' | 'auto'): string {
  return orientation === 'auto'
    ? 'Auto'
    : orientation === 'portrait'
      ? 'Portrait'
      : 'Landscape';
}

function nupPanel(session: ToolSession): { text: string; keyboard: InlineKeyboard } {
  const settings = session.settings.nup;
  if (!settings) {
    return { text: 'N-up settings are unavailable. Cancel and start again.', keyboard: new InlineKeyboard().text('Cancel', 'ts:cancel') };
  }

  const preset = NUP_PRESETS[settings.perPage];
  const sheets = Math.ceil(session.pages / settings.perPage);
  const paper = PAPER_SIZES[settings.paper];
  const keyboard = new InlineKeyboard()
    .text(mark(settings.perPage === 2, '2-in-1'), 'ts:nup:2')
    .text(mark(settings.perPage === 4, '4-in-1'), 'ts:nup:4')
    .text(mark(settings.perPage === 6, '6-in-1'), 'ts:nup:6')
    .text(mark(settings.perPage === 9, '9-in-1'), 'ts:nup:9')
    .row();

  for (const [id, size] of Object.entries(PAPER_SIZES)) {
    keyboard.text(
      mark(settings.paper === id, size.label),
      `ts:paper:${id}`,
    );
  }
  keyboard.row();

  keyboard
    .text(mark(settings.orientation === 'portrait', 'Portrait'), 'ts:orient:portrait')
    .text(mark(settings.orientation === 'landscape', 'Landscape'), 'ts:orient:landscape')
    .text(mark(settings.orientation === 'auto', 'Auto'), 'ts:orient:auto')
    .row();

  keyboard
    .text(mark(settings.margin === 'compact', 'Compact'), 'ts:margin:compact')
    .text(mark(settings.margin === 'normal', 'Normal'), 'ts:margin:normal')
    .text(mark(settings.margin === 'wide', 'Wide'), 'ts:margin:wide')
    .row();

  keyboard
    .text(mark(settings.gap === 0, 'No gap'), 'ts:gap:0')
    .text(mark(settings.gap === 8, '8 pt gap'), 'ts:gap:8')
    .text(mark(settings.gap === 16, '16 pt gap'), 'ts:gap:16')
    .row();

  keyboard
    .text(mark(settings.separators, 'Separators'), 'ts:sep:on')
    .text(mark(!settings.separators, 'No separators'), 'ts:sep:off')
    .row()
    .text(mark(settings.pageNumbers, 'Page numbers'), 'ts:num:on')
    .text(mark(!settings.pageNumbers, 'No numbers'), 'ts:num:off')
    .row();

  if (settings.pageNumbers) {
    keyboard
      .text(
        mark(settings.numberPosition === 'bottom-center', 'Bottom center'),
        'ts:numpos:bottom-center',
      )
      .text(
        mark(settings.numberPosition === 'bottom-right', 'Bottom right'),
        'ts:numpos:bottom-right',
      )
      .text(mark(settings.numberPosition === 'top-center', 'Top center'), 'ts:numpos:top-center')
      .row()
      .text(mark(settings.numberSize === 8, '8 pt'), 'ts:numsize:8')
      .text(mark(settings.numberSize === 10, '10 pt'), 'ts:numsize:10')
      .text(mark(settings.numberSize === 12, '12 pt'), 'ts:numsize:12')
      .row()
      .text(`Start number: ${settings.numberStart}`, 'ts:numstart:prompt')
      .row();
  }

  keyboard.text('✅ Process', 'ts:go').row().text('Cancel', 'ts:cancel');

  return {
    text: [
      '🧾 N-up Layout',
      ...baseHeader(session),
      '',
      `Layout: ${preset.label} (${preset.rows}×${preset.cols})`,
      `Paper: ${paper.label} · Orientation: ${orientationLabel(settings.orientation)}`,
      `Margins: ${settings.margin} · Spacing: ${settings.gap} pt`,
      `Separators: ${settings.separators ? 'on' : 'off'}`,
      settings.pageNumbers
        ? `Page numbers: on · start ${settings.numberStart} · ${settings.numberPosition.replace('-', ' ')} · ${settings.numberSize} pt`
        : 'Page numbers: off',
      '',
      `Output: ${sheets} sheet${sheets === 1 ? '' : 's'} for ${session.pages} pages.`,
    ].join('\n'),
    keyboard,
  };
}

export function toolResultKeyboard(tool: ToolId): InlineKeyboard {
  return new InlineKeyboard()
    .text('Do another', `ts:retry:${tool}`)
    .row()
    .text('Back to menu', 'menu:home');
}

export function toolErrorKeyboard(tool: ToolId): InlineKeyboard {
  return new InlineKeyboard()
    .text('Try again', `ts:retry:${tool}`)
    .row()
    .text('Back to menu', 'menu:home');
}
