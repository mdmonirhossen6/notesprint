import { createWriteStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';
import { FileHandlingError } from '../files/errors.js';
import { cleanupFile, createTempPdfPath, createTempWorkDir } from '../files/paths.js';
import { mergePdfs } from '../pdf/merge.js';
import { nupPdf } from '../pdf/nup.js';
import {
  complementPages,
  extractPdfPages,
  rotatePdfPages,
  splitPdfParts,
} from '../pdf/organize.js';
import {
  footerPdf,
  metadataPdf,
  timestampFooterPdf,
  watermarkPdf,
} from '../pdf/personalize.js';
import { rasterPageLimit, rasterizePdf } from '../pdf/raster.js';
import type { RasterFilter } from '../pdf/raster.js';
import { initialFiles, simulateWorkspace } from './operations.js';
import type { WorkspaceOperation, Workspace } from './types.js';

export interface WorkspaceRunOptions {
  tmpDir: string;
  maxOutputBytes: number;
  maxPages: number;
  mergeMaxFiles: number;
  rasterMaxPages: number;
  rasterMaxPixelsPerPage: number;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
  onStage?: ((event: StageEvent) => void) | undefined;
  onRasterProgress?: ((event: RasterEvent) => void) | undefined;
}

export interface StageEvent {
  step: number;
  total: number;
  operation: WorkspaceOperation;
}

export interface RasterEvent extends StageEvent {
  done: number;
  totalPages: number;
}

export interface PipelineOutput {
  path: string;
  name: string;
  pages: number;
  sizeBytes: number;
}

export interface PipelineRunResult {
  outputs: PipelineOutput[];
  zip: boolean;
  outputPath: string;
  outputName: string;
  outputBytes: number;
  totalPages: number;
  totalInputBytes: number;
  operationCount: number;
  workDir: string;
}

interface SourceFile {
  path: string;
  name: string;
  pages: number;
  owned: boolean;
}

function cancelled(): FileHandlingError {
  return new FileHandlingError('cancelled', 'Pipeline was cancelled');
}

function assertIndices(indices: readonly number[] | undefined, pages: number): number[] {
  if (!indices || indices.length === 0) {
    throw new FileHandlingError('invalid_range', 'Select at least one page for this step');
  }
  const unique = [...new Set(indices)].sort((a, b) => a - b);
  for (const index of unique) {
    if (index < 0 || index >= pages) {
      throw new FileHandlingError(
        'invalid_range',
        `Page ${index + 1} does not exist in a ${pages}-page PDF`,
      );
    }
  }
  return unique;
}

function assertPermutation(indices: readonly number[] | undefined, pages: number): number[] {
  if (!indices || indices.length !== pages) {
    throw new FileHandlingError('invalid_range', 'Send every page exactly once');
  }
  const seen = new Set(indices);
  if (seen.size !== pages) {
    throw new FileHandlingError('invalid_range', 'Send every page exactly once');
  }
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= pages) {
      throw new FileHandlingError('invalid_range', 'That page order is not valid');
    }
  }
  return [...indices];
}

function safePdfName(name: string): string {
  const base = name
    .replace(/\.pdf$/i, '')
    .replace(/[^A-Za-z0-9._\u0980-\u09FF-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 70);
  return `${base || 'document'}.pdf`;
}

function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    if (count === 0) return name;
    return name.replace(/\.pdf$/i, `-${count + 1}.pdf`);
  });
}

async function zipOutputs(
  outputs: PipelineOutput[],
  workDir: string,
  maxBytes: number,
): Promise<{ path: string; bytes: number }> {
  const outputPath = createTempPdfPath(workDir).replace(/\.pdf$/, '.zip');
  try {
    await new Promise<void>((resolve, reject) => {
      const zip = new ZipFile();
      for (const output of outputs) zip.addFile(output.path, output.name);
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

  const info = await stat(outputPath);
  if (info.size > maxBytes) {
    await cleanupFile(outputPath).catch(() => undefined);
    throw new FileHandlingError('output_too_large', 'ZIP output exceeds the size limit');
  }
  return { path: outputPath, bytes: info.size };
}

async function applyOperation(
  operation: WorkspaceOperation,
  input: SourceFile,
  outputPath: string,
  stage: StageEvent,
  options: WorkspaceRunOptions,
): Promise<Array<{ path: string; pages: number }>> {
  if (options.signal?.aborted) throw cancelled();

  const common = {
    maxOutputBytes: options.maxOutputBytes,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  };

  switch (operation.type) {
    case 'split': {
      if (operation.mode === 'extract') {
        const indices = assertIndices(operation.indices, input.pages);
        const result = await extractPdfPages(input.path, outputPath, indices, common);
        return [{ path: outputPath, pages: result.pages }];
      }
      if (operation.mode !== 'every' && operation.mode !== 'groups') {
        throw new FileHandlingError('process_failed', 'Choose a split mode first');
      }
      const parts = await splitPdfParts(
        input.path,
        dirname(outputPath),
        operation.mode,
        operation.groupSize ?? 1,
        common,
      );
      return parts.map((part) => ({ path: part.path, pages: part.pages }));
    }

    case 'select': {
      if (operation.mode !== 'keep' && operation.mode !== 'remove') {
        throw new FileHandlingError('process_failed', 'Choose keep or remove first');
      }
      const indices = assertIndices(operation.indices, input.pages);
      const selected =
        operation.mode === 'keep' ? indices : complementPages(input.pages, indices);
      if (selected.length === 0) {
        throw new FileHandlingError('empty_selection', 'That selection removes every page');
      }
      const result = await extractPdfPages(input.path, outputPath, selected, common);
      return [{ path: outputPath, pages: result.pages }];
    }

    case 'reorder': {
      const indices = assertPermutation(operation.indices, input.pages);
      const result = await extractPdfPages(input.path, outputPath, indices, common);
      return [{ path: outputPath, pages: result.pages }];
    }

    case 'rotate': {
      const indices =
        operation.scope === 'selected' ? assertIndices(operation.indices, input.pages) : null;
      const result = await rotatePdfPages(
        input.path,
        outputPath,
        operation.angle,
        indices,
        common,
      );
      return [{ path: outputPath, pages: result.pages }];
    }

    case 'gray':
    case 'bw':
    case 'invert':
    case 'clear': {
      const filter = operation.type as RasterFilter;
      const limit = rasterPageLimit(filter, operation.quality, options.rasterMaxPages);
      if (input.pages > limit) {
        throw new FileHandlingError(
          'raster_page_limit',
          `This step allows ${limit} pages at ${operation.quality} quality`,
        );
      }
      const result = await rasterizePdf(input.path, outputPath, {
        filter,
        quality: operation.quality,
        threshold: operation.threshold ?? 'balanced',
        clearLevel: operation.clearLevel ?? 'medium',
        maxPages: limit,
        maxPixelsPerPage: options.rasterMaxPixelsPerPage,
        maxOutputBytes: options.maxOutputBytes,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
        onProgress: (done, totalPages) => {
          options.onRasterProgress?.({ ...stage, done, totalPages });
        },
      });
      return [{ path: outputPath, pages: result.pages }];
    }

    case 'nup': {
      const result = await nupPdf(input.path, outputPath, {
        ...operation.settings,
        maxPages: options.maxPages,
        maxOutputBytes: options.maxOutputBytes,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      });
      return [{ path: outputPath, pages: result.outputPages }];
    }

    case 'watermark': {
      const indices =
        operation.scope === 'selected' ? assertIndices(operation.indices, input.pages) : null;
      const result = await watermarkPdf(
        input.path,
        outputPath,
        {
          text: operation.text,
          size: operation.size,
          opacity: operation.opacity,
          rotation: operation.rotation,
          position: operation.position,
          indices,
        },
        common,
      );
      return [{ path: outputPath, pages: result.pages }];
    }

    case 'metadata': {
      const result = await metadataPdf(
        input.path,
        outputPath,
        {
          title: operation.title,
          author: operation.author,
          subject: operation.subject,
          keywords: operation.keywords,
        },
        common,
      );
      return [{ path: outputPath, pages: result.pages }];
    }

    case 'timestamp': {
      const result = await timestampFooterPdf(
        input.path,
        outputPath,
        operation.customText,
        common,
      );
      return [{ path: outputPath, pages: result.pages }];
    }

    case 'footer': {
      const result = await footerPdf(
        input.path,
        outputPath,
        {
          text: operation.text,
          pageNumbers: operation.pageNumbers,
          timestamp: operation.timestamp,
          position: operation.position,
          size: operation.size,
        },
        common,
      );
      return [{ path: outputPath, pages: result.pages }];
    }
  }
}

export async function runWorkspacePipeline(
  workspace: Workspace,
  options: WorkspaceRunOptions,
): Promise<PipelineRunResult> {
  const simulation = simulateWorkspace(workspace, {
    maxPages: options.maxPages,
    rasterMaxPages: options.rasterMaxPages,
    mergeMaxFiles: options.mergeMaxFiles,
  });

  const workDir = await createTempWorkDir(options.tmpDir);
  const initial = initialFiles(workspace);
  let sources: SourceFile[] = [];
  let completed = false;

  try {
    if (workspace.mode === 'combine' && workspace.files.length > 1) {
      const mergedPath = createTempPdfPath(workDir);
      const merged = await mergePdfs(
        workspace.files.map((file) => file.path),
        mergedPath,
        {
          maxOutputBytes: options.maxOutputBytes,
          maxPages: options.maxPages,
          maxFiles: options.mergeMaxFiles,
          timeoutMs: options.timeoutMs,
          signal: options.signal,
        },
      );
      sources = [
        {
          path: mergedPath,
          name: initial[0]?.name ?? 'notesprint-merged',
          pages: merged.pages,
          owned: true,
        },
      ];
    } else if (workspace.mode === 'combine') {
      const file = workspace.files[0];
      if (!file) throw new FileHandlingError('too_few_files', 'Upload a PDF first');
      sources = [
        {
          path: file.path,
          name: initial[0]?.name ?? safePdfName(file.name).replace(/\.pdf$/, ''),
          pages: file.pages,
          owned: false,
        },
      ];
    } else {
      sources = workspace.files.map((file, index) => ({
        path: file.path,
        name: initial[index]?.name ?? safePdfName(file.name).replace(/\.pdf$/, ''),
        pages: file.pages,
        owned: false,
      }));
    }

    for (let index = 0; index < workspace.operations.length; index += 1) {
      if (options.signal?.aborted) throw cancelled();
      const operation = workspace.operations[index]!;
      const stage: StageEvent = {
        step: index + 1,
        total: workspace.operations.length,
        operation,
      };
      options.onStage?.(stage);

      const simulatedAfter = simulation.stages[index]?.after ?? [];
      const next: SourceFile[] = [];
      let cursor = 0;

      for (const source of sources) {
        if (options.signal?.aborted) throw cancelled();
        const outputPath = createTempPdfPath(workDir);
        const parts = await applyOperation(operation, source, outputPath, stage, options);

        for (const part of parts) {
          const simulated = simulatedAfter[cursor];
          cursor += 1;
          next.push({
            path: part.path,
            name: simulated?.name ?? `output-${cursor}`,
            pages: part.pages,
            owned: true,
          });
        }
      }

      if (next.length !== simulatedAfter.length) {
        throw new FileHandlingError(
          'process_failed',
          'Pipeline output did not match its preview. Try again.',
        );
      }

      for (const source of sources) {
        if (!source.owned) continue;
        await cleanupFile(source.path).catch(() => undefined);
      }
      sources = next;
    }

    if (options.signal?.aborted) throw cancelled();

    const names = uniqueNames(sources.map((source) => safePdfName(source.name)));
    const outputs: PipelineOutput[] = [];
    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index]!;
      outputs.push({
        path: source.path,
        name: names[index]!,
        pages: source.pages,
        sizeBytes: (await stat(source.path)).size,
      });
    }

    const totalPages = outputs.reduce((sum, output) => sum + output.pages, 0);

    if (outputs.length === 1) {
      const only = outputs[0]!;
      completed = true;
      return {
        outputs,
        zip: false,
        outputPath: only.path,
        outputName: only.name,
        outputBytes: only.sizeBytes,
        totalPages,
        totalInputBytes: workspace.files.reduce((sum, file) => sum + file.sizeBytes, 0),
        operationCount: workspace.operations.length,
        workDir,
      };
    }

    const zipped = await zipOutputs(outputs, workDir, options.maxOutputBytes);
    completed = true;
    return {
      outputs,
      zip: true,
      outputPath: zipped.path,
      outputName: 'notesprint-workspace.zip',
      outputBytes: zipped.bytes,
      totalPages,
      totalInputBytes: workspace.files.reduce((sum, file) => sum + file.sizeBytes, 0),
      operationCount: workspace.operations.length,
      workDir,
    };
  } finally {
    if (!completed) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export async function cleanupWorkspaceRun(result: PipelineRunResult): Promise<void> {
  await rm(result.workDir, { recursive: true, force: true }).catch(() => undefined);
}
