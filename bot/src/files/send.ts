import { stat } from 'node:fs/promises';
import { InputFile } from 'grammy';
import type { Api } from 'grammy';
import { FileHandlingError } from './errors.js';

export interface SendDocumentOptions {
  api: Api;
  chatId: number | string;
  filePath: string;
  maxBytes: number;
  fileName?: string | undefined;
  caption?: string | undefined;
}

export interface SendDocumentResult {
  sizeBytes: number;
}

export async function sendDocumentFromPath(
  options: SendDocumentOptions,
): Promise<SendDocumentResult> {
  const info = await stat(options.filePath);

  if (!info.isFile()) {
    throw new FileHandlingError('local_path', 'Output path is not a file');
  }
  if (info.size === 0) {
    throw new FileHandlingError('empty', 'Output file is empty');
  }
  if (info.size > options.maxBytes) {
    throw new FileHandlingError('too_large', 'Output file exceeds the maximum allowed size');
  }

  const other: { caption?: string } = {};
  if (options.caption) other.caption = options.caption;

  await options.api.sendDocument(
    options.chatId,
    new InputFile(options.filePath, options.fileName),
    other,
  );

  return { sizeBytes: info.size };
}
