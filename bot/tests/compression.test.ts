import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppConfig } from '../src/config.js';
import {
  COMPRESSION_URL,
  compressionHelpSection,
  oversizedPdfKeyboard,
  oversizedPdfText,
  recommendedCompressionMb,
} from '../src/bot/compression.js';
import { mainMenuKeyboard, helpKeyboard } from '../src/bot/ui.js';
import { validatePdfMetadata } from '../src/files/metadata.js';

const BOT_TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const MB = 1024 * 1024;
const MAX_UPLOAD_MB = 19;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * MB;

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    logLevel: 'error',
    botToken: BOT_TOKEN,
    botMode: 'polling',
    botApiRoot: 'https://api.telegram.org',
    botApiAllowHttp: false,
    telegramApiId: undefined,
    telegramApiHash: undefined,
    localFileRoot: undefined,
    webhookUrl: undefined,
    webhookSecret: undefined,
    webhookPath: '/telegram',
    port: 8080,
    superAdminId: 5000,
    databasePath: ':memory:',
    tmpDir: './tmp',
    maxUploadMb: MAX_UPLOAD_MB,
    maxOutputMb: 49,
    maxPdfPages: 300,
    mergeMaxFiles: 10,
    mergeMaxTotalMb: 40,
    rasterMaxPages: 30,
    rasterMaxPixelsPerPage: 4000000,
    processTimeoutSeconds: 180,
    processConcurrency: 1,
    downloadConcurrency: 2,
    fileTransferTimeoutSeconds: 600,
    minFreeDiskMb: 512,
    tempFileTtlMinutes: 120,
    uploadRateLimitCount: 10,
    uploadRateLimitWindowMinutes: 60,
    membershipCacheTtlSeconds: 180,
    requiredChannels: [],
    prostutiAppUrl: 'https://prostuti.bd',
    ...overrides,
  };
}

test('main menu compression button opens the PDF24 URL', () => {
  const keyboard = mainMenuKeyboard('en', testConfig(), true, false);
  const compress = keyboard.inline_keyboard
    .flat()
    .find((button) => button.text === 'Compress PDF');

  assert.ok(compress, 'Compress PDF button is missing');
  assert.ok('url' in compress);
  assert.equal(compress.url, COMPRESSION_URL);
  assert.equal(COMPRESSION_URL, 'https://tools.pdf24.org/en/compress-pdf');
});

test('help keyboard includes the same external compression URL', () => {
  const buttons = helpKeyboard('en').inline_keyboard.flat();
  const compress = buttons.find((button) => button.text === 'Compress PDF');

  assert.ok(compress, 'Compress PDF button is missing from help');
  assert.ok('url' in compress);
  assert.equal(compress.url, COMPRESSION_URL);
});

test('oversized guidance matches the required message and warns about PDF24', () => {
  assert.equal(recommendedCompressionMb(19), 18);
  assert.equal(
    oversizedPdfText(19),
    [
      'Your PDF exceeds the 19 MB upload limit.',
      '',
      'Please compress your PDF first and upload it again.',
      '',
      'Recommended: Compress your PDF to 18 MB or less.',
      '',
      'PDF24 is an external service, not operated by NoteSprint. Do not upload sensitive documents unless you accept its privacy policy.',
    ].join('\n'),
  );
});

test('oversized keyboard has the compression URL and retry action', () => {
  const buttons = oversizedPdfKeyboard().inline_keyboard.flat();

  const compress = buttons.find((button) => button.text === 'Compress PDF');
  assert.ok(compress, 'Compress PDF button is missing');
  assert.ok('url' in compress);
  assert.equal(compress.url, COMPRESSION_URL);

  const retry = buttons.find((button) => button.text === 'Check Again / Upload Again');
  assert.ok(retry, 'Retry button is missing');
  assert.ok('callback_data' in retry);
  assert.equal(retry.callback_data, 'upload:retry');
});

test('upload limit accepts exactly 19 MB and rejects anything above', () => {
  const document = (fileSize: number) => ({
    file_id: 'file-id',
    file_name: 'notes.pdf',
    mime_type: 'application/pdf',
    file_size: fileSize,
  });

  assert.deepEqual(validatePdfMetadata(document(18 * MB), MAX_UPLOAD_BYTES), {
    ok: true,
    declaredSize: 18 * MB,
  });
  assert.deepEqual(validatePdfMetadata(document(MAX_UPLOAD_BYTES), MAX_UPLOAD_BYTES), {
    ok: true,
    declaredSize: MAX_UPLOAD_BYTES,
  });
  assert.deepEqual(validatePdfMetadata(document(MAX_UPLOAD_BYTES + 1), MAX_UPLOAD_BYTES), {
    ok: false,
    code: 'too_large',
  });
  assert.deepEqual(validatePdfMetadata(document(20 * MB), MAX_UPLOAD_BYTES), {
    ok: false,
    code: 'too_large',
  });
});

test('non-PDF uploads are rejected even when they claim a small size', () => {
  assert.deepEqual(
    validatePdfMetadata(
      {
        file_id: 'file-id',
        file_name: 'photo.jpg',
        mime_type: 'image/jpeg',
        file_size: 1024,
      },
      MAX_UPLOAD_BYTES,
    ),
    { ok: false, code: 'invalid_type' },
  );
});

test('help explains the compression steps and privacy warning', () => {
  const help = compressionHelpSection().join('\n');

  for (const step of [
    '1. Open Compress PDF.',
    '2. Select your PDF.',
    '3. Choose Recommended compression.',
    '4. Download the compressed PDF.',
    '5. Return to NoteSprint Bot.',
    '6. Upload the compressed file.',
  ]) {
    assert.equal(help.includes(step), true, `missing step: ${step}`);
  }

  assert.match(help, /external service/);
  assert.match(help, /never uploads your file automatically/);
  assert.match(help, /sensitive documents/);
  assert.match(help, /privacy policy/);
});
