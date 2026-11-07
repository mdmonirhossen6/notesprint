import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const VALID_TOKEN = '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function baseEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    BOT_TOKEN: VALID_TOKEN,
    SUPER_ADMIN_ID: '6885443469',
    BOT_MODE: 'polling',
    DATABASE_PATH: ':memory:',
    ...overrides,
  };
}

test('loads a valid polling config with defaults', () => {
  const config = loadConfig(baseEnv());
  assert.equal(config.botMode, 'polling');
  assert.equal(config.superAdminId, 6885443469);
  assert.equal(config.port, 8080);
  assert.equal(config.maxUploadMb, 19);
  assert.equal(config.maxOutputMb, 49);
  assert.equal(config.requiredChannels.length, 2);
  assert.equal(config.requiredChannels[0]?.chatRef, '@prostutibd');
  assert.equal(config.botApiRoot, 'https://api.telegram.org');
  assert.equal(config.membershipCacheTtlSeconds, 180);
  assert.equal(config.prostutiAppUrl, 'https://prostuti.bd');
});

test('rejects a missing token without echoing any secret', () => {
  assert.throws(
    () => loadConfig(baseEnv({ BOT_TOKEN: '' })),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /BOT_TOKEN/);
      assert.equal(error.message.includes(VALID_TOKEN), false);
      return true;
    },
  );
});

test('rejects a malformed token', () => {
  assert.throws(() => loadConfig(baseEnv({ BOT_TOKEN: 'not-a-token' })), /BOT_TOKEN/);
});

test('webhook mode requires an https URL and a strong secret', () => {
  assert.throws(() => loadConfig(baseEnv({ BOT_MODE: 'webhook' })), /WEBHOOK_URL/);

  assert.throws(
    () =>
      loadConfig(
        baseEnv({
          BOT_MODE: 'webhook',
          WEBHOOK_URL: 'http://bot.example.com/telegram',
          WEBHOOK_SECRET: 'abcdefghijklmnop',
        }),
      ),
    /https/,
  );

  assert.throws(
    () =>
      loadConfig(
        baseEnv({
          BOT_MODE: 'webhook',
          WEBHOOK_URL: 'https://bot.example.com/telegram',
          WEBHOOK_SECRET: 'short',
        }),
      ),
    /WEBHOOK_SECRET/,
  );
});

test('accepts the local Bot API over http only on localhost', () => {
  const local = loadConfig(baseEnv({ BOT_API_ROOT: 'http://127.0.0.1:8081' }));
  assert.equal(local.botApiRoot, 'http://127.0.0.1:8081');
  assert.equal(local.botApiAllowHttp, false);

  assert.throws(
    () => loadConfig(baseEnv({ BOT_API_ROOT: 'http://bot.example.com' })),
    /BOT_API_ROOT/,
  );

  const docker = loadConfig(
    baseEnv({ BOT_API_ROOT: 'http://telegram-bot-api:8081', BOT_API_ALLOW_HTTP: 'true' }),
  );
  assert.equal(docker.botApiAllowHttp, true);
  assert.throws(
    () =>
      loadConfig(
        baseEnv({ BOT_API_ROOT: 'http://bot.example.com', BOT_API_ALLOW_HTTP: 'maybe' }),
      ),
    /BOT_API_ALLOW_HTTP/,
  );
});

test('local Bot API credentials are optional but validated together', () => {
  const config = loadConfig(baseEnv());
  assert.equal(config.telegramApiId, undefined);
  assert.equal(config.telegramApiHash, undefined);

  const withCredentials = loadConfig(
    baseEnv({
      TELEGRAM_API_ID: '123456',
      TELEGRAM_API_HASH: '0123456789abcdef0123456789abcdef',
    }),
  );
  assert.equal(withCredentials.telegramApiId, 123456);
  assert.equal(withCredentials.telegramApiHash, '0123456789abcdef0123456789abcdef');

  assert.throws(
    () => loadConfig(baseEnv({ TELEGRAM_API_ID: '123456' })),
    /TELEGRAM_API_ID and TELEGRAM_API_HASH/,
  );
  assert.throws(
    () =>
      loadConfig(
        baseEnv({ TELEGRAM_API_ID: '0', TELEGRAM_API_HASH: '0123456789abcdef0123456789abcdef' }),
      ),
    /TELEGRAM_API_ID/,
  );
  assert.throws(
    () =>
      loadConfig(
        baseEnv({ TELEGRAM_API_ID: '123456', TELEGRAM_API_HASH: 'not-hex' }),
      ),
    /TELEGRAM_API_HASH/,
  );
});

test('honours stateless transfer and rate limit defaults', () => {
  const config = loadConfig(baseEnv());
  assert.equal(config.downloadConcurrency, 2);
  assert.equal(config.fileTransferTimeoutSeconds, 120);
  assert.equal(config.processTimeoutSeconds, 180);
  assert.equal(config.minFreeDiskMb, 64);
  assert.equal(config.tempFileTtlMinutes, 60);
  assert.equal(config.uploadRateLimitCount, 10);
  assert.equal(config.uploadRateLimitWindowMinutes, 60);
  assert.equal(config.maxUploadMb, 19);
  assert.equal(config.maxOutputMb, 49);

  assert.throws(() => loadConfig(baseEnv({ DOWNLOAD_CONCURRENCY: '9' })), /DOWNLOAD_CONCURRENCY/);
  assert.throws(
    () => loadConfig(baseEnv({ FILE_TRANSFER_TIMEOUT_SECONDS: '10' })),
    /FILE_TRANSFER_TIMEOUT_SECONDS/,
  );
  assert.throws(() => loadConfig(baseEnv({ MIN_FREE_DISK_MB: '1' })), /MIN_FREE_DISK_MB/);
  assert.throws(() => loadConfig(baseEnv({ TEMP_FILE_TTL_MINUTES: '1' })), /TEMP_FILE_TTL_MINUTES/);
  assert.throws(() => loadConfig(baseEnv({ UPLOAD_RATE_LIMIT_COUNT: '0' })), /UPLOAD_RATE_LIMIT_COUNT/);
  assert.throws(
    () => loadConfig(baseEnv({ UPLOAD_RATE_LIMIT_WINDOW_MINUTES: '0' })),
    /UPLOAD_RATE_LIMIT_WINDOW_MINUTES/,
  );
  assert.throws(
    () => loadConfig(baseEnv({ PROCESS_TIMEOUT_SECONDS: '5' })),
    /PROCESS_TIMEOUT_SECONDS/,
  );
});

test('REQUIRED_CHANNELS parses usernames and private numeric IDs', () => {
  const config = loadConfig(
    baseEnv({ REQUIRED_CHANNELS: '@prostutibd, -1001234567890, @prostutibd' }),
  );
  assert.equal(config.requiredChannels.length, 2);
  assert.deepEqual(
    config.requiredChannels.map((channel) => channel.chatRef),
    ['@prostutibd', '-1001234567890'],
  );
  assert.equal(config.requiredChannels[0]?.joinUrl, 'https://t.me/prostutibd');
  assert.equal(config.requiredChannels[1]?.joinUrl, null);

  const empty = loadConfig(baseEnv({ REQUIRED_CHANNELS: '' }));
  assert.deepEqual(empty.requiredChannels, []);

  assert.throws(
    () => loadConfig(baseEnv({ REQUIRED_CHANNELS: 'https://t.me/prostutibd' })),
    /REQUIRED_CHANNELS/,
  );
});

test('rejects out-of-range limits and ports', () => {
  assert.throws(() => loadConfig(baseEnv({ PORT: '0' })), /PORT/);
  assert.throws(() => loadConfig(baseEnv({ MAX_PDF_PAGES: '-5' })), /MAX_PDF_PAGES/);
  assert.throws(() => loadConfig(baseEnv({ PROCESS_CONCURRENCY: '99' })), /PROCESS_CONCURRENCY/);
});

test('membership cache TTL is limited to 2-5 minutes', () => {
  assert.equal(
    loadConfig(baseEnv({ MEMBERSHIP_CACHE_TTL_SECONDS: '120' })).membershipCacheTtlSeconds,
    120,
  );
  assert.equal(
    loadConfig(baseEnv({ MEMBERSHIP_CACHE_TTL_SECONDS: '300' })).membershipCacheTtlSeconds,
    300,
  );
  assert.throws(
    () => loadConfig(baseEnv({ MEMBERSHIP_CACHE_TTL_SECONDS: '119' })),
    /MEMBERSHIP_CACHE_TTL_SECONDS/,
  );
  assert.throws(
    () => loadConfig(baseEnv({ MEMBERSHIP_CACHE_TTL_SECONDS: '301' })),
    /MEMBERSHIP_CACHE_TTL_SECONDS/,
  );
});

test('prostuti app URL must be https', () => {
  assert.equal(
    loadConfig(baseEnv({ PROSTUTI_APP_URL: 'https://prostuti.bd/app' })).prostutiAppUrl,
    'https://prostuti.bd/app',
  );
  assert.throws(
    () => loadConfig(baseEnv({ PROSTUTI_APP_URL: 'http://prostuti.bd' })),
    /PROSTUTI_APP_URL/,
  );
  assert.throws(
    () => loadConfig(baseEnv({ PROSTUTI_APP_URL: 'not a url' })),
    /PROSTUTI_APP_URL/,
  );
});
