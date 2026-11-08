import { PDFArray, PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import type { PDFEmbeddedPage, PDFFont, PDFPage } from 'pdf-lib';
import { FileHandlingError } from '../files/errors.js';
import { yieldToEventLoop } from '../lib/yield.js';
import { PdfDeadline, loadPdfFile, savePdfFile } from './common.js';

export type PaperSize = 'a4' | 'a3' | 'a5' | 'letter' | 'legal';
export type Orientation = 'portrait' | 'landscape' | 'auto';
export type MarginPreset = 'compact' | 'normal' | 'wide';
export type PageNumberPosition = 'bottom-center' | 'bottom-right' | 'top-center';
export type NupPerPage = 2 | 4 | 6 | 9;

export interface NupSettings {
  perPage: NupPerPage;
  paper: PaperSize;
  orientation: Orientation;
  margin: MarginPreset;
  gap: 0 | 8 | 16;
  separators: boolean;
  pageNumbers: boolean;
  numberStart: number;
  numberPosition: PageNumberPosition;
  numberSize: number;
}

export interface NupOptions extends NupSettings {
  maxPages: number;
  maxOutputBytes: number;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
}

export interface NupResult {
  inputPages: number;
  outputPages: number;
  outputBytes: number;
}

export const DEFAULT_NUP_SETTINGS: NupSettings = {
  perPage: 4,
  paper: 'a4',
  orientation: 'auto',
  margin: 'normal',
  gap: 8,
  separators: false,
  pageNumbers: false,
  numberStart: 1,
  numberPosition: 'bottom-center',
  numberSize: 10,
};

export const NUP_PRESETS: Record<NupPerPage, { rows: number; cols: number; label: string }> = {
  2: { rows: 2, cols: 1, label: '2-in-1' },
  4: { rows: 2, cols: 2, label: '4-in-1' },
  6: { rows: 3, cols: 2, label: '6-in-1' },
  9: { rows: 3, cols: 3, label: '9-in-1' },
};

export const PAPER_SIZES: Record<PaperSize, { width: number; height: number; label: string }> = {
  a4: { width: 595.28, height: 841.89, label: 'A4' },
  a3: { width: 841.89, height: 1190.55, label: 'A3' },
  a5: { width: 419.53, height: 595.28, label: 'A5' },
  letter: { width: 612, height: 792, label: 'Letter' },
  legal: { width: 612, height: 1008, label: 'Legal' },
};

const MARGINS: Record<MarginPreset, number> = {
  compact: 12,
  normal: 24,
  wide: 40,
};

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function effectiveSize(page: PDFPage): { width: number; height: number; rotation: number } {
  const size = page.getSize();
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  return rotation === 90 || rotation === 270
    ? { width: size.height, height: size.width, rotation }
    : { width: size.width, height: size.height, rotation };
}

export function resolveSheetSize(
  settings: Pick<NupSettings, 'paper' | 'orientation'>,
  sourcePages: readonly { width: number; height: number }[],
): { width: number; height: number } {
  const paper = PAPER_SIZES[settings.paper];
  let landscape: boolean;

  if (settings.orientation === 'landscape') {
    landscape = true;
  } else if (settings.orientation === 'portrait') {
    landscape = false;
  } else {
    const totals = sourcePages.reduce(
      (sum, page) => ({ width: sum.width + page.width, height: sum.height + page.height }),
      { width: 0, height: 0 },
    );
    landscape = totals.width > totals.height;
  }

  return landscape
    ? { width: paper.height, height: paper.width }
    : { width: paper.width, height: paper.height };
}

function hasPageContents(page: PDFPage): boolean {
  const contents = page.node.Contents();
  if (contents === undefined) return false;
  return contents instanceof PDFArray ? contents.size() > 0 : true;
}

function drawSourcePage(
  target: PDFPage,
  embedded: PDFEmbeddedPage,
  cell: Rect,
  sourceRotation: number,
): void {
  const rotation = ((360 - sourceRotation) % 360) as 0 | 90 | 180 | 270;
  const swapped = rotation === 90 || rotation === 270;
  const visibleWidth = swapped ? embedded.height : embedded.width;
  const visibleHeight = swapped ? embedded.width : embedded.height;
  const padding = 2;
  const scale = Math.min(
    (cell.width - padding * 2) / visibleWidth,
    (cell.height - padding * 2) / visibleHeight,
  );
  const contentWidth = visibleWidth * scale;
  const contentHeight = visibleHeight * scale;
  const originX = cell.x + (cell.width - contentWidth) / 2;
  const originY = cell.y + (cell.height - contentHeight) / 2;

  let x = originX;
  let y = originY;
  if (rotation === 90) {
    x = originX + contentWidth;
  } else if (rotation === 180) {
    x = originX + contentWidth;
    y = originY + contentHeight;
  } else if (rotation === 270) {
    y = originY + contentHeight;
  }

  target.drawPage(embedded, {
    x,
    y,
    width: embedded.width * scale,
    height: embedded.height * scale,
    rotate: degrees(rotation),
  });
}

function drawSeparators(
  page: PDFPage,
  sheet: { width: number; height: number },
  margin: number,
  bottomMargin: number,
  topMargin: number,
  rows: number,
  cols: number,
  cellWidth: number,
  cellHeight: number,
  gap: number,
): void {
  const left = margin;
  const bottom = bottomMargin;
  const right = sheet.width - margin;
  const top = sheet.height - topMargin;
  const color = rgb(0.75, 0.75, 0.75);

  for (let col = 1; col < cols; col += 1) {
    const x = left + col * cellWidth + (col - 1) * gap + gap / 2;
    page.drawLine({
      start: { x, y: bottom },
      end: { x, y: top },
      thickness: 0.7,
      color,
    });
  }

  for (let row = 1; row < rows; row += 1) {
    const y = bottom + row * cellHeight + (row - 1) * gap + gap / 2;
    page.drawLine({
      start: { x: left, y },
      end: { x: right, y },
      thickness: 0.7,
      color,
    });
  }
}

function drawPageNumber(
  page: PDFPage,
  font: PDFFont,
  sheet: { width: number; height: number },
  number: number,
  position: PageNumberPosition,
  size: number,
  margin: number,
  bottomMargin: number,
  topMargin: number,
): void {
  const text = String(number);
  const textWidth = font.widthOfTextAtSize(text, size);
  let x = (sheet.width - textWidth) / 2;
  let y = Math.max(2, (bottomMargin - size) / 2);

  if (position === 'bottom-right') {
    x = sheet.width - margin - textWidth;
  } else if (position === 'top-center') {
    y = sheet.height - topMargin + Math.max(2, (topMargin - size) / 2);
  }

  page.drawText(text, {
    x,
    y,
    size,
    font,
    color: rgb(0, 0, 0),
  });
}

export async function nupPdf(
  inputPath: string,
  outputPath: string,
  options: NupOptions,
): Promise<NupResult> {
  const deadline = new PdfDeadline(options.timeoutMs, options.signal);
  deadline.check();

  const source = await loadPdfFile(inputPath);
  const sourcePageCount = source.getPageCount();
  if (sourcePageCount < 1) {
    throw new FileHandlingError('invalid_pdf', 'PDF has no pages');
  }
  if (sourcePageCount > options.maxPages) {
    throw new FileHandlingError(
      'too_many_pages',
      `This PDF has ${sourcePageCount} pages; the N-up limit is ${options.maxPages}.`,
    );
  }

  const preset = NUP_PRESETS[options.perPage];
  const rows = preset.rows;
  const cols = preset.cols;
  const itemsPerPage = rows * cols;
  const sourcePages = source.getPages();

  const sheet = resolveSheetSize(
    options,
    sourcePages.map((page) => effectiveSize(page)),
  );
  const baseMargin = MARGINS[options.margin];
  const pageNumberSpace = options.pageNumbers ? Math.max(0, options.numberSize + 4) : 0;
  const bottomMargin = baseMargin + (options.numberPosition === 'bottom-center' || options.numberPosition === 'bottom-right' ? pageNumberSpace : 0);
  const topMargin = baseMargin + (options.numberPosition === 'top-center' ? pageNumberSpace : 0);

  const usableWidth = sheet.width - baseMargin * 2 - (cols - 1) * options.gap;
  const usableHeight = sheet.height - topMargin - bottomMargin - (rows - 1) * options.gap;
  const cellWidth = usableWidth / cols;
  const cellHeight = usableHeight / rows;

  if (cellWidth <= 0 || cellHeight <= 0) {
    throw new FileHandlingError('process_failed', 'N-up margins leave no room for pages');
  }

  const target = await PDFDocument.create();
  const font = await target.embedFont(StandardFonts.Helvetica);
  const outputPages = Math.ceil(sourcePageCount / itemsPerPage);

  for (let sheetIndex = 0; sheetIndex < outputPages; sheetIndex += 1) {
    deadline.check();
    const page = target.addPage([sheet.width, sheet.height]);

    for (let item = 0; item < itemsPerPage; item += 1) {
      const sourceIndex = sheetIndex * itemsPerPage + item;
      if (sourceIndex >= sourcePageCount) break;

      const sourcePage = sourcePages[sourceIndex]!;
      const info = effectiveSize(sourcePage);
      const row = Math.floor(item / cols);
      const col = item % cols;

      const cell: Rect = {
        x: baseMargin + col * (cellWidth + options.gap),
        y: sheet.height - topMargin - (row + 1) * cellHeight - row * options.gap,
        width: cellWidth,
        height: cellHeight,
      };

      if (hasPageContents(sourcePage)) {
        const embedded = await target.embedPage(sourcePage);
        drawSourcePage(page, embedded, cell, info.rotation);
      }
    }

    if (options.separators) {
      drawSeparators(
        page,
        sheet,
        baseMargin,
        bottomMargin,
        topMargin,
        rows,
        cols,
        cellWidth,
        cellHeight,
        options.gap,
      );
    }

    if (options.pageNumbers) {
      drawPageNumber(
        page,
        font,
        sheet,
        options.numberStart + sheetIndex,
        options.numberPosition,
        options.numberSize,
        baseMargin,
        bottomMargin,
        topMargin,
      );
    }

    await yieldToEventLoop();
  }

  const outputBytes = await savePdfFile(target, outputPath, {
    maxOutputBytes: options.maxOutputBytes,
    deadline,
  });

  return {
    inputPages: sourcePageCount,
    outputPages,
    outputBytes,
  };
}
