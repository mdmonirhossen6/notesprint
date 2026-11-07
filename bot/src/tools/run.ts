import { FileHandlingError } from '../files/errors.js';
import { cleanupDirectory, createTempWorkDir } from '../files/paths.js';
import type { ToolSession } from '../files/tool-session.js';
import { complementPages, extractPdfPages, rotatePdfPages, splitPdf } from '../pdf/organize.js';
import { DEFAULT_NUP_SETTINGS, nupPdf } from '../pdf/nup.js';
import { rasterizePdf, rasterPageLimit } from '../pdf/raster.js';
import type { RasterFilter } from '../pdf/raster.js';

export interface RunToolOptions {
  tmpDir: string;
  outputPath: string;
  maxOutputBytes: number;
  maxPages: number;
  rasterMaxPages: number;
  rasterMaxPixelsPerPage: number;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
  onRasterProgress?: ((done: number, total: number) => void) | undefined;
}

export interface RunToolResult {
  outputPath: string;
  outputName: string;
  pages: number;
  outputBytes: number;
  zip: boolean;
  fileCount: number;
  detail: string;
}

const RASTER_FILTERS: Record<string, RasterFilter> = {
  gray: 'gray',
  bw: 'bw',
  invert: 'invert',
  clear: 'clear',
};

function requireIndices(session: ToolSession): number[] {
  if (!session.settings.indices || session.settings.indices.length === 0) {
    throw new FileHandlingError('empty_selection', 'Choose or type the pages first.');
  }
  return session.settings.indices;
}

export async function runTool(
  session: ToolSession,
  options: RunToolOptions,
): Promise<RunToolResult> {
  const common = {
    maxOutputBytes: options.maxOutputBytes,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  };

  switch (session.tool) {
    case 'split': {
      const mode = session.settings.mode;
      if (mode === 'extract') {
        const indices = requireIndices(session);
        const result = await extractPdfPages(session.filePath, options.outputPath, indices, common);
        return {
          outputPath: options.outputPath,
          outputName: 'notesprint-split.pdf',
          pages: result.pages,
          outputBytes: result.outputBytes,
          zip: false,
          fileCount: 1,
          detail: `${result.pages} extracted pages`,
        };
      }

      if (mode !== 'every' && mode !== 'groups') {
        throw new FileHandlingError('process_failed', 'Choose a split mode first.');
      }

      const workDir = await createTempWorkDir(options.tmpDir);
      try {
        const result = await splitPdf(
          session.filePath,
          workDir,
          options.outputPath,
          mode,
          session.settings.groupSize ?? 1,
          common,
        );

        return {
          outputPath: result.outputPath,
          outputName: result.outputName,
          pages: result.pages,
          outputBytes: result.outputBytes,
          zip: result.zipped,
          fileCount: result.files.length,
          detail:
            mode === 'every'
              ? `${result.files.length} single-page PDFs`
              : `${result.files.length} groups`,
        };
      } finally {
        await cleanupDirectory(workDir).catch(() => undefined);
      }
    }

    case 'select': {
      const indices = requireIndices(session);
      const mode = session.settings.mode;
      if (mode !== 'keep' && mode !== 'remove') {
        throw new FileHandlingError('process_failed', 'Choose keep or remove first.');
      }

      const selected =
        mode === 'keep'
          ? [...indices].sort((a, b) => a - b)
          : complementPages(session.pages, indices);
      if (selected.length === 0) {
        throw new FileHandlingError(
          'empty_selection',
          'That selection would remove every page. Keep at least one page.',
        );
      }

      const result = await extractPdfPages(session.filePath, options.outputPath, selected, common);
      return {
        outputPath: options.outputPath,
        outputName: 'notesprint-selection.pdf',
        pages: result.pages,
        outputBytes: result.outputBytes,
        zip: false,
        fileCount: 1,
        detail:
          mode === 'keep'
            ? `${result.pages} of ${session.pages} pages kept`
            : `${result.pages} of ${session.pages} pages kept after removal`,
      };
    }

    case 'reorder': {
      const indices = requireIndices(session);
      const result = await extractPdfPages(session.filePath, options.outputPath, indices, common);
      return {
        outputPath: options.outputPath,
        outputName: 'notesprint-reordered.pdf',
        pages: result.pages,
        outputBytes: result.outputBytes,
        zip: false,
        fileCount: 1,
        detail: `${result.pages} pages in the requested order`,
      };
    }

    case 'rotate': {
      const angle = session.settings.angle;
      if (angle !== 90 && angle !== 180 && angle !== 270) {
        throw new FileHandlingError('process_failed', 'Choose a rotation angle first.');
      }
      if (session.settings.scope !== 'all' && session.settings.scope !== 'selected') {
        throw new FileHandlingError('process_failed', 'Choose which pages to rotate first.');
      }
      const indices = session.settings.scope === 'selected' ? requireIndices(session) : null;
      const result = await rotatePdfPages(
        session.filePath,
        options.outputPath,
        angle,
        indices,
        common,
      );
      return {
        outputPath: options.outputPath,
        outputName: 'notesprint-rotated.pdf',
        pages: result.pages,
        outputBytes: result.outputBytes,
        zip: false,
        fileCount: 1,
        detail: `${angle}° on ${indices ? indices.length : result.pages} pages`,
      };
    }

    case 'gray':
    case 'bw':
    case 'invert':
    case 'clear': {
      const filter = RASTER_FILTERS[session.tool]!;
      const quality = session.settings.quality ?? 'medium';
      const result = await rasterizePdf(session.filePath, options.outputPath, {
        filter,
        quality,
        threshold: session.settings.threshold ?? 'balanced',
        clearLevel: session.settings.clearLevel ?? 'medium',
        maxPages: rasterPageLimit(filter, quality, options.rasterMaxPages),
        maxPixelsPerPage: options.rasterMaxPixelsPerPage,
        maxOutputBytes: options.maxOutputBytes,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
        onProgress: options.onRasterProgress,
      });

      const name =
        session.tool === 'gray'
          ? 'notesprint-grayscale.pdf'
          : session.tool === 'bw'
            ? 'notesprint-black-white.pdf'
            : session.tool === 'invert'
              ? 'notesprint-inverted.pdf'
              : 'notesprint-cleared.pdf';

      return {
        outputPath: options.outputPath,
        outputName: name,
        pages: result.pages,
        outputBytes: result.outputBytes,
        zip: false,
        fileCount: 1,
        detail: `${result.pages} pages at ${result.dpi} DPI`,
      };
    }

    case 'nup': {
      const settings = session.settings.nup ?? DEFAULT_NUP_SETTINGS;
      const result = await nupPdf(session.filePath, options.outputPath, {
        ...settings,
        maxPages: options.maxPages,
        maxOutputBytes: options.maxOutputBytes,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      });
      return {
        outputPath: options.outputPath,
        outputName: 'notesprint-nup.pdf',
        pages: result.inputPages,
        outputBytes: result.outputBytes,
        zip: false,
        fileCount: 1,
        detail: `${result.inputPages} pages on ${result.outputPages} sheets`,
      };
    }
  }
}
