import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { FileHandlingError } from '../files/errors.js';
import { cleanupFile } from '../files/paths.js';
import { yieldToEventLoop } from '../lib/yield.js';

export interface MergePdfsOptions {
  maxOutputBytes: number;
  maxPages: number;
  maxFiles: number;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
}

export interface MergePdfsResult {
  inputBytes: number;
  outputBytes: number;
  pages: number;
  files: number;
}

function cancelledError(): FileHandlingError {
  return new FileHandlingError('cancelled', 'Merge was cancelled');
}

function timedOutError(): FileHandlingError {
  return new FileHandlingError('timeout', 'Merge timed out');
}

async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    throw new FileHandlingError('invalid_pdf', 'PDF could not be parsed');
  }
}

export async function countPdfPages(inputPath: string): Promise<number> {
  const bytes = await readFile(inputPath);
  if (bytes.length === 0) {
    throw new FileHandlingError('empty', 'Input PDF is empty');
  }

  const document = await loadPdf(bytes);
  const pages = document.getPageCount();
  if (pages < 1) {
    throw new FileHandlingError('invalid_pdf', 'PDF has no pages');
  }
  return pages;
}

export async function mergePdfs(
  inputPaths: string[],
  outputPath: string,
  options: MergePdfsOptions,
): Promise<MergePdfsResult> {
  if (options.signal?.aborted) throw cancelledError();
  if (inputPaths.length < 2) {
    throw new FileHandlingError('too_few_files', 'Merge needs at least 2 PDFs');
  }
  if (inputPaths.length > options.maxFiles) {
    throw new FileHandlingError('too_many_files', 'Too many PDFs for one merge');
  }

  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(timedOutError());
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

  const work = (async (): Promise<MergePdfsResult> => {
    const target = await PDFDocument.create();
    let inputBytes = 0;
    let pages = 0;

    for (const inputPath of inputPaths) {
      if (timedOut) throw timedOutError();
      if (options.signal?.aborted) throw cancelledError();

      const bytes = await readFile(inputPath);
      inputBytes += bytes.length;

      const source = await loadPdf(bytes);
      const sourcePages = source.getPageCount();
      if (sourcePages < 1) {
        throw new FileHandlingError('invalid_pdf', 'PDF has no pages');
      }

      pages += sourcePages;
      if (pages > options.maxPages) {
        throw new FileHandlingError('too_many_pages', 'Merged PDF exceeds the page limit');
      }

      const copied = await target.copyPages(source, source.getPageIndices());
      for (const page of copied) target.addPage(page);
      await yieldToEventLoop();
    }

    if (timedOut) throw timedOutError();
    if (options.signal?.aborted) throw cancelledError();

    let bytes: Uint8Array;
    try {
      bytes = await target.save({ useObjectStreams: true });
    } catch {
      throw new FileHandlingError('process_failed', 'Merged PDF could not be saved');
    }

    if (timedOut) throw timedOutError();
    if (options.signal?.aborted) throw cancelledError();
    if (bytes.length > options.maxOutputBytes) {
      throw new FileHandlingError('output_too_large', 'Merged PDF exceeds the output limit');
    }

    await writeFile(outputPath, bytes, { flag: 'wx', mode: 0o600 });

    return {
      inputBytes,
      outputBytes: bytes.length,
      pages,
      files: inputPaths.length,
    };
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
