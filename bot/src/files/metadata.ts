import type { FileErrorCode } from './errors.js';

export interface TelegramDocumentLike {
  file_id: string;
  file_name?: string | undefined;
  mime_type?: string | undefined;
  file_size?: number | undefined;
}

export type DocumentValidation =
  | { ok: true; declaredSize: number | null }
  | { ok: false; code: FileErrorCode };

export function validatePdfMetadata(
  document: TelegramDocumentLike,
  maxBytes: number,
): DocumentValidation {
  const mime = document.mime_type?.trim().toLowerCase() ?? '';
  const fileName = document.file_name?.trim().toLowerCase() ?? '';
  const pdfMime = mime === 'application/pdf' || mime === 'application/x-pdf';
  const genericMime = mime === '' || mime === 'application/octet-stream';
  const pdfName = fileName.endsWith('.pdf');

  if (!pdfMime && !(pdfName && genericMime)) {
    return { ok: false, code: 'invalid_type' };
  }

  const size = document.file_size;
  if (size !== undefined) {
    if (!Number.isSafeInteger(size) || size < 0) {
      return { ok: false, code: 'invalid_type' };
    }
    if (size === 0) return { ok: false, code: 'empty' };
    if (size > maxBytes) return { ok: false, code: 'too_large' };
  }

  return { ok: true, declaredSize: size ?? null };
}
