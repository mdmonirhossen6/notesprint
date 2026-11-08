import type { TranslationKey } from '../bot/i18n.js';
import { DEFAULT_NUP_SETTINGS } from '../pdf/nup.js';
import type { NupSettings } from '../pdf/nup.js';
import { rasterPageLimit } from '../pdf/raster.js';
import { isPdfTextDrawable } from '../pdf/personalize.js';
import type { RasterFilter } from '../pdf/raster.js';
import {
  MAX_PIPELINE_FILES,
  MAX_WORKSPACE_FILES,
} from './types.js';
import type {
  AwaitingField,
  FooterOperation,
  MetadataOperation,
  NupOperation,
  OperationType,
  RasterOperation,
  ReorderOperation,
  RemainingPagesConfig,
  RotateOperation,
  SelectOperation,
  SplitOperation,
  TimestampOperation,
  WatermarkOperation,
  Workspace,
  WorkspaceOperation,
} from './types.js';

export type OperationCategory = 'organization' | 'color' | 'layout' | 'personalization';

export interface CategoryDefinition {
  labelKey: TranslationKey;
  types: readonly OperationType[];
}

export const OPERATION_CATEGORIES: Record<OperationCategory, CategoryDefinition> = {
  organization: {
    labelKey: 'ws.cat.org',
    types: ['split', 'select', 'reorder', 'rotate'],
  },
  color: {
    labelKey: 'ws.cat.color',
    types: ['gray', 'bw', 'invert', 'clear'],
  },
  layout: {
    labelKey: 'ws.cat.layout',
    types: ['nup'],
  },
  personalization: {
    labelKey: 'ws.cat.personal',
    types: ['watermark', 'metadata', 'timestamp', 'footer'],
  },
};

export const OPERATION_LABEL_KEYS: Record<OperationType, TranslationKey> = {
  split: 'ws.op.split',
  select: 'ws.op.select',
  reorder: 'ws.op.reorder',
  rotate: 'ws.op.rotate',
  gray: 'ws.op.gray',
  bw: 'ws.op.bw',
  invert: 'ws.op.invert',
  clear: 'ws.op.clear',
  nup: 'ws.op.nup',
  watermark: 'ws.op.watermark',
  metadata: 'ws.op.metadata',
  timestamp: 'ws.op.timestamp',
  footer: 'ws.op.footer',
};

export function operationLabelKey(type: OperationType): TranslationKey {
  return OPERATION_LABEL_KEYS[type];
}

export function operationCategory(type: OperationType): OperationCategory {
  for (const [category, definition] of Object.entries(OPERATION_CATEGORIES)) {
    if (definition.types.includes(type)) return category as OperationCategory;
  }
  return 'organization';
}

export function newOperation(type: OperationType, id: string): WorkspaceOperation {
  switch (type) {
    case 'split':
      return { id, type, mode: undefined, indices: undefined, groupSize: undefined };
    case 'select':
      return { id, type, mode: undefined, indices: undefined };
    case 'reorder':
      return { id, type, indices: undefined };
    case 'rotate':
      return { id, type, angle: 90, scope: 'all', indices: undefined };
    case 'gray':
    case 'invert':
      return { id, type, quality: 'medium' };
    case 'bw':
      return { id, type, quality: 'medium', threshold: 'balanced' };
    case 'clear':
      return { id, type, quality: 'medium', clearLevel: 'medium' };
    case 'nup':
      return { id, type, settings: { ...DEFAULT_NUP_SETTINGS } };
    case 'watermark':
      return {
        id,
        type,
        text: '',
        size: 48,
        opacity: 0.25,
        rotation: 45,
        position: 'center',
        scope: 'all',
        indices: undefined,
      };
    case 'metadata':
      return { id, type, title: '', author: '', subject: '', keywords: '' };
    case 'timestamp':
      return { id, type, customText: '' };
    case 'footer':
      return {
        id,
        type,
        text: '',
        pageNumbers: true,
        timestamp: false,
        position: 'center',
        size: 10,
      };
  }
}

export function addOperation(workspace: Workspace, type: OperationType): WorkspaceOperation {
  const operation = newOperation(type, `o${workspace.nextOpSeq}`);
  workspace.nextOpSeq += 1;
  workspace.operations.push(operation);
  workspace.awaitingText = promptForNewOperation(operation);
  return operation;
}

export function promptForNewOperation(operation: WorkspaceOperation): {
  operationId: string;
  field: AwaitingField;
} | null {
  switch (operation.type) {
    case 'watermark':
      return { operationId: operation.id, field: 'watermark-text' };
    case 'footer':
      return { operationId: operation.id, field: 'footer-text' };
    case 'metadata':
      return { operationId: operation.id, field: 'metadata-title' };
    default:
      return null;
  }
}

export function removeOperation(workspace: Workspace, index: number): boolean {
  if (index < 0 || index >= workspace.operations.length) return false;
  workspace.operations.splice(index, 1);
  workspace.awaitingText = null;
  return true;
}

export function moveOperation(
  workspace: Workspace,
  index: number,
  direction: 'up' | 'down',
): boolean {
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || index >= workspace.operations.length) return false;
  if (target < 0 || target >= workspace.operations.length) return false;
  const [operation] = workspace.operations.splice(index, 1);
  if (!operation) return false;
  workspace.operations.splice(target, 0, operation);
  workspace.awaitingText = null;
  return true;
}

export function clearOperations(workspace: Workspace): void {
  workspace.operations = [];
  workspace.awaitingText = null;
}

export interface SimFile {
  name: string;
  pages: number;
}

export interface SimStage {
  operation: WorkspaceOperation;
  before: SimFile[];
  after: SimFile[];
}

export interface SimWarning {
  key: TranslationKey;
  params?: Record<string, string | number>;
}

export interface Simulation {
  stages: SimStage[];
  finalFiles: SimFile[];
  warnings: SimWarning[];
}

export type WorkspaceIssueCode =
  | 'noFiles'
  | 'configure'
  | 'tooManyOutputs'
  | 'pageRangeMax'
  | 'emptyResult'
  | 'reorderMismatch'
  | 'groupSize'
  | 'rasterLimit'
  | 'metadataEmpty'
  | 'textRequired'
  | 'unsupportedText'
  | 'footerEmpty'
  | 'mergeFiles'
  | 'totalPages';

export interface WorkspaceIssue {
  code: WorkspaceIssueCode;
  params?: Record<string, string | number>;
  operationIndex?: number;
  operationLabelKey?: TranslationKey;
}

export class WorkspaceValidationError extends Error {
  constructor(readonly issue: WorkspaceIssue) {
    super(`workspace validation failed: ${issue.code}`);
    this.name = 'WorkspaceValidationError';
  }
}

function baseName(name: string): string {
  return name.replace(/\.pdf$/i, '').replace(/[^\w\u0980-\u09FF ._-]+/g, '').trim().slice(0, 48) ||
    'document';
}

function uniqueSorted(indices: readonly number[]): number[] {
  return [...new Set(indices)].sort((a, b) => a - b);
}

function isPermutation(indices: readonly number[] | undefined, pages: number): boolean {
  if (!indices || indices.length !== pages) return false;
  const seen = new Set(indices);
  if (seen.size !== pages) return false;
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= pages) return false;
  }
  return true;
}

function requireIndices(
  indices: readonly number[] | undefined,
  files: readonly SimFile[],
  operationIndex: number,
): number[] {
  if (!indices || indices.length === 0) {
    throw new WorkspaceValidationError({
      code: 'configure',
      operationIndex,
      params: { reason: 'pages' },
    });
  }
  const unique = uniqueSorted(indices);
  for (const file of files) {
    for (const index of unique) {
      if (index >= file.pages) {
        throw new WorkspaceValidationError({
          code: 'pageRangeMax',
          params: { pages: file.pages, file: file.name },
          operationIndex,
        });
      }
    }
  }
  return unique;
}

function splitFiles(file: SimFile, operation: SplitOperation, operationIndex: number): SimFile[] {
  const base = baseName(file.name);
  if (operation.mode === 'every') {
    return Array.from({ length: file.pages }, (_, index) => ({
      name: `${base}-page-${index + 1}`,
      pages: 1,
    }));
  }
  if (operation.mode === 'groups') {
    const size = operation.groupSize;
    if (!size || !Number.isInteger(size) || size < 1) {
      throw new WorkspaceValidationError({
        code: 'configure',
        operationIndex,
        params: { reason: 'group-size' },
      });
    }
    if (size > file.pages) {
      throw new WorkspaceValidationError({
        code: 'groupSize',
        params: { pages: file.pages },
        operationIndex,
      });
    }
    const groups: SimFile[] = [];
    for (let start = 0; start < file.pages; start += size) {
      groups.push({
        name: `${base}-group-${groups.length + 1}`,
        pages: Math.min(size, file.pages - start),
      });
    }
    return groups;
  }
  if (operation.mode === 'extract') {
    const indices = requireIndices(operation.indices, [file], operationIndex);
    return [{ name: `${base}-extracted`, pages: indices.length }];
  }
  throw new WorkspaceValidationError({
    code: 'configure',
    operationIndex,
    params: { reason: 'split-mode' },
  });
}

function transformFile(
  file: SimFile,
  operation: WorkspaceOperation,
  operationIndex: number,
  config: RemainingPagesConfig,
): SimFile[] {
  const base = baseName(file.name);

  switch (operation.type) {
    case 'split':
      return splitFiles(file, operation, operationIndex);

    case 'select': {
      if (operation.mode !== 'keep' && operation.mode !== 'remove') {
        throw new WorkspaceValidationError({
          code: 'configure',
          operationIndex,
          params: { reason: 'selection-mode' },
        });
      }
      const indices = requireIndices(operation.indices, [file], operationIndex);
      const pages = operation.mode === 'keep' ? indices.length : file.pages - indices.length;
      if (pages < 1) {
        throw new WorkspaceValidationError({
          code: 'emptyResult',
          operationIndex,
        });
      }
      return [
        {
          name: `${base}-${operation.mode === 'keep' ? 'selected' : 'filtered'}`,
          pages,
        },
      ];
    }

    case 'reorder': {
      if (!operation.indices || operation.indices.length === 0) {
        throw new WorkspaceValidationError({
          code: 'configure',
          operationIndex,
          params: { reason: 'order' },
        });
      }
      if (!isPermutation(operation.indices, file.pages)) {
        throw new WorkspaceValidationError({
          code: 'reorderMismatch',
          params: { pages: file.pages },
          operationIndex,
        });
      }
      return [{ name: `${base}-reordered`, pages: file.pages }];
    }

    case 'rotate': {
      if (operation.scope === 'selected') {
        requireIndices(operation.indices, [file], operationIndex);
      }
      return [{ name: `${base}-rotated`, pages: file.pages }];
    }

    case 'gray':
    case 'bw':
    case 'invert':
    case 'clear': {
      const filter = operation.type as RasterFilter;
      const limit = rasterPageLimit(filter, operation.quality, config.rasterMaxPages);
      if (file.pages > limit) {
        throw new WorkspaceValidationError({
          code: 'rasterLimit',
          params: {
            labelKey: OPERATION_LABEL_KEYS[operation.type],
            label: operation.type,
            limit,
            quality: operation.quality,
            name: file.name,
            pages: file.pages,
          },
          operationIndex,
          operationLabelKey: OPERATION_LABEL_KEYS[operation.type],
        });
      }
      return [{ name: `${base}-${operation.type}`, pages: file.pages }];
    }

    case 'nup':
      return [
        {
          name: `${base}-nup`,
          pages: Math.ceil(file.pages / operation.settings.perPage),
        },
      ];

    case 'watermark': {
      if (!operation.text.trim()) {
        throw new WorkspaceValidationError({
          code: 'textRequired',
          operationIndex,
          operationLabelKey: OPERATION_LABEL_KEYS.watermark,
        });
      }
      if (!isPdfTextDrawable(operation.text)) {
        throw new WorkspaceValidationError({
          code: 'unsupportedText',
          operationIndex,
          operationLabelKey: OPERATION_LABEL_KEYS.watermark,
        });
      }
      if (operation.scope === 'selected') {
        requireIndices(operation.indices, [file], operationIndex);
      }
      return [{ name: `${base}-watermarked`, pages: file.pages }];
    }

    case 'metadata': {
      const values = [
        operation.title,
        operation.author,
        operation.subject,
        operation.keywords,
      ].filter((value) => value.trim().length > 0);
      if (values.length === 0) {
        throw new WorkspaceValidationError({
          code: 'metadataEmpty',
          operationIndex,
          operationLabelKey: OPERATION_LABEL_KEYS.metadata,
        });
      }
      return [{ name: base, pages: file.pages }];
    }

    case 'timestamp':
      if (operation.customText.trim() && !isPdfTextDrawable(operation.customText)) {
        throw new WorkspaceValidationError({
          code: 'unsupportedText',
          operationIndex,
          operationLabelKey: OPERATION_LABEL_KEYS.timestamp,
        });
      }
      return [{ name: `${base}-timestamp`, pages: file.pages }];

    case 'footer': {
      if (!operation.text.trim() && !operation.pageNumbers && !operation.timestamp) {
        throw new WorkspaceValidationError({
          code: 'footerEmpty',
          operationIndex,
          operationLabelKey: OPERATION_LABEL_KEYS.footer,
        });
      }
      if (operation.text.trim() && !isPdfTextDrawable(operation.text)) {
        throw new WorkspaceValidationError({
          code: 'unsupportedText',
          operationIndex,
          operationLabelKey: OPERATION_LABEL_KEYS.footer,
        });
      }
      return [{ name: `${base}-footer`, pages: file.pages }];
    }
  }
}

export function initialFiles(workspace: Workspace): SimFile[] {
  if (workspace.files.length === 0) return [];
  if (workspace.mode === 'individual') {
    return workspace.files.map((file) => ({
      name: baseName(file.name),
      pages: file.pages,
    }));
  }
  if (workspace.files.length === 1) {
    const file = workspace.files[0]!;
    return [{ name: baseName(file.name), pages: file.pages }];
  }
  return [
    {
      name: 'notesprint-merged',
      pages: workspace.files.reduce((sum, file) => sum + file.pages, 0),
    },
  ];
}

export function simulateWorkspace(
  workspace: Workspace,
  config: RemainingPagesConfig,
  operations: readonly WorkspaceOperation[] = workspace.operations,
): Simulation {
  if (workspace.files.length === 0) {
    throw new WorkspaceValidationError({ code: 'noFiles' });
  }

  const totalPages = workspace.files.reduce((sum, file) => sum + file.pages, 0);
  if (totalPages > config.maxPages) {
    throw new WorkspaceValidationError({
      code: 'totalPages',
      params: { max: config.maxPages },
    });
  }
  if (workspace.mode === 'combine' && workspace.files.length > config.mergeMaxFiles) {
    throw new WorkspaceValidationError({
      code: 'mergeFiles',
      params: { max: config.mergeMaxFiles },
    });
  }

  let files = initialFiles(workspace);
  const stages: SimStage[] = [];
  const warnings: SimWarning[] = [];

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index]!;
    const before = files;
    const after: SimFile[] = [];

    for (const file of before) {
      after.push(...transformFile(file, operation, index, config));
    }

    if (after.length > MAX_PIPELINE_FILES) {
      throw new WorkspaceValidationError({
        code: 'tooManyOutputs',
        params: { count: after.length, max: MAX_PIPELINE_FILES },
        operationIndex: index,
        operationLabelKey: OPERATION_LABEL_KEYS[operation.type],
      });
    }

    stages.push({ operation, before, after });
    files = after;
  }

  if (files.length > MAX_PIPELINE_FILES) {
    throw new WorkspaceValidationError({
      code: 'tooManyOutputs',
      params: { count: files.length, max: MAX_PIPELINE_FILES },
    });
  }

  const hasSplit = stages.some((stage) => stage.operation.type === 'split');
  const hasLaterStep = stages.some(
    (stage, index) => index > 0 && stages[index - 1]!.operation.type === 'split',
  );
  if (hasSplit && hasLaterStep) {
    warnings.push({ key: 'ws.review.splitMulti' });
  }
  if (workspace.mode === 'individual' && files.length > 1) {
    warnings.push({ key: 'ws.review.individualZip' });
  }

  return { stages, finalFiles: files, warnings };
}

export type ValidationResult =
  | { ok: true; simulation: Simulation }
  | { ok: false; issue: WorkspaceIssue; simulation?: Simulation };

export function validateWorkspace(
  workspace: Workspace,
  config: RemainingPagesConfig,
): ValidationResult {
  try {
    return { ok: true, simulation: simulateWorkspace(workspace, config) };
  } catch (error) {
    if (error instanceof WorkspaceValidationError) {
      return { ok: false, issue: error.issue };
    }
    throw error;
  }
}

export function filesBeforeOperation(
  workspace: Workspace,
  operationIndex: number,
  config: RemainingPagesConfig,
): SimFile[] {
  try {
    const simulation = simulateWorkspace(
      workspace,
      config,
      workspace.operations.slice(0, Math.max(0, operationIndex)),
    );
    return simulation.finalFiles;
  } catch {
    try {
      return initialFiles(workspace);
    } catch {
      return [];
    }
  }
}

export function maxPagesBeforeOperation(
  workspace: Workspace,
  operationIndex: number,
  config: RemainingPagesConfig,
): number {
  const files = filesBeforeOperation(workspace, operationIndex, config);
  return files.reduce((max, file) => Math.max(max, file.pages), 0);
}

export function findOperation(
  workspace: Workspace,
  operationId: string,
): WorkspaceOperation | null {
  return workspace.operations.find((operation) => operation.id === operationId) ?? null;
}

export function addFileLimitReached(workspace: Workspace): boolean {
  return workspace.files.length >= MAX_WORKSPACE_FILES;
}

export type { FooterOperation, MetadataOperation, NupOperation, RasterOperation, ReorderOperation, RotateOperation, SelectOperation, SplitOperation, TimestampOperation, WatermarkOperation, NupSettings };
