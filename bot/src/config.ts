import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deriveJoinUrl, normalizeChannelRef, parseChannelRef } from './channels/validation.js';
import type { RequiredChannel } from './channels/types.js';

export type BotMode = 'polling' | 'webhook';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type NodeEnv = 'development' | 'production' | 'test';

export interface AppConfig {
  nodeEnv: NodeEnv;
  logLevel: LogLevel;
  botToken: string;
  botMode: BotMode;
  botApiRoot: string;
  botApiAllowHttp: boolean;
  telegramApiId: number | undefined;
  telegramApiHash: string | undefined;
  localFileRoot: string | undefined;
  webhookUrl: string | undefined;
  webhookSecret: string | undefined;
  webhookPath: string;
  port: number;
  superAdminId: number;
  databasePath: string;
  tmpDir: string;
  maxUploadMb: number;
  maxOutputMb: number;
  maxPdfPages: number;
  processTimeoutSeconds: number;
  processConcurrency: number;
  downloadConcurrency: number;
  fileTransferTimeoutSeconds: number;
  minFreeDiskMb: number;
  tempFileTtlMinutes: number;
  uploadRateLimitCount: number;
  uploadRateLimitWindowMinutes: number;
  membershipCacheTtlSeconds: number;
  requiredChannels: RequiredChannel[];
  prostutiAppUrl: string;
}

const BOT_TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{20,}$/;
const WEBHOOK_SECRET_RE = /^[A-Za-z0-9_-]{16,256}$/;
const API_HASH_RE = /^[0-9a-f]{32}$/i;
const NODE_ENVS: readonly NodeEnv[] = ['development', 'production', 'test'];
const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

function readString(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function readInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function readBool(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === '1' || raw === 'true' || raw === 'yes') return true;
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  throw new Error(`${key} must be true or false`);
}

const DEFAULT_REQUIRED_CHANNELS = '@prostutibd,@admissionfreepdf';

export function parseRequiredChannels(raw: string): RequiredChannel[] {
  const entries = raw
    .split(/[,\n;]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const seen = new Set<string>();
  const channels: RequiredChannel[] = [];

  for (const entry of entries) {
    const parsed = parseChannelRef(entry);
    if (!parsed.ok) {
      throw new Error(`REQUIRED_CHANNELS entry is invalid: ${parsed.error}`);
    }

    const normalized = normalizeChannelRef(parsed.value.ref);
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    if (parsed.value.kind === 'username') {
      channels.push({
        id: channels.length + 1,
        chatRef: `@${parsed.value.username}`,
        chatId: null,
        title: `@${parsed.value.username}`,
        joinUrl: deriveJoinUrl(parsed.value.username),
        isEnabled: true,
        createdAt: 0,
      });
    } else {
      channels.push({
        id: channels.length + 1,
        chatRef: parsed.value.ref,
        chatId: parsed.value.chatId,
        title: parsed.value.ref,
        joinUrl: null,
        isEnabled: true,
        createdAt: 0,
      });
    }
  }

  return channels;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (env.NODE_ENV?.trim() || 'development') as NodeEnv;
  if (!NODE_ENVS.includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, production, or test');
  }

  const logLevel = (env.LOG_LEVEL?.trim() || 'info') as LogLevel;
  if (!LOG_LEVELS.includes(logLevel)) {
    throw new Error('LOG_LEVEL must be debug, info, warn, or error');
  }

  const botToken = readString(env, 'BOT_TOKEN');
  if (!BOT_TOKEN_RE.test(botToken)) {
    throw new Error('BOT_TOKEN is not a valid Telegram bot token');
  }

  const botMode = (env.BOT_MODE?.trim() || 'polling') as BotMode;
  if (botMode !== 'polling' && botMode !== 'webhook') {
    throw new Error('BOT_MODE must be polling or webhook');
  }

  const webhookUrl = env.WEBHOOK_URL?.trim() || undefined;
  const webhookSecret = env.WEBHOOK_SECRET?.trim() || undefined;

  if (botMode === 'webhook') {
    if (!webhookUrl) throw new Error('WEBHOOK_URL is required when BOT_MODE=webhook');
    let parsed: URL;
    try {
      parsed = new URL(webhookUrl);
    } catch {
      throw new Error('WEBHOOK_URL is not a valid URL');
    }
    if (parsed.protocol !== 'https:') {
      throw new Error('WEBHOOK_URL must use https');
    }
    if (!webhookSecret || !WEBHOOK_SECRET_RE.test(webhookSecret)) {
      throw new Error('WEBHOOK_SECRET must be 16-256 characters: letters, digits, _ or -');
    }
  }

  const botApiRoot = (env.BOT_API_ROOT?.trim() || 'https://api.telegram.org').replace(/\/+$/, '');
  const apiUrl = new URL(botApiRoot);
  const localHosts = ['localhost', '127.0.0.1', '::1', '[::1]'];
  const botApiAllowHttp = readBool(env, 'BOT_API_ALLOW_HTTP', false);
  if (
    apiUrl.protocol !== 'https:' &&
    !localHosts.includes(apiUrl.hostname) &&
    !botApiAllowHttp
  ) {
    throw new Error(
      'BOT_API_ROOT must use https unless it points to localhost or BOT_API_ALLOW_HTTP=true',
    );
  }

  const apiIdRaw = env.TELEGRAM_API_ID?.trim();
  const apiHashRaw = env.TELEGRAM_API_HASH?.trim();
  if (Boolean(apiIdRaw) !== Boolean(apiHashRaw)) {
    throw new Error('TELEGRAM_API_ID and TELEGRAM_API_HASH must be set together');
  }

  let telegramApiId: number | undefined;
  if (apiIdRaw) {
    telegramApiId = Number(apiIdRaw);
    if (!Number.isSafeInteger(telegramApiId) || telegramApiId <= 0) {
      throw new Error('TELEGRAM_API_ID must be a positive integer');
    }
  }

  let telegramApiHash: string | undefined;
  if (apiHashRaw) {
    if (!API_HASH_RE.test(apiHashRaw)) {
      throw new Error('TELEGRAM_API_HASH must be a 32-character hexadecimal value');
    }
    telegramApiHash = apiHashRaw;
  }

  const localFileRootRaw = env.LOCAL_FILE_ROOT?.trim();
  const localFileRoot = localFileRootRaw ? resolve(localFileRootRaw) : undefined;

  const webhookPath = env.WEBHOOK_PATH?.trim() || '/telegram';
  if (!webhookPath.startsWith('/') || webhookPath.includes('?')) {
    throw new Error('WEBHOOK_PATH must start with / and must not contain a query string');
  }

  const prostutiAppUrl = env.PROSTUTI_APP_URL?.trim() || 'https://prostuti.bd';
  let prostutiUrl: URL;
  try {
    prostutiUrl = new URL(prostutiAppUrl);
  } catch {
    throw new Error('PROSTUTI_APP_URL is not a valid URL');
  }
  if (prostutiUrl.protocol !== 'https:') {
    throw new Error('PROSTUTI_APP_URL must use https');
  }

  return {
    nodeEnv,
    logLevel,
    botToken,
    botMode,
    botApiRoot,
    botApiAllowHttp,
    telegramApiId,
    telegramApiHash,
    localFileRoot,
    webhookUrl,
    webhookSecret,
    webhookPath,
    port: readInt(env, 'PORT', 8080, 1, 65535),
    superAdminId: readInt(env, 'SUPER_ADMIN_ID', 6885443469, 1, Number.MAX_SAFE_INTEGER),
    databasePath: env.DATABASE_PATH?.trim() || './data/notesprint.db',
    tmpDir: env.TMP_DIR?.trim() || join(tmpdir(), 'notesprint'),
    maxUploadMb: readInt(env, 'MAX_UPLOAD_MB', 19, 1, 20),
    maxOutputMb: readInt(env, 'MAX_OUTPUT_MB', 49, 1, 49),
    maxPdfPages: readInt(env, 'MAX_PDF_PAGES', 300, 1, 10000),
    processTimeoutSeconds: readInt(env, 'PROCESS_TIMEOUT_SECONDS', 180, 30, 900),
    processConcurrency: readInt(env, 'PROCESS_CONCURRENCY', 1, 1, 8),
    downloadConcurrency: readInt(env, 'DOWNLOAD_CONCURRENCY', 2, 1, 8),
    fileTransferTimeoutSeconds: readInt(env, 'FILE_TRANSFER_TIMEOUT_SECONDS', 120, 30, 900),
    minFreeDiskMb: readInt(env, 'MIN_FREE_DISK_MB', 64, 16, 100000),
    tempFileTtlMinutes: readInt(env, 'TEMP_FILE_TTL_MINUTES', 60, 5, 1440),
    uploadRateLimitCount: readInt(env, 'UPLOAD_RATE_LIMIT_COUNT', 10, 1, 1000),
    uploadRateLimitWindowMinutes: readInt(env, 'UPLOAD_RATE_LIMIT_WINDOW_MINUTES', 60, 1, 1440),
    membershipCacheTtlSeconds: readInt(env, 'MEMBERSHIP_CACHE_TTL_SECONDS', 180, 120, 300),
    requiredChannels: parseRequiredChannels(
      env.REQUIRED_CHANNELS === undefined
        ? DEFAULT_REQUIRED_CHANNELS
        : env.REQUIRED_CHANNELS,
    ),
    prostutiAppUrl: prostutiUrl.toString().replace(/\/+$/, ''),
  };
}
