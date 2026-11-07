import { createReadStream, createWriteStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { Transform } from 'node:stream';
import type { TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { FileHandlingError } from './errors.js';
import { cleanupFile, isPathInside } from './paths.js';

export interface DownloadOptions {
  apiRoot: string;
  botToken: string;
  filePath: string;
  destination: string;
  maxBytes: number;
  timeoutMs: number;
  localFileRoot?: string | undefined;
  signal?: AbortSignal | undefined;
  fetchImpl?: typeof fetch;
}

export interface DownloadResult {
  sizeBytes: number;
  source: 'local' | 'remote';
}

class ByteLimitTransform extends Transform {
  private totalBytes = 0;

  constructor(private readonly maxBytes: number) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.totalBytes += chunk.length;
    if (this.totalBytes > this.maxBytes) {
      callback(new FileHandlingError('too_large', 'File exceeded the maximum allowed size'));
      return;
    }
    callback(null, chunk);
  }
}

function mapError(
  error: unknown,
  timedOut: boolean,
  cancelled: boolean,
): FileHandlingError {
  if (cancelled) {
    return new FileHandlingError('cancelled', 'File transfer was cancelled');
  }
  if (timedOut) {
    return new FileHandlingError('timeout', 'File transfer timed out');
  }
  if (error instanceof FileHandlingError) return error;
  return new FileHandlingError('download_failed', 'Telegram file download failed');
}

function localPathFor(filePath: string): string | null {
  if (filePath.startsWith('file://')) {
    try {
      return fileURLToPath(filePath);
    } catch {
      return null;
    }
  }
  return isAbsolute(filePath) ? filePath : null;
}

async function downloadRemote(options: DownloadOptions): Promise<DownloadResult> {
  const { apiRoot, botToken, filePath, destination, maxBytes, timeoutMs } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${apiRoot.replace(/\/+$/, '')}/file/bot${botToken}/${filePath.replace(/^\/+/, '')}`;

  const controller = new AbortController();
  let timedOut = false;
  let cancelled = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  timer.unref();

  const onAbort = (): void => {
    cancelled = true;
    controller.abort();
  };
  if (options.signal) {
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    let response: Response;
    try {
      response = await fetchImpl(url, { signal: controller.signal });
    } catch (error) {
      throw mapError(error, timedOut, cancelled);
    }

    if (!response.ok || !response.body) {
      controller.abort();
      throw new FileHandlingError(
        'download_failed',
        `Telegram file download failed with HTTP ${response.status}`,
      );
    }

    const contentLength = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      controller.abort();
      throw new FileHandlingError('too_large', 'File exceeded the maximum allowed size');
    }

    try {
      await pipeline(
        Readable.fromWeb(response.body),
        new ByteLimitTransform(maxBytes),
        createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
      );
    } catch (error) {
      await cleanupFile(destination);
      throw mapError(error, timedOut, cancelled);
    }

    const info = await stat(destination);
    if (info.size === 0) {
      await cleanupFile(destination);
      throw new FileHandlingError('empty', 'Downloaded file is empty');
    }

    return { sizeBytes: info.size, source: 'remote' };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

async function copyLocalFile(options: DownloadOptions): Promise<DownloadResult> {
  const { destination, maxBytes, timeoutMs, localFileRoot } = options;

  const localPath = localPathFor(options.filePath);
  if (!localPath) {
    throw new FileHandlingError('local_path', 'Local Bot API returned an invalid file path');
  }

  let sourcePath: string;
  try {
    sourcePath = await realpath(localPath);
  } catch {
    throw new FileHandlingError('local_path', 'Local Bot API file is not accessible');
  }

  if (localFileRoot) {
    let rootPath: string;
    try {
      rootPath = await realpath(localFileRoot);
    } catch {
      throw new FileHandlingError('local_path', 'Local Bot API data directory is not accessible');
    }
    if (!isPathInside(rootPath, sourcePath)) {
      throw new FileHandlingError('local_path', 'Local Bot API file is outside the allowed directory');
    }
  }

  let info;
  try {
    info = await stat(sourcePath);
  } catch {
    throw new FileHandlingError('local_path', 'Local Bot API file is not accessible');
  }

  if (!info.isFile()) {
    throw new FileHandlingError('local_path', 'Local Bot API path is not a file');
  }
  if (info.size === 0) {
    throw new FileHandlingError('empty', 'Local Bot API file is empty');
  }
  if (info.size > maxBytes) {
    throw new FileHandlingError('too_large', 'File exceeded the maximum allowed size');
  }

  let timedOut = false;
  let cancelled = false;
  const sourceStream = createReadStream(sourcePath);
  const timer = setTimeout(() => {
    timedOut = true;
    sourceStream.destroy(new Error('file transfer timed out'));
  }, timeoutMs);
  timer.unref();

  const onAbort = (): void => {
    cancelled = true;
    sourceStream.destroy(new Error('file transfer cancelled'));
  };
  if (options.signal) {
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    await pipeline(
      sourceStream,
      new ByteLimitTransform(maxBytes),
      createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
    );
  } catch (error) {
    await cleanupFile(destination);
    throw mapError(error, timedOut, cancelled);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }

  const resultInfo = await stat(destination);
  return { sizeBytes: resultInfo.size, source: 'local' };
}

export async function downloadTelegramFile(options: DownloadOptions): Promise<DownloadResult> {
  const localPath = localPathFor(options.filePath);
  if (localPath || options.filePath.startsWith('file://')) {
    return copyLocalFile(options);
  }
  return downloadRemote(options);
}
