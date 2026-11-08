import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import type { AppConfig } from './config.js';
import type { Logger } from './logger.js';
import { BOT_VERSION } from './version.js';

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';
const MAX_WEBHOOK_BYTES = 1024 * 1024;
const WEBHOOK_BODY_TIMEOUT_MS = 10_000;
const SLOW_REQUEST_MS = 2_000;
const UPDATE_DEDUPE_TTL_MS = 10 * 60 * 1000;
const UPDATE_DEDUPE_LIMIT = 2_000;

export const HEALTH_PATH = '/healthz';
export const HEALTH_BODY = JSON.stringify({ ok: true, version: BOT_VERSION });

export interface UpdateDeduplicator {
  /** Returns true the first time an update id is seen, false for retries. */
  mark(updateId: number): boolean;
  prune(now?: number): number;
  readonly size: number;
}

export interface UpdateDeduplicatorOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

export function createUpdateDeduplicator(
  options: UpdateDeduplicatorOptions = {},
): UpdateDeduplicator {
  const ttlMs = options.ttlMs ?? UPDATE_DEDUPE_TTL_MS;
  const maxEntries = Math.max(1, options.maxEntries ?? UPDATE_DEDUPE_LIMIT);
  const now = options.now ?? Date.now;
  const seenAt = new Map<number, number>();

  const prune = (at = now()): number => {
    let removed = 0;
    for (const [updateId, timestamp] of seenAt) {
      const expired = at - timestamp >= ttlMs;
      if (!expired && seenAt.size <= maxEntries) break;
      seenAt.delete(updateId);
      removed += 1;
    }
    return removed;
  };

  return {
    mark(updateId) {
      const timestamp = now();
      const previous = seenAt.get(updateId);
      if (previous !== undefined && timestamp - previous < ttlMs) {
        seenAt.delete(updateId);
        seenAt.set(updateId, timestamp);
        return false;
      }
      seenAt.delete(updateId);
      seenAt.set(updateId, timestamp);
      if (seenAt.size > maxEntries) prune(timestamp);
      return true;
    },
    prune,
    get size() {
      return seenAt.size;
    },
  };
}

export interface HttpServerOptions {
  /**
   * Resolves once the bot is ready to handle updates. Update handling waits for
   * this, but HTTP responses (including /healthz) never do.
   */
  ensureReady?: () => Promise<void>;
}

interface HttpBodyError extends Error {
  status: number;
}

function bodyError(status: number, message: string): HttpBodyError {
  const error = new Error(message) as HttpBodyError;
  error.name = 'HttpBodyError';
  error.status = status;
  return error;
}

function isBodyError(error: unknown): error is HttpBodyError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: string }).name === 'HttpBodyError'
  );
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function secretMatches(header: string | string[] | undefined, secret: string): boolean {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return false;
  // Hashing first keeps the comparison length-constant for every input length.
  return timingSafeEqual(digest(value), digest(secret));
}

function isUpdate(value: unknown): value is Update {
  return (
    typeof value === 'object' &&
    value !== null &&
    'update_id' in value &&
    Number.isSafeInteger((value as { update_id?: unknown }).update_id)
  );
}

function respond(
  res: ServerResponse,
  status: number,
  body: string,
  contentType = 'text/plain; charset=utf-8',
): void {
  if (res.headersSent || res.writableEnded) return;
  const payload = Buffer.from(body, 'utf8');
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': payload.length,
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function readBody(
  req: IncomingMessage,
  limit: number,
  timeoutMs: number,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('aborted', onAborted);
    };

    const fail = (error: HttpBodyError): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > limit) {
        req.pause();
        fail(bodyError(413, 'request body too large'));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const onError = (error: Error): void => fail(bodyError(400, error.message));
    const onAborted = (): void => fail(bodyError(400, 'request aborted'));

    timer = setTimeout(() => {
      req.pause();
      fail(bodyError(408, 'request body timed out'));
    }, timeoutMs);
    timer.unref();

    req.on('data', onData);
    req.once('end', onEnd);
    req.once('error', onError);
    req.once('aborted', onAborted);
  });
}

function pathOf(req: IncomingMessage): string | null {
  try {
    return new URL(req.url ?? '/', 'http://localhost').pathname;
  } catch {
    return null;
  }
}

export function startHttpServer(
  bot: Bot,
  config: AppConfig,
  logger: Logger,
  options: HttpServerOptions = {},
): Server {
  if (!config.webhookSecret) {
    throw new Error('Webhook secret is missing');
  }
  const secret = config.webhookSecret;
  const dedupe = createUpdateDeduplicator();

  let readyPromise: Promise<void> | undefined;
  const ensureReady =
    options.ensureReady ??
    (() => {
      readyPromise ??= bot.init().then(() => undefined);
      return readyPromise;
    });

  async function handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!secretMatches(req.headers[SECRET_HEADER], secret)) {
      respond(res, 401, '"unauthorized"');
      return;
    }

    let update: Update;
    try {
      const raw = await readBody(req, MAX_WEBHOOK_BYTES, WEBHOOK_BODY_TIMEOUT_MS);
      const parsed: unknown = JSON.parse(raw);
      if (!isUpdate(parsed)) {
        respond(res, 400, 'invalid update');
        return;
      }
      update = parsed;
    } catch (error) {
      if (!isBodyError(error)) {
        logger.warn('webhook_body_failed', {}, error);
      }
      if (isBodyError(error) && error.status === 413) {
        res.setHeader('connection', 'close');
      }
      respond(res, isBodyError(error) ? error.status : 400, 'invalid request');
      return;
    }

    if (!dedupe.mark(update.update_id)) {
      // Telegram re-delivers an update we have already accepted.
      respond(res, 200, '');
      return;
    }

    // Acknowledge first: Telegram delivery must never wait for bot work. The
    // update runs on the event loop after the response is flushed.
    respond(res, 200, '');

    setImmediate(() => {
      void (async () => {
        try {
          await ensureReady();
        } catch (error) {
          logger.error('bot_init_failed', { updateId: update.update_id }, error);
          return;
        }
        try {
          await bot.handleUpdate(update);
        } catch (error) {
          logger.error('update_failed', { updateId: update.update_id }, error);
        }
      })();
    });
  }

  const server = createServer((req, res) => {
    const startedAt = performance.now();
    res.once('finish', () => {
      const durationMs = Math.round(performance.now() - startedAt);
      const path = pathOf(req) ?? 'invalid';
      const fields = {
        method: req.method ?? 'GET',
        path,
        status: res.statusCode,
        durationMs,
        rssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      };
      if (durationMs >= SLOW_REQUEST_MS) logger.warn('http_slow_request', fields);
      else logger.debug('http_request', fields);
    });

    const path = pathOf(req);
    if (path === null) {
      respond(res, 400, 'bad request');
      return;
    }

    if (path === HEALTH_PATH && (req.method === 'GET' || req.method === 'HEAD')) {
      if (req.method === 'HEAD') {
        res.writeHead(200, {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(HEALTH_BODY),
          'cache-control': 'no-store',
        });
        res.end();
        return;
      }
      respond(res, 200, HEALTH_BODY, 'application/json');
      return;
    }

    if (path === config.webhookPath && req.method === 'POST') {
      void handleWebhook(req, res).catch((error: unknown) => {
        logger.error('webhook_failed', { path }, error);
        if (!res.headersSent) respond(res, 500, 'webhook failed');
        else if (!res.writableEnded) res.end();
      });
      return;
    }

    respond(res, 404, 'not found');
  });

  server.keepAliveTimeout = 5_000;
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;

  // Render routes to the container interface; binding to all interfaces avoids
  // IPv4/IPv6 mismatches between the proxy and Node.
  server.listen(config.port, '0.0.0.0', () => {
    logger.info('http_listening', { port: config.port, webhookPath: config.webhookPath });
  });
  server.on('error', (error) => {
    logger.error('http_server_error', {}, error);
    setImmediate(() => process.exit(1));
  });

  return server;
}
