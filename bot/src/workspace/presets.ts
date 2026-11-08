import type { TranslationKey } from '../bot/i18n.js';
import { DEFAULT_NUP_SETTINGS } from '../pdf/nup.js';
import type { NupSettings } from '../pdf/nup.js';
import { newOperation } from './operations.js';
import type { Workspace, WorkspaceOperation } from './types.js';

export type PresetId = 'print' | 'compact' | 'ink' | 'presentation';

export interface PresetDefinition {
  labelKey: TranslationKey;
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
  print: {
    labelKey: 'ws.presets.print',
    build: () => [
      gray(),
      nup({
        perPage: 2,
        paper: 'a4',
        orientation: 'portrait',
        margin: 'normal',
        gap: 8,
        separators: false,
        pageNumbers: true,
        numberPosition: 'bottom-center',
        numberSize: 10,
      }),
    ],
  },
  compact: {
    labelKey: 'ws.presets.compact',
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
  ink: {
    labelKey: 'ws.presets.ink',
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
  presentation: {
    labelKey: 'ws.presets.presentation',
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
};

export const PRESET_IDS: readonly PresetId[] = [
  'print',
  'compact',
  'ink',
  'presentation',
];

export function isPresetId(value: string): value is PresetId {
  return (PRESET_IDS as readonly string[]).includes(value);
}

export function applyPreset(workspace: Workspace, presetId: PresetId): WorkspaceOperation[] {
  const preset = PRESETS[presetId];
  workspace.operations = preset.build().map((operation) => {
    const created = newOperation(operation.type, `o${workspace.nextOpSeq}`);
    workspace.nextOpSeq += 1;
    if (created.type === 'nup' && operation.type === 'nup') {
      created.settings = operation.settings;
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
