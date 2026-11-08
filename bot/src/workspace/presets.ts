import type { TranslationKey } from '../bot/i18n.js';
import { DEFAULT_NUP_SETTINGS } from '../pdf/nup.js';
import type {
  MarginPreset,
  NupPerPage,
  NupSettings,
  Orientation,
  PaperSize,
} from '../pdf/nup.js';
import { newOperation } from './operations.js';
import type { PresetId, RasterOperation, Workspace, WorkspaceOperation } from './types.js';

export type { PresetId };

export interface PresetDefinition {
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  build: () => WorkspaceOperation[];
}

function nup(overrides: Partial<NupSettings>): WorkspaceOperation {
  return {
    id: '',
    type: 'nup',
    settings: { ...DEFAULT_NUP_SETTINGS, ...overrides },
  };
}

function gray(): WorkspaceOperation {
  return { id: '', type: 'gray', quality: 'medium' };
}

function bw(): WorkspaceOperation {
  return { id: '', type: 'bw', quality: 'medium', threshold: 'balanced' };
}

export const PRESETS: Record<PresetId, PresetDefinition> = {
  paper: {
    labelKey: 'ws.presets.paper',
    descriptionKey: 'ws.presets.paper.desc',
    build: () => [
      bw(),
      nup({
        perPage: 4,
        paper: 'a4',
        orientation: 'portrait',
        margin: 'normal',
        gap: 8,
        separators: false,
        pageNumbers: false,
      }),
    ],
  },
  compact: {
    labelKey: 'ws.presets.compact',
    descriptionKey: 'ws.presets.compact.desc',
    build: () => [
      gray(),
      nup({
        perPage: 4,
        paper: 'a4',
        orientation: 'landscape',
        margin: 'compact',
        gap: 8,
        separators: false,
        pageNumbers: false,
      }),
    ],
  },
  presentation: {
    labelKey: 'ws.presets.presentation',
    descriptionKey: 'ws.presets.presentation.desc',
    build: () => [
      nup({
        perPage: 2,
        paper: 'a4',
        orientation: 'landscape',
        margin: 'normal',
        gap: 8,
        separators: true,
        pageNumbers: true,
        numberPosition: 'bottom-center',
        numberSize: 10,
      }),
    ],
  },
  original: {
    labelKey: 'ws.presets.original',
    descriptionKey: 'ws.presets.original.desc',
    build: () => [],
  },
};

export const PRESET_IDS: readonly PresetId[] = [
  'paper',
  'compact',
  'presentation',
  'original',
];

export function isPresetId(value: string): value is PresetId {
  return (PRESET_IDS as readonly string[]).includes(value);
}

export function applyPreset(workspace: Workspace, presetId: PresetId): WorkspaceOperation[] {
  const preset = PRESETS[presetId];
  workspace.mode = 'combine';
  workspace.presetId = presetId;
  workspace.operations = preset.build().map((operation) => {
    const created = newOperation(operation.type, `o${workspace.nextOpSeq}`);
    workspace.nextOpSeq += 1;
    if (created.type === 'nup' && operation.type === 'nup') {
      created.settings = { ...operation.settings };
    }
    if (
      (created.type === 'gray' || created.type === 'bw') &&
      (operation.type === 'gray' || operation.type === 'bw')
    ) {
      created.quality = operation.quality;
      if (created.type === 'bw' && operation.type === 'bw') {
        created.threshold = operation.threshold;
      }
    }
    return created;
  });
  workspace.awaitingText = null;
  return workspace.operations;
}

export type PresetColor = 'none' | 'gray' | 'bw';

export interface PresetSettings {
  color: PresetColor;
  perPage: NupPerPage | 1;
  paper: PaperSize;
  orientation: Orientation;
  margin: MarginPreset;
  separators: boolean;
  pageNumbers: boolean;
}

const PERSONAL_TYPES = new Set(['watermark', 'metadata', 'timestamp', 'footer']);

function findNup(workspace: Workspace): WorkspaceOperation & { type: 'nup' } | null {
  for (let index = workspace.operations.length - 1; index >= 0; index -= 1) {
    const operation = workspace.operations[index]!;
    if (operation.type === 'nup') return operation;
  }
  return null;
}

function findRaster(workspace: Workspace): (RasterOperation & { type: 'gray' | 'bw' }) | null {
  for (let index = workspace.operations.length - 1; index >= 0; index -= 1) {
    const operation = workspace.operations[index]!;
    if (operation.type === 'gray' || operation.type === 'bw') {
      return operation as RasterOperation & { type: 'gray' | 'bw' };
    }
  }
  return null;
}

export function readPresetSettings(workspace: Workspace): PresetSettings {
  const raster = findRaster(workspace);
  const nup = findNup(workspace);
  return {
    color: raster ? raster.type : 'none',
    perPage: nup ? nup.settings.perPage : 1,
    paper: nup?.settings.paper ?? 'a4',
    orientation: nup?.settings.orientation ?? 'auto',
    margin: nup?.settings.margin ?? 'normal',
    separators: nup?.settings.separators ?? false,
    pageNumbers: nup?.settings.pageNumbers ?? false,
  };
}

function insertBeforePersonal(workspace: Workspace, operation: WorkspaceOperation): void {
  const index = workspace.operations.findIndex((entry) => PERSONAL_TYPES.has(entry.type));
  workspace.operations.splice(index >= 0 ? index : workspace.operations.length, 0, operation);
}

function insertBeforeLayoutAndPersonal(workspace: Workspace, operation: WorkspaceOperation): void {
  const index = workspace.operations.findIndex(
    (entry) => entry.type === 'nup' || PERSONAL_TYPES.has(entry.type),
  );
  workspace.operations.splice(index >= 0 ? index : workspace.operations.length, 0, operation);
}

function setColor(workspace: Workspace, color: PresetColor): void {
  workspace.operations = workspace.operations.filter(
    (operation) => operation.type !== 'gray' && operation.type !== 'bw',
  );
  if (color === 'none') return;
  const operation = newOperation(color, `o${workspace.nextOpSeq}`);
  workspace.nextOpSeq += 1;
  insertBeforeLayoutAndPersonal(workspace, operation);
}

function ensureNup(workspace: Workspace): WorkspaceOperation & { type: 'nup' } {
  const existing = findNup(workspace);
  if (existing) return existing;
  const operation = newOperation('nup', `o${workspace.nextOpSeq}`) as WorkspaceOperation & {
    type: 'nup';
  };
  workspace.nextOpSeq += 1;
  operation.settings = {
    ...DEFAULT_NUP_SETTINGS,
    orientation: 'portrait',
    separators: false,
    pageNumbers: false,
  };
  insertBeforePersonal(workspace, operation);
  return operation;
}

export function applyPresetCustomization(workspace: Workspace, action: string): boolean {
  const [kind, raw] = action.split(':');
  const value = raw ?? '';

  if (kind === 'color') {
    if (value !== 'none' && value !== 'gray' && value !== 'bw') return false;
    setColor(workspace, value);
  } else if (kind === 'layout') {
    if (value === '1') {
      workspace.operations = workspace.operations.filter((operation) => operation.type !== 'nup');
    } else {
      const perPage = Number(value);
      if (perPage !== 2 && perPage !== 4 && perPage !== 6 && perPage !== 9) return false;
      ensureNup(workspace).settings.perPage = perPage;
    }
  } else if (kind === 'paper') {
    if (!['a4', 'a3', 'a5', 'letter', 'legal'].includes(value)) return false;
    ensureNup(workspace).settings.paper = value as PaperSize;
  } else if (kind === 'orientation') {
    if (!['portrait', 'landscape', 'auto'].includes(value)) return false;
    ensureNup(workspace).settings.orientation = value as Orientation;
  } else if (kind === 'margin') {
    if (!['compact', 'normal', 'wide'].includes(value)) return false;
    ensureNup(workspace).settings.margin = value as MarginPreset;
  } else if (kind === 'sep') {
    if (value !== '0' && value !== '1') return false;
    ensureNup(workspace).settings.separators = value === '1';
  } else if (kind === 'pn') {
    if (value !== '0' && value !== '1') return false;
    ensureNup(workspace).settings.pageNumbers = value === '1';
  } else {
    return false;
  }

  workspace.awaitingText = null;
  return true;
}
