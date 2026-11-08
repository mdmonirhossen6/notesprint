import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';
import { FileHandlingError } from '../files/errors.js';
import { formatDhakaTimestamp } from '../lib/time.js';
import { PdfDeadline, loadPdfFile, savePdfFile } from './common.js';

export type WatermarkPosition =
  | 'center'
  | 'top'
  | 'bottom'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export type FooterPosition = 'left' | 'center' | 'right';

export interface PersonalizeOptions {
  maxOutputBytes: number;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
}

export interface PersonalizeResult {
  pages: number;
  outputBytes: number;
}

export interface WatermarkSettings {
  text: string;
  size: number;
  opacity: number;
  rotation: number;
  position: WatermarkPosition;
  indices: readonly number[] | null;
}

export interface FooterSettings {
  text: string;
  pageNumbers: boolean;
  timestamp: boolean;
  position: FooterPosition;
  size: number;
  timestampText?: string | undefined;
}

export interface MetadataSettings {
  title: string;
  author: string;
  subject: string;
  keywords: string;
}

const WIN_ANSI_EXTRA = new Set<number>([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160,
  0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

export function isPdfTextDrawable(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0x0a || code === 0x0d || code === 0x09) continue;
    if (code >= 0x20 && code <= 0x7e) continue;
    if (code >= 0xa0 && code <= 0xff) continue;
    if (WIN_ANSI_EXTRA.has(code)) continue;
    return false;
  }
  return true;
}

function requireDrawableText(text: string): void {
  if (!isPdfTextDrawable(text)) {
    throw new FileHandlingError(
      'process_failed',
      'Watermark and footer text must use Latin letters, digits, and common punctuation.',
    );
  }
}

function fitSize(font: PDFFont, text: string, desired: number, maxWidth: number, minimum: number): number {
  let size = desired;
  while (size > minimum && font.widthOfTextAtSize(text, size) > maxWidth) {
    size -= 1;
  }
  return size;
}

function truncateToWidth(font: PDFFont, text: string, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let value = text;
  while (value.length > 1 && font.widthOfTextAtSize(`${value}…`, size) > maxWidth) {
    value = value.slice(0, -1);
  }
  return `${value}…`;
}

function watermarkOrigin(
  page: PDFPage,
  textWidth: number,
  size: number,
  position: WatermarkPosition,
): { x: number; y: number } {
  const { width, height } = page.getSize();
  const margin = 36;
  switch (position) {
    case 'top':
      return { x: (width - textWidth) / 2, y: height - size - margin };
    case 'bottom':
      return { x: (width - textWidth) / 2, y: margin };
    case 'top-left':
      return { x: margin, y: height - size - margin };
    case 'top-right':
      return { x: width - textWidth - margin, y: height - size - margin };
    case 'bottom-left':
      return { x: margin, y: margin };
    case 'bottom-right':
      return { x: width - textWidth - margin, y: margin };
    case 'center':
    default:
      return { x: (width - textWidth) / 2, y: (height - size) / 2 };
  }
}

export async function watermarkPdf(
  inputPath: string,
  outputPath: string,
  settings: WatermarkSettings,
  options: PersonalizeOptions,
): Promise<PersonalizeResult> {
  const deadline = new PdfDeadline(options.timeoutMs, options.signal);
  deadline.check();

  const text = settings.text.replace(/[\r\n]+/g, ' ').trim();
  if (!text) {
    throw new FileHandlingError('process_failed', 'Watermark text is empty');
  }
  if (text.length > 100) {
    throw new FileHandlingError('process_failed', 'Watermark text is too long');
  }
  requireDrawableText(text);

  const document = await loadPdfFile(inputPath);
  const font = await document.embedFont(StandardFonts.HelveticaBold);
  const pages = document.getPages();
  const targets = settings.indices ? new Set(settings.indices) : null;
  const color = rgb(0.2, 0.2, 0.2);
  const opacity = Math.min(1, Math.max(0.05, settings.opacity));
  const rotation = ((settings.rotation % 360) + 360) % 360;

  let drawn = 0;
  pages.forEach((page, index) => {
    if (targets && !targets.has(index)) return;
    deadline.check();
    const { width } = page.getSize();
    const size = fitSize(font, text, settings.size, width * 0.92, 6);
    const textWidth = font.widthOfTextAtSize(text, size);
    const origin = watermarkOrigin(page, textWidth, size, settings.position);
    page.drawText(text, {
      x: origin.x,
      y: origin.y,
      size,
      font,
      color,
      opacity,
      rotate: degrees(rotation),
    });
    drawn += 1;
  });

  if (drawn === 0) {
    throw new FileHandlingError('empty_selection', 'No pages were selected for the watermark');
  }

  const outputBytes = await savePdfFile(document, outputPath, {
    maxOutputBytes: options.maxOutputBytes,
    deadline,
  });
  return { pages: pages.length, outputBytes };
}

function footerLine(settings: FooterSettings, pageNumber: number, totalPages: number): string {
  const parts: string[] = [];
  const text = settings.text.trim();
  if (text) parts.push(text);
  if (settings.pageNumbers) parts.push(`${pageNumber} / ${totalPages}`);
  if (settings.timestamp) {
    parts.push(settings.timestampText ?? formatDhakaTimestamp());
  }
  return parts.join('  ·  ');
}

export async function footerPdf(
  inputPath: string,
  outputPath: string,
  settings: FooterSettings,
  options: PersonalizeOptions,
): Promise<PersonalizeResult> {
  const deadline = new PdfDeadline(options.timeoutMs, options.signal);
  deadline.check();

  const line = footerLine(settings, 1, 1);
  if (!line.trim()) {
    throw new FileHandlingError('process_failed', 'Footer content is empty');
  }
  requireDrawableText(line);

  const document = await loadPdfFile(inputPath);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const pages = document.getPages();
  const total = pages.length;
  const baseSize = Math.min(24, Math.max(6, Math.round(settings.size)));
  const band = baseSize + 12;
  const color = rgb(0.25, 0.25, 0.25);

  pages.forEach((page, index) => {
    deadline.check();
    const { width, height } = page.getSize();
    const lineText = footerLine(settings, index + 1, total);
    const maxWidth = Math.max(24, width - 48);
    const size = fitSize(font, lineText, baseSize, maxWidth, 5);
    const text = truncateToWidth(font, lineText, size, maxWidth);
    const textWidth = font.widthOfTextAtSize(text, size);

    page.translateContent(0, band);
    page.setSize(width, height + band);

    let x = 24;
    if (settings.position === 'center') x = (width - textWidth) / 2;
    else if (settings.position === 'right') x = width - textWidth - 24;

    page.drawText(text, {
      x: Math.max(12, x),
      y: (band - size) / 2 + 1,
      size,
      font,
      color,
    });
  });

  const outputBytes = await savePdfFile(document, outputPath, {
    maxOutputBytes: options.maxOutputBytes,
    deadline,
  });
  return { pages: total, outputBytes };
}

export async function timestampFooterPdf(
  inputPath: string,
  outputPath: string,
  customText: string,
  options: PersonalizeOptions,
): Promise<PersonalizeResult> {
  const prefix = customText.trim() || 'Processed by NoteSprint';
  requireDrawableText(prefix);
  return footerPdf(
    inputPath,
    outputPath,
    {
      text: '',
      pageNumbers: false,
      timestamp: true,
      position: 'center',
      size: 9,
      timestampText: `${prefix} | ${formatDhakaTimestamp()}`,
    },
    options,
  );
}

export async function metadataPdf(
  inputPath: string,
  outputPath: string,
  settings: MetadataSettings,
  options: PersonalizeOptions,
): Promise<PersonalizeResult> {
  const deadline = new PdfDeadline(options.timeoutMs, options.signal);
  deadline.check();

  const document = await loadPdfFile(inputPath);
  const title = settings.title.trim();
  const author = settings.author.trim();
  const subject = settings.subject.trim();
  const keywords = settings.keywords
    .split(',')
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0);

  if (!title && !author && !subject && keywords.length === 0) {
    throw new FileHandlingError('process_failed', 'No metadata fields were provided');
  }

  document.setTitle(title);
  document.setAuthor(author);
  document.setSubject(subject);
  document.setKeywords(keywords);

  const pages = document.getPages().length;
  const outputBytes = await savePdfFile(document, outputPath, {
    maxOutputBytes: options.maxOutputBytes,
    deadline,
  });
  return { pages, outputBytes };
}
