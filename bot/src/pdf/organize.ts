import { stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { PDFDocument, degrees } from 'pdf-lib';
import { ZipFile } from 'yazl';
import { FileHandlingError } from '../files/errors.js';
import { cleanupFile, createTempPdfPath } from '../files/paths.js';
import { PdfDeadline, loadPdfFile, savePdfFile } from './common.js';

export type PageParseMode = 'subset' | 'permutation';
export type RotationAngle = 90 | 180 | 270;

export interface OrganizeOptions {
  maxOutputBytes: number;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
}

export interface OrganizeResult {
  pages: number;
  outputBytes: number;
}

function invalidRange(message: string): FileHandlingError {
  return new FileHandlingError('invalid_range', message);
}

export function parsePageRanges(
  raw: string,
  pageCount: number,
  mode: PageParseMode = 'subset',
): number[] {
  const input = raw.trim();
  if (!input) {
    throw invalidRange('Send a page range such as 1-5, 8, 10-15.');
  }
  if (input.length > 4000) {
    throw invalidRange('That page selection is too long.');
  }

  const normalized = input.replace(/\s*-\s*/g, '-');
  const tokens = normalized.split(/[,\s;]+/).filter(Boolean);
  if (tokens.length === 0) {
    throw invalidRange('Send a page range such as 1-5, 8, 10-15.');
  }

  const indices: number[] = [];
  const seen = new Set<number>();

  for (const token of tokens) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(token);
    if (!match) {
      throw invalidRange(`"${token}" is not a page or range. Use 1-5, 8, 10-15.`);
    }

    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);

    if (start < 1 || end < 1 || start > pageCount || end > pageCount) {
      throw invalidRange(`Page numbers must be between 1 and ${pageCount}.`);
    }
    if (start > end) {
      throw invalidRange(`Range ${start}-${end} is reversed. Use ${end}-${start}.`);
    }

    for (let page = start; page <= end; page += 1) {
      const index = page - 1;
      if (mode === 'permutation' && seen.has(index)) {
        throw invalidRange(`Page ${page} appears more than once.`);
      }
      if (!seen.has(index)) {
        seen.add(index);
        indices.push(index);
      }
    }
  }

  if (mode === 'permutation') {
    if (indices.length !== pageCount) {
      const missing: number[] = [];
      for (let page = 1; page <= pageCount; page += 1) {
        if (!seen.has(page - 1)) missing.push(page);
      }
      throw invalidRange(
        `Send every page exactly once. Missing: ${formatPageList(missing.slice(0, 20))}${missing.length > 20 ? '...' : ''}.`,
      );
    }
  }

  if (indices.length === 0) {
    throw new FileHandlingError('empty_selection', 'Select at least one page.');
  }

  return indices;
}

export function parseGroupSize(raw: string, pageCount: number): number {
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value < 1 || value > pageCount) {
    throw invalidRange(`Group size must be a whole number from 1 to ${pageCount}.`);
  }
  return value;
}

export function formatPageList(indices: number[], limit = 40): string {
  if (indices.length === 0) return 'none';
  const shown = indices.slice(0, limit).map((index) => index + 1);
  return `${shown.join(', ')}${indices.length > limit ? `, +${indices.length - limit} more` : ''}`;
}

export function complementPages(pageCount: number, remove: readonly number[]): number[] {
  const removed = new Set(remove);
  const result: number[] = [];
  for (let index = 0; index < pageCount; index += 1) {
    if (!removed.has(index)) result.push(index);
  }
  return result;
}

function buildDocument(source: PDFDocument, indices: readonly number[]): Promise<PDFDocument> {
  return (async () => {
    const target = await PDFDocument.create();
    const copied = await target.copyPages(source, [...indices]);
    for (const page of copied) target.addPage(page);
    return target;
  })();
}

export async function extractPdfPages(
  inputPath: string,
  outputPath: string,
  indices: readonly number[],
  options: OrganizeOptions,
): Promise<OrganizeResult> {
  const deadline = new PdfDeadline(options.timeoutMs, options.signal);
  deadline.check();
  if (indices.length === 0) {
    throw new FileHandlingError('empty_selection', 'Select at least one page.');
  }

  const source = await loadPdfFile(inputPath);
  const target = await buildDocument(source, indices);
  const outputBytes = await savePdfFile(target, outputPath, {
    maxOutputBytes: options.maxOutputBytes,
    deadline,
  });

  return { pages: indices.length, outputBytes };
}

export async function rotatePdfPages(
  inputPath: string,
  outputPath: string,
  angle: RotationAngle,
  indices: readonly number[] | null,
  options: OrganizeOptions,
): Promise<OrganizeResult> {
  const deadline = new PdfDeadline(options.timeoutMs, options.signal);
  deadline.check();

  const document = await loadPdfFile(inputPath);
  const pages = document.getPages();
  const targets = indices ? new Set(indices) : null;

  let rotated = 0;
  pages.forEach((page, index) => {
    if (targets && !targets.has(index)) return;
    const current = page.getRotation().angle;
    page.setRotation(degrees((current + angle) % 360));
    rotated += 1;
  });

  if (rotated === 0) {
    throw new FileHandlingError('empty_selection', 'No pages were selected to rotate.');
  }

  const outputBytes = await savePdfFile(document, outputPath, {
    maxOutputBytes: options.maxOutputBytes,
    deadline,
  });

  return { pages: pages.length, outputBytes };
}

export interface SplitFile {
  path: string;
  name: string;
  pages: number;
}

export interface SplitResult {
  outputPath: string;
  outputName: string;
  zipped: boolean;
  files: SplitFile[];
  pages: number;
  outputBytes: number;
}

async function zipFiles(
  files: SplitFile[],
  outputPath: string,
  maxOutputBytes: number,
  deadline: PdfDeadline,
): Promise<number> {
  deadline.check();

  try {
    await new Promise<void>((resolve, reject) => {
      const zip = new ZipFile();
      for (const file of files) zip.addFile(file.path, file.name);
      zip.outputStream.on('error', reject);
      zip.end();
      pipeline(zip.outputStream, createWriteStream(outputPath, { mode: 0o600 }))
        .then(() => resolve())
        .catch(reject);
    });
  } catch (error) {
    await cleanupFile(outputPath).catch(() => undefined);
    throw error;
  }

  deadline.check();
  const info = await stat(outputPath);
  if (info.size > maxOutputBytes) {
    await cleanupFile(outputPath).catch(() => undefined);
    throw new FileHandlingError('output_too_large', 'ZIP output exceeds the size limit');
  }

  return info.size;
}

export async function splitPdfParts(
  inputPath: string,
  workDir: string,
  mode: 'every' | 'groups',
  groupSize: number,
  options: OrganizeOptions,
): Promise<SplitFile[]> {
  const deadline = new PdfDeadline(options.timeoutMs, options.signal);
  deadline.check();

  const source = await loadPdfFile(inputPath);
  const pageCount = source.getPageCount();
  const size = mode === 'every' ? 1 : groupSize;

  if (size < 1 || size > pageCount) {
    throw invalidRange(`Group size must be a whole number from 1 to ${pageCount}.`);
  }

  const groups: number[][] = [];
  for (let start = 0; start < pageCount; start += size) {
    const group: number[] = [];
    for (let index = start; index < Math.min(start + size, pageCount); index += 1) {
      group.push(index);
    }
    groups.push(group);
  }

  const files: SplitFile[] = [];
  for (let index = 0; index < groups.length; index += 1) {
    deadline.check();
    const group = groups[index];
    if (!group) continue;

    const rangeLabel =
      group.length === 1
        ? `page-${group[0]! + 1}`
        : `pages-${group[0]! + 1}-${group[group.length - 1]! + 1}`;
    const name = `notesprint-${rangeLabel}.pdf`;
    const path = createTempPdfPath(workDir);
    const target = await buildDocument(source, group);
    await savePdfFile(target, path, {
      maxOutputBytes: options.maxOutputBytes,
      deadline,
    });
    files.push({ path, name, pages: group.length });
  }

  return files;
}

export async function splitPdf(
  inputPath: string,
  workDir: string,
  outputPath: string,
  mode: 'every' | 'groups',
  groupSize: number,
  options: OrganizeOptions,
): Promise<SplitResult> {
  const deadline = new PdfDeadline(options.timeoutMs, options.signal);
  deadline.check();

  const source = await loadPdfFile(inputPath);
  const pageCount = source.getPageCount();
  const size = mode === 'every' ? 1 : groupSize;

  if (size < 1 || size > pageCount) {
    throw invalidRange(`Group size must be a whole number from 1 to ${pageCount}.`);
  }

  const groups: number[][] = [];
  for (let start = 0; start < pageCount; start += size) {
    const group: number[] = [];
    for (let index = start; index < Math.min(start + size, pageCount); index += 1) {
      group.push(index);
    }
    groups.push(group);
  }

  const files: SplitFile[] = [];

  for (let index = 0; index < groups.length; index += 1) {
    deadline.check();
    const group = groups[index];
    if (!group) continue;

    const rangeLabel =
      group.length === 1
        ? `page-${group[0]! + 1}`
        : `pages-${group[0]! + 1}-${group[group.length - 1]! + 1}`;
    const name =
      mode === 'every'
        ? `notesprint-${rangeLabel}.pdf`
        : `notesprint-group-${index + 1}-${rangeLabel}.pdf`;
    const path = groups.length === 1 ? outputPath : join(workDir, name);

    const target = await buildDocument(source, group);
    await savePdfFile(target, path, {
      maxOutputBytes: options.maxOutputBytes,
      deadline,
    });
    files.push({ path, name, pages: group.length });
  }

  if (files.length === 1) {
    const only = files[0]!;
    return {
      outputPath: only.path,
      outputName: only.name,
      zipped: false,
      files,
      pages: pageCount,
      outputBytes: (await stat(only.path)).size,
    };
  }

  const outputBytes = await zipFiles(files, outputPath, options.maxOutputBytes, deadline);

  return {
    outputPath,
    outputName: 'notesprint-split.zip',
    zipped: true,
    files,
    pages: pageCount,
    outputBytes,
  };
}
