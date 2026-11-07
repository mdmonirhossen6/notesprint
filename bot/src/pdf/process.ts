import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { FileHandlingError } from '../files/errors.js';
import { cleanupFile } from '../files/paths.js';

export interface ProcessPdfOptions {
  maxOutputBytes: number;
  maxPages: number;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
}

export interface ProcessPdfResult {
  inputBytes: number;
  outputBytes: number;
  pages: number;
}

function cancelledError(): FileHandlingError {
  return new FileHandlingError('cancelled', 'PDF processing was cancelled');
}

export async function processPdf(
  inputPath: string,
  outputPath: string,
  options: ProcessPdfOptions,
): Promise<ProcessPdfResult> {
  if (options.signal?.aborted) throw cancelledError();

  const input = await readFile(inputPath);
  if (input.length === 0) {
    throw new FileHandlingError('empty', 'Input PDF is empty');
  }

  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new FileHandlingError('timeout', 'PDF processing timed out'));
    }, options.timeoutMs);
    timer.unref();
  });

  const cancellation = new Promise<never>((_resolve, reject) => {
    const signal = options.signal;
    if (!signal) return;
    if (signal.aborted) {
      reject(cancelledError());
      return;
    }
    signal.addEventListener('abort', () => reject(cancelledError()), { once: true });
  });

  const work = (async (): Promise<ProcessPdfResult> => {
    let document: PDFDocument;
    try {
      document = await PDFDocument.load(input, { updateMetadata: false });
    } catch {
      throw new FileHandlingError('invalid_pdf', 'PDF could not be parsed');
    }

    const pages = document.getPageCount();
    if (pages < 1) {
      throw new FileHandlingError('invalid_pdf', 'PDF has no pages');
    }
    if (pages > options.maxPages) {
      throw new FileHandlingError('too_many_pages', 'PDF exceeds the page limit');
    }

    if (timedOut) throw new FileHandlingError('timeout', 'PDF processing timed out');
    if (options.signal?.aborted) throw cancelledError();

    let bytes: Uint8Array;
    try {
      bytes = await document.save({ useObjectStreams: true });
    } catch {
      throw new FileHandlingError('process_failed', 'PDF could not be saved');
    }

    if (timedOut) throw new FileHandlingError('timeout', 'PDF processing timed out');
    if (options.signal?.aborted) throw cancelledError();
    if (bytes.length > options.maxOutputBytes) {
      throw new FileHandlingError('output_too_large', 'Processed PDF exceeds the output limit');
    }

    await writeFile(outputPath, bytes, { flag: 'wx', mode: 0o600 });

    return { inputBytes: input.length, outputBytes: bytes.length, pages };
  })();

  try {
    return await Promise.race([work, timeout, cancellation]);
  } catch (error) {
    await cleanupFile(outputPath).catch(() => undefined);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
