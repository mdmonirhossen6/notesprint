import type { NupSettings } from '../pdf/nup.js';

export type WorkspaceMode = 'combine' | 'individual';
export type WorkspaceStatus = 'collecting' | 'ready' | 'processing' | 'failed';

export const MAX_WORKSPACE_FILES = 10;
export const MAX_PIPELINE_FILES = 40;
export const WORKSPACE_TTL_MS = 30 * 60 * 1000;
export const WORKSPACE_EXPIRY_WARNING_MS = 5 * 60 * 1000;

export type OperationType =
  | 'split'
  | 'select'
  | 'reorder'
  | 'rotate'
  | 'gray'
  | 'bw'
  | 'invert'
  | 'clear'
  | 'nup'
  | 'watermark'
  | 'metadata'
  | 'timestamp'
  | 'footer';

export const ROTATION_ANGLES = [90, 180, 270] as const;
export type RotationAngle = (typeof ROTATION_ANGLES)[number];

export type WatermarkPosition =
  | 'center'
  | 'top'
  | 'bottom'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export const WATERMARK_POSITIONS: readonly WatermarkPosition[] = [
  'center',
  'top',
  'bottom',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
];

export type FooterPosition = 'left' | 'center' | 'right';
export type RasterQuality = 'low' | 'medium' | 'high';
export type BwThreshold = 'light' | 'balanced' | 'strong';
export type ClearLevel = 'low' | 'medium' | 'high';

interface OperationBase {
  id: string;
  type: OperationType;
}

export interface SplitOperation extends OperationBase {
  type: 'split';
  mode?: 'every' | 'groups' | 'extract' | undefined;
  groupSize?: number | undefined;
  indices?: number[] | undefined;
  rangesText?: string | undefined;
}

export interface SelectOperation extends OperationBase {
  type: 'select';
  mode?: 'keep' | 'remove' | undefined;
  indices?: number[] | undefined;
  rangesText?: string | undefined;
}

export interface ReorderOperation extends OperationBase {
  type: 'reorder';
  indices?: number[] | undefined;
  rangesText?: string | undefined;
}

export interface RotateOperation extends OperationBase {
  type: 'rotate';
  angle: RotationAngle;
  scope: 'all' | 'selected';
  indices?: number[] | undefined;
  rangesText?: string | undefined;
}

export interface RasterOperation extends OperationBase {
  type: 'gray' | 'bw' | 'invert' | 'clear';
  quality: RasterQuality;
  threshold?: BwThreshold | undefined;
  clearLevel?: ClearLevel | undefined;
}

export interface NupOperation extends OperationBase {
  type: 'nup';
  settings: NupSettings;
}

export interface WatermarkOperation extends OperationBase {
  type: 'watermark';
  text: string;
  size: number;
  opacity: number;
  rotation: number;
  position: WatermarkPosition;
  scope: 'all' | 'selected';
  indices?: number[] | undefined;
  rangesText?: string | undefined;
}

export interface MetadataOperation extends OperationBase {
  type: 'metadata';
  title: string;
  author: string;
  subject: string;
  keywords: string;
}

export interface TimestampOperation extends OperationBase {
  type: 'timestamp';
  customText: string;
}

export interface FooterOperation extends OperationBase {
  type: 'footer';
  text: string;
  pageNumbers: boolean;
  timestamp: boolean;
  position: FooterPosition;
  size: number;
}

export type WorkspaceOperation =
  | SplitOperation
  | SelectOperation
  | ReorderOperation
  | RotateOperation
  | RasterOperation
  | NupOperation
  | WatermarkOperation
  | MetadataOperation
  | TimestampOperation
  | FooterOperation;

export interface WorkspaceFile {
  id: string;
  fileUniqueId: string;
  path: string;
  name: string;
  sizeBytes: number;
  pages: number;
  uploadedAt: number;
}

export type AwaitingField =
  | 'ranges'
  | 'order'
  | 'group-size'
  | 'number-start'
  | 'watermark-text'
  | 'footer-text'
  | 'timestamp-text'
  | 'metadata-title'
  | 'metadata-author'
  | 'metadata-subject'
  | 'metadata-keywords';

export interface AwaitingText {
  operationId: string;
  field: AwaitingField;
}

export interface Workspace {
  id: string;
  userId: number;
  chatId: number;
  files: WorkspaceFile[];
  mode: WorkspaceMode;
  operations: WorkspaceOperation[];
  status: WorkspaceStatus;
  awaitingUpload: boolean;
  replacingFileId: string | null;
  awaitingText: AwaitingText | null;
  uploading: boolean;
  controller: AbortController;
  createdAt: number;
  updatedAt: number;
  uploadStartedAt: number | null;
  processingStartedAt: number | null;
  processingCompletedAt: number | null;
  lastError: string | null;
  cancelRequested: boolean;
  expiryNotified: boolean;
  nextFileSeq: number;
  nextOpSeq: number;
}

export interface RemainingPagesConfig {
  maxPages: number;
  rasterMaxPages: number;
  mergeMaxFiles: number;
}
