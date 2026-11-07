import { checkDiskSpace } from './disk.js';
import type { StatfsLike } from './disk.js';
import { downloadTelegramFile } from './download.js';
import { FileHandlingError } from './errors.js';
import { ensureDirectory, cleanupFile, createTempPdfPath } from './paths.js';
import { hasPdfHeader } from './pdf.js';

export interface TelegramFileInfo {
  file_path?: string | undefined;
  file_size?: number | undefined;
}

export type GetFile = (fileId: string) => Promise<TelegramFileInfo>;

export interface IntakeOptions {
  fileId: string;
  getFile: GetFile;
  maxBytes: number;
  tmpDir: string;
  apiRoot: string;
  botToken: string;
  timeoutMs: number;
  declaredBytes?: number | null;
  reserveBytes?: number;
  localFileRoot?: string | undefined;
  signal?: AbortSignal | undefined;
  fetchImpl?: typeof fetch;
  statfsFn?: StatfsLike;
}

export interface IntakeResult {
  filePath: string;
  sizeBytes: number;
  source: 'local' | 'remote';
}

export async function intakePdf(options: IntakeOptions): Promise<IntakeResult> {
  const { fileId, getFile, maxBytes, tmpDir, timeoutMs } = options;
  const reserveBytes = options.reserveBytes ?? 0;

  if (options.signal?.aborted) {
    throw new FileHandlingError('cancelled', 'Upload was cancelled');
  }

  await ensureDirectory(tmpDir);

  const declaredBytes =
    options.declaredBytes && options.declaredBytes > 0
      ? Math.min(options.declaredBytes, maxBytes)
      : maxBytes;

  const disk = await checkDiskSpace(tmpDir, declaredBytes, reserveBytes, options.statfsFn);
  if (!disk.ok) {
    throw new FileHandlingError('disk_space', 'Not enough free disk space for this upload');
  }

  let file: TelegramFileInfo;
  try {
    file = await getFile(fileId);
  } catch {
    throw new FileHandlingError('download_failed', 'Telegram did not return file metadata');
  }

  if (typeof file.file_size === 'number' && file.file_size > maxBytes) {
    throw new FileHandlingError('too_large', 'File exceeded the maximum allowed size');
  }

  if (!file.file_path || file.file_path.trim() === '') {
    throw new FileHandlingError('download_failed', 'Telegram did not return a file path');
  }

  const destination = createTempPdfPath(tmpDir);

  try {
    const result = await downloadTelegramFile({
      apiRoot: options.apiRoot,
      botToken: options.botToken,
      filePath: file.file_path,
      destination,
      maxBytes,
      timeoutMs,
      localFileRoot: options.localFileRoot,
      signal: options.signal,
      fetchImpl: options.fetchImpl,
    });

    if (result.sizeBytes > maxBytes) {
      throw new FileHandlingError('too_large', 'File exceeded the maximum allowed size');
    }

    if (!(await hasPdfHeader(destination))) {
      throw new FileHandlingError('invalid_pdf', 'Downloaded file is not a PDF');
    }

    return {
      filePath: destination,
      sizeBytes: result.sizeBytes,
      source: result.source,
    };
  } catch (error) {
    await cleanupFile(destination).catch(() => undefined);
    throw error;
  }
}
