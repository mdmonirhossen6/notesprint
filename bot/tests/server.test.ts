import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Bot } from 'grammy';
import type { AppConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { startHttpServer } from '../src/server.js';

const TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function testConfig(): AppConfig {
  return {
    nodeEnv: 'test',
    logLevel: 'error',
    botToken: TOKEN,
    botMode: 'webhook',
    botApiRoot: 'https://api.telegram.org',
    botApiAllowHttp: false,
    telegramApiId: undefined,
    telegramApiHash: undefined,
    localFileRoot: undefined,
    webhookUrl: 'https://bot.example.com/telegram',
    webhookSecret: 'abcdefghijklmnop',
    webhookPath: '/telegram',
    port: 0,
    superAdminId: 5000,
    databasePath: ':memory:',
    tmpDir: './tmp',
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
    fileTransferTimeoutSeconds: 600,
    minFreeDiskMb: 512,
    tempFileTtlMinutes: 120,
    uploadRateLimitCount: 10,
    uploadRateLimitWindowMinutes: 60,
    membershipCacheTtlSeconds: 180,
    requiredChannels: [],
    prostutiAppUrl: 'https://prostuti.bd',
  };
}

test('health endpoint reports ready status and unknown paths 404', async () => {
  const bot = new Bot(TOKEN, { client: { apiRoot: 'https://api.telegram.org' } });
  const server = startHttpServer(bot, testConfig(), createLogger('error'));

  if (!server.listening) {
    await once(server, 'listening');
  }

  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);
  const body = (await health.json()) as { ok: boolean; version: string };
  assert.equal(body.ok, true);
  assert.equal(typeof body.version, 'string');

  const missing = await fetch(`${base}/nope`);
  assert.equal(missing.status, 404);

  await new Promise<void>((resolve) => server.close(() => resolve()));
});
