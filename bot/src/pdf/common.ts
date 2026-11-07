import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { FileHandlingError } from '../files/errors.js';
import { cleanupFile } from '../files/paths.js';

export class PdfDeadline {
  private readonly endAt: number;

  constructor(
    timeoutMs: number,
    private readonly signal?: AbortSignal | undefined,
  ) {
    this.endAt = Date.now() + timeoutMs;
  }

  check(): void {
    if (this.signal?.aborted) {
      throw new FileHandlingError('cancelled', 'Processing was cancelled');
    }
    if (Date.now() > this.endAt) {
      throw new FileHandlingError('timeout', 'Processing timed out');
    }
  }
}

export interface PdfSaveOptions {
  maxOutputBytes: number;
  deadline: PdfDeadline;
}

export async function loadPdfFile(inputPath: string): Promise<PDFDocument> {
  const bytes = await readFile(inputPath);
  if (bytes.length === 0) {
    throw new FileHandlingError('empty', 'Input PDF is empty');
  }

  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    throw new FileHandlingError('invalid_pdf', 'PDF could not be parsed');
  }
}

export async function savePdfFile(
  document: PDFDocument,
  outputPath: string,
  options: PdfSaveOptions,
): Promise<number> {
  options.deadline.check();

  let bytes: Uint8Array;
  try {
    bytes = await document.save({ useObjectStreams: true });
  } catch {
    throw new FileHandlingError('process_failed', 'PDF could not be saved');
  }

  options.deadline.check();
  if (bytes.length > options.maxOutputBytes) {
    throw new FileHandlingError('output_too_large', 'Output PDF exceeds the size limit');
  }

  try {
    await writeFile(outputPath, bytes, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    await cleanupFile(outputPath).catch(() => undefined);
    throw error;
  }

  return bytes.length;
}
