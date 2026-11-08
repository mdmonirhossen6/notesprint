import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import type { AppConfig } from '../src/config.js';
import { isSuperAdmin } from '../src/auth/access.js';
import { createStaticMembershipService } from '../src/channels/static-membership.js';
import type { RequiredChannel } from '../src/channels/types.js';
import { createJobRunner } from '../src/jobs/runner.js';
import { processPdf } from '../src/pdf/process.js';
import { validatePdfMetadata } from '../src/files/metadata.js';
import { mainMenuKeyboard, helpText } from '../src/bot/ui.js';

const CHANNEL: RequiredChannel = {
  id: 1,
  chatRef: '@prostutibd',
  chatId: null,
  title: '@prostutibd',
  joinUrl: 'https://t.me/prostutibd',
  isEnabled: true,
  createdAt: 0,
};

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    logLevel: 'error',
    botToken: '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    botMode: 'webhook',
    botApiRoot: 'https://api.telegram.org',
    botApiAllowHttp: false,
    telegramApiId: undefined,
    telegramApiHash: undefined,
    localFileRoot: undefined,
    webhookUrl: 'https://notesprint.onrender.com/telegram',
    webhookSecret: 'abcdefghijklmnop',
    webhookPath: '/telegram',
    port: 8080,
    superAdminId: 5000,
    databasePath: ':memory:',
    tmpDir: join(tmpdir(), 'notesprint-test'),
    maxUploadMb: 19,
    maxOutputMb: 49,
    maxPdfPages: 300,
    mergeMaxFiles: 10,
    mergeMaxTotalMb: 40,
    rasterMaxPages: 30,
    rasterMaxPixelsPerPage: 4000000,
    processTimeoutSeconds: 180,
    processConcurrency: 1,
    downloadConcurrency: 2,
    fileTransferTimeoutSeconds: 120,
    minFreeDiskMb: 64,
    tempFileTtlMinutes: 60,
    uploadRateLimitCount: 10,
    uploadRateLimitWindowMinutes: 60,
    membershipCacheTtlSeconds: 180,
    requiredChannels: [CHANNEL],
    prostutiAppUrl: 'https://prostuti.bd',
    ...overrides,
  };
}

test('super admin access is derived from the environment ID only', () => {
  assert.equal(isSuperAdmin(5000, 5000), true);
  assert.equal(isSuperAdmin(5001, 5000), false);
});

test('static membership allows admins and reports missing channels', async () => {
  let calls = 0;
  const membership = createStaticMembershipService({
    channels: [CHANNEL],
    ttlSeconds: 180,
    isAdmin: (userId) => userId === 5000,
    client: {
      getChatMember: async () => {
        calls += 1;
        return { status: 'member' };
      },
    },
  });

  const admin = await membership.check(5000);
  assert.equal(admin.adminBypass, true);
  assert.equal(admin.allJoined, true);
  assert.equal(calls, 0);

  const member = await membership.check(42);
  assert.equal(member.allJoined, true);
  assert.equal(member.channels[0]?.isMember, true);

  await membership.check(42);
  assert.equal(calls, 1, 'second check should use the in-memory cache');

  const missing = createStaticMembershipService({
    channels: [CHANNEL],
    ttlSeconds: 180,
    isAdmin: () => false,
    client: { getChatMember: async () => ({ status: 'left' }) },
  });
  const summary = await missing.check(42);
  assert.equal(summary.allJoined, false);
  assert.equal(summary.missing.length, 1);
});

test('static membership surfaces unavailable channels instead of granting access', async () => {
  const membership = createStaticMembershipService({
    channels: [CHANNEL],
    ttlSeconds: 180,
    isAdmin: () => false,
    client: {
      getChatMember: async () => {
        throw new Error('Telegram unavailable');
      },
    },
  });

  const summary = await membership.check(42);
  assert.equal(summary.allJoined, false);
  assert.equal(summary.hasUnavailable, true);
  assert.equal(summary.missing[0]?.unavailable, true);
});

test('job runner prevents duplicate jobs and supports cancellation', () => {
  const runner = createJobRunner();
  const controller = runner.tryStart(42);
  assert.ok(controller);
  assert.equal(runner.tryStart(42), null);
  assert.equal(runner.isActive(42), true);
  assert.equal(runner.activeCount(), 1);

  assert.equal(runner.cancel(42), true);
  assert.equal(controller?.signal.aborted, true);
  assert.equal(runner.cancel(42), true, 'cancelling an active job is idempotent');

  runner.finish(42);
  assert.equal(runner.isActive(42), false);
  assert.equal(runner.activeCount(), 0);
});

test('processPdf validates and rewrites a real PDF', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-process-'));
  const input = join(dir, 'input.pdf');
  const output = join(dir, 'output.pdf');

  try {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.addPage();
    await writeFile(input, await doc.save());

    const result = await processPdf(input, output, {
      maxOutputBytes: 49 * 1024 * 1024,
      maxPages: 300,
      timeoutMs: 10_000,
    });

    assert.equal(result.pages, 2);
    assert.equal(result.inputBytes > 0, true);
    assert.equal(result.outputBytes > 0, true);

    const bytes = await readFile(output);
    assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');
    const parsed = await PDFDocument.load(bytes);
    assert.equal(parsed.getPageCount(), 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('processPdf rejects damaged files and removes partial output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-process-'));
  const input = join(dir, 'input.pdf');
  const output = join(dir, 'output.pdf');

  try {
    await writeFile(input, 'this is not a pdf');
    await assert.rejects(
      processPdf(input, output, {
        maxOutputBytes: 49 * 1024 * 1024,
        maxPages: 300,
        timeoutMs: 10_000,
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal((error as { code?: string }).code, 'invalid_pdf');
        return true;
      },
    );
    assert.equal(existsSync(output), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('processPdf refuses to start when already cancelled', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notesprint-process-'));
  const input = join(dir, 'input.pdf');
  const output = join(dir, 'output.pdf');

  try {
    const doc = await PDFDocument.create();
    doc.addPage();
    await writeFile(input, await doc.save());

    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      processPdf(input, output, {
        maxOutputBytes: 49 * 1024 * 1024,
        maxPages: 300,
        timeoutMs: 10_000,
        signal: controller.signal,
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'cancelled');
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rendered UI keeps limits and no persistent file history', () => {
  const kb = mainMenuKeyboard('en', config(), false, false);
  const buttons = kb.inline_keyboard.flat();

  assert.equal(buttons.length, 4);
  assert.equal(buttons.some((button) => button.text === 'Compress PDF'), false);
  assert.equal(buttons.some((button) => button.text === '📁 My Files'), false);

  const help = helpText('en', config());
  assert.match(help, /up to 19 MB/);
  assert.match(help, /deleted after delivery/);
  assert.match(help, /PDF24/);
});

test('19 MiB upload boundary is enforced without a database', () => {
  const limit = 19 * 1024 * 1024;
  const doc = (size: number) => ({
    file_id: 'file',
    file_name: 'document.pdf',
    mime_type: 'application/pdf',
    file_size: size,
  });

  assert.deepEqual(validatePdfMetadata(doc(limit), limit), {
    ok: true,
    declaredSize: limit,
  });
  assert.deepEqual(validatePdfMetadata(doc(limit + 1), limit), {
    ok: false,
    code: 'too_large',
  });
});
