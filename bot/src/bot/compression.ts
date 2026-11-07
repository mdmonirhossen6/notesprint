import { InlineKeyboard } from 'grammy';

export const COMPRESSION_URL = 'https://tools.pdf24.org/en/compress-pdf';

export function recommendedCompressionMb(maxUploadMb: number): number {
  return Math.max(1, maxUploadMb - 1);
}

export function oversizedPdfText(maxUploadMb: number): string {
  return [
    `Your PDF exceeds the ${maxUploadMb} MB upload limit.`,
    '',
    'Please compress your PDF first and upload it again.',
    '',
    `Recommended: Compress your PDF to ${recommendedCompressionMb(maxUploadMb)} MB or less.`,
    '',
    'PDF24 is an external service, not operated by NoteSprint. Do not upload sensitive documents unless you accept its privacy policy.',
  ].join('\n');
}

export function oversizedPdfKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .url('Compress PDF', COMPRESSION_URL)
    .row()
    .text('Check Again / Upload Again', 'upload:retry');
}

export function compressionHelpSection(): string[] {
  return [
    'Compress a PDF for NoteSprint',
    '',
    '1. Open Compress PDF.',
    '2. Select your PDF.',
    '3. Choose Recommended compression.',
    '4. Download the compressed PDF.',
    '5. Return to NoteSprint Bot.',
    '6. Upload the compressed file.',
    '',
    'PDF24 is an external service, not operated by NoteSprint and not covered by our privacy policy.',
    'NoteSprint never uploads your file automatically — you choose the file inside PDF24.',
    'Do not upload sensitive documents to an external service unless you accept its privacy policy.',
  ];
}
