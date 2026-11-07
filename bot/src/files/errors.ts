export type FileErrorCode =
  | 'too_large'
  | 'output_too_large'
  | 'empty'
  | 'invalid_type'
  | 'invalid_pdf'
  | 'disk_space'
  | 'timeout'
  | 'local_path'
  | 'download_failed'
  | 'process_failed'
  | 'too_many_pages'
  | 'too_few_files'
  | 'too_many_files'
  | 'total_too_large'
  | 'cancelled';

export class FileHandlingError extends Error {
  constructor(
    readonly code: FileErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FileHandlingError';
  }
}

export function userMessageForFileError(error: unknown, maxUploadMb?: number): string {
  if (!(error instanceof FileHandlingError)) {
    return 'Something went wrong while receiving the file. Please try again.';
  }

  switch (error.code) {
    case 'too_large':
      return maxUploadMb
        ? `That PDF is larger than the ${maxUploadMb} MB limit.`
        : 'That file is larger than the allowed limit.';
    case 'output_too_large':
      return 'The processed PDF is larger than the 49 MB output limit.';
    case 'empty':
      return 'That file is empty.';
    case 'invalid_type':
      return 'Please send the PDF as a document.';
    case 'invalid_pdf':
      return 'That file does not look like a valid PDF.';
    case 'disk_space':
      return 'The server is low on storage right now. Please try again later.';
    case 'timeout':
      return 'The operation timed out. Please try again.';
    case 'local_path':
      return 'The server could not read the local Bot API file. Please contact an administrator.';
    case 'download_failed':
      return 'Telegram could not provide that file. Please try again.';
    case 'process_failed':
      return 'This PDF could not be processed. It may be damaged or password-protected.';
    case 'too_many_pages':
      return 'This PDF has too many pages for the current processing limit.';
    case 'too_few_files':
      return 'Add at least 2 PDFs to merge.';
    case 'too_many_files':
      return 'Too many PDFs for one merge. Remove some and try again.';
    case 'total_too_large':
      return 'The combined PDFs are larger than the merge limit.';
    case 'cancelled':
      return 'Processing was cancelled.';
  }
}
