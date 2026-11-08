import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import type { AppConfig } from '../src/config.js';
import type { Logger } from '../src/logger.js';
import {
  createUpdateDeduplicator,
  HEALTH_BODY,
  startHttpServer,
} from '../src/server.js';
import { BOT_VERSION } from '../src/version.js';
import { createWorkspaceStore } from '../src/workspace/store.js';

const TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const SECRET = 'abcdefghijklmnop';
const WEBHOOK_PATH = '/telegram';
const HEALTH_TIMEOUT_MS = 1_000;

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

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
    webhookSecret: SECRET,
    webhookPath: WEBHOOK_PATH,
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

function createStubBot(handleUpdate: (update: Update) => Promise<void>): Bot {
  const stub = {
    me: { id: 1, is_bot: true, first_name: 'Test', username: 'test_bot' },
    init: async () => stub.me,
    handleUpdate,
  };
  return stub as unknown as Bot;
}

interface Harness {
  base: string;
  close: () => Promise<void>;
}

async function startServer(
  bot: Bot,
  ensureReady: () => Promise<void> = async () => undefined,
): Promise<Harness> {
  const server = startHttpServer(bot, testConfig(), silentLogger, { ensureReady });
  if (!server.listening) await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: async () => {
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await closed;
    },
  };
}

function messageUpdate(updateId: number): Update {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_700_000_000,
      chat: { id: 42, type: 'private', first_name: 'Tester' },
      from: { id: 42, is_bot: false, first_name: 'Tester' },
      text: 'hello',
    },
  };
}

function postUpdate(
  base: string,
  update: Update,
  secret = SECRET,
  path = WEBHOOK_PATH,
): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': secret,
    },
    body: JSON.stringify(update),
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHealth(base: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    return await fetch(`${base}/healthz`, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

test('health endpoint returns the exact minimal JSON payload', async () => {
  const harness = await startServer(createStubBot(async () => undefined));
  try {
    const response = await fetchHealth(harness.base);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    const body = await response.text();
    assert.equal(body, HEALTH_BODY);
    assert.deepEqual(JSON.parse(body), { ok: true, version: BOT_VERSION });
  } finally {
    await harness.close();
  }
});

test('idle health requests complete in under 100 ms', async () => {
  const harness = await startServer(createStubBot(async () => undefined));
  try {
    await fetchHealth(harness.base);
    const startedAt = performance.now();
    const response = await fetchHealth(harness.base);
    const elapsed = performance.now() - startedAt;
    assert.equal(response.status, 200);
    await response.arrayBuffer();
    assert.ok(elapsed < 100, `health request took ${elapsed.toFixed(1)} ms`);
  } finally {
    await harness.close();
  }
});

test('health responds before the bot is initialized', async () => {
  const neverReady = new Promise<void>(() => undefined);
  const harness = await startServer(createStubBot(async () => undefined), () => neverReady);
  try {
    const response = await fetchHealth(harness.base);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), HEALTH_BODY);
  } finally {
    await harness.close();
  }
});

test('health stays responsive while an update handler is blocked', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let handlerStarted = false;
  const bot = createStubBot(async () => {
    handlerStarted = true;
    await gate;
  });
  const harness = await startServer(bot);
  try {
    const startedAt = performance.now();
    const ack = await postUpdate(harness.base, messageUpdate(1));
    const ackMs = performance.now() - startedAt;
    assert.equal(ack.status, 200);
    assert.ok(ackMs < 250, `webhook acknowledgement took ${ackMs.toFixed(1)} ms`);

    await waitFor(() => handlerStarted);

    const health = await fetchHealth(harness.base);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), HEALTH_BODY);
  } finally {
    release();
    await harness.close();
  }
});

test('webhook rejects a wrong secret without running the handler', async () => {
  let handled = 0;
  const harness = await startServer(
    createStubBot(async () => {
      handled += 1;
    }),
  );
  try {
    const response = await postUpdate(harness.base, messageUpdate(2), 'wrong-secret-value');
    assert.equal(response.status, 401);
    assert.equal(await response.text(), '"unauthorized"');
    await delay(30);
    assert.equal(handled, 0);
  } finally {
    await harness.close();
  }
});

test('webhook accepts a valid secret and forwards the update once', async () => {
  const received: Update[] = [];
  const harness = await startServer(
    createStubBot(async (update) => {
      received.push(update);
    }),
  );
  try {
    const response = await postUpdate(harness.base, messageUpdate(3));
    assert.equal(response.status, 200);
    await waitFor(() => received.length === 1);
    assert.equal(received[0]?.update_id, 3);
  } finally {
    await harness.close();
  }
});

test('duplicate update deliveries are processed only once', async () => {
  let handled = 0;
  const harness = await startServer(
    createStubBot(async () => {
      handled += 1;
    }),
  );
  try {
    const update = messageUpdate(4);
    const responses = await Promise.all([
      postUpdate(harness.base, update),
      postUpdate(harness.base, update),
      postUpdate(harness.base, update),
    ]);
    for (const response of responses) assert.equal(response.status, 200);
    await delay(80);
    assert.equal(handled, 1);
  } finally {
    await harness.close();
  }
});

test('a failing update does not crash the server or block later updates', async () => {
  const received: number[] = [];
  const harness = await startServer(
    createStubBot(async (update) => {
      received.push(update.update_id);
      if (update.update_id === 5) throw new Error('handler exploded');
    }),
  );
  try {
    const failed = await postUpdate(harness.base, messageUpdate(5));
    assert.equal(failed.status, 200);
    await waitFor(() => received.length === 1);

    const health = await fetchHealth(harness.base);
    assert.equal(health.status, 200);

    const next = await postUpdate(harness.base, messageUpdate(6));
    assert.equal(next.status, 200);
    await waitFor(() => received.length === 2);
    assert.deepEqual(received, [5, 6]);
  } finally {
    await harness.close();
  }
});

test('workspace cancellation and cleanup do not block health', async () => {
  let now = 1_000;
  const store = createWorkspaceStore({ ttlMs: 50, now: () => now });
  const harness = await startServer(createStubBot(async () => undefined));
  try {
    const { workspace } = store.start(7, 7);
    workspace.controller.abort();
    store.clear(7);

    const second = store.start(8, 8).workspace;
    second.controller.abort();
    now += 1_000;
    assert.equal(store.prune().length, 1);

    const health = await fetchHealth(harness.base);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), HEALTH_BODY);
  } finally {
    await harness.close();
  }
});

test('unknown paths return 404 without touching Telegram', async () => {
  let handled = 0;
  const harness = await startServer(
    createStubBot(async () => {
      handled += 1;
    }),
  );
  try {
    const response = await fetch(`${harness.base}/nope`);
    assert.equal(response.status, 404);
    await delay(20);
    assert.equal(handled, 0);
  } finally {
    await harness.close();
  }
});

test('update deduplicator forgets old ids and caps memory', () => {
  let now = 0;
  const dedupe = createUpdateDeduplicator({ ttlMs: 100, maxEntries: 2, now: () => now });
  assert.equal(dedupe.mark(1), true);
  assert.equal(dedupe.mark(1), false);
  now = 150;
  assert.equal(dedupe.mark(1), true);
  assert.equal(dedupe.mark(2), true);
  assert.equal(dedupe.mark(3), true);
  assert.ok(dedupe.size <= 2);
  assert.equal(dedupe.prune(1_000), 2);
  assert.equal(dedupe.size, 0);
});
