import type { Server } from 'node:http';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createBot } from './bot/create-bot.js';
import { cleanupExpiredFiles, cleanupFile, ensureDirectory } from './files/paths.js';
import { createTaskQueue } from './files/queue.js';
import { createRateLimiter } from './files/rate-limit.js';
import { createUploadSessionStore } from './files/upload-session.js';
import { createMergeSessionStore } from './files/merge-session.js';
import { createToolSessionStore } from './files/tool-session.js';
import { createJobRunner } from './jobs/runner.js';
import { startHttpServer } from './server.js';

const UPLOAD_SESSION_TTL_MS = 15 * 60 * 1000;
const MERGE_SESSION_TTL_MS = 30 * 60 * 1000;
const TOOL_SESSION_TTL_MS = 30 * 60 * 1000;
const MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000;
const SHUTDOWN_DRAIN_MS = 20_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  await ensureDirectory(config.tmpDir);

  const fileQueue = createTaskQueue({
    concurrency: 1,
    onTaskError: (error) => logger.error('file_task_failed', {}, error),
  });
  const uploadSessions = createUploadSessionStore({ ttlMs: UPLOAD_SESSION_TTL_MS });
  const mergeSessions = createMergeSessionStore({ ttlMs: MERGE_SESSION_TTL_MS });
  const toolSessions = createToolSessionStore({ ttlMs: TOOL_SESSION_TTL_MS });
  const uploadRateLimiter = createRateLimiter({
    limit: config.uploadRateLimitCount,
    windowMs: config.uploadRateLimitWindowMinutes * 60 * 1000,
  });
  const jobRunner = createJobRunner();

  const runMaintenance = async (): Promise<void> => {
    try {
      const removedFiles = await cleanupExpiredFiles(
        config.tmpDir,
        config.tempFileTtlMinutes * 60 * 1000,
      );
      const expiredSessions = uploadSessions.prune();
      const expiredMerges = mergeSessions.prune();
      for (const session of expiredMerges) {
        for (const file of session.files) {
          await cleanupFile(file.path).catch((error: unknown) => {
            logger.warn('temp_cleanup_failed', { userId: session.userId }, error);
          });
        }
      }
      const expiredTools = toolSessions.prune();
      for (const session of expiredTools) {
        if (!session.filePath) continue;
        await cleanupFile(session.filePath).catch((error: unknown) => {
          logger.warn('temp_cleanup_failed', { userId: session.userId }, error);
        });
      }
      const prunedLimiters = uploadRateLimiter.prune();
      if (
        removedFiles > 0 ||
        expiredSessions > 0 ||
        expiredMerges.length > 0 ||
        expiredTools.length > 0 ||
        prunedLimiters > 0
      ) {
        logger.info('temp_cleanup', {
          removedFiles,
          expiredSessions,
          expiredMergeSessions: expiredMerges.length,
          expiredToolSessions: expiredTools.length,
          prunedLimiters,
        });
      }
    } catch (error) {
      logger.warn('temp_cleanup_failed', {}, error);
    }
  };

  await runMaintenance();
  const maintenanceTimer = setInterval(() => void runMaintenance(), MAINTENANCE_INTERVAL_MS);
  maintenanceTimer.unref();

  const bot = createBot({
    config,
    logger,
    fileQueue,
    uploadSessions,
    mergeSessions,
    toolSessions,
    uploadRateLimiter,
    jobRunner,
  });
  await bot.init();

  logger.info('bot_ready', {
    username: bot.botInfo.username,
    mode: config.botMode,
    requiredChannels: config.requiredChannels.length,
    maxUploadMb: config.maxUploadMb,
    maxOutputMb: config.maxOutputMb,
    maxPdfPages: config.maxPdfPages,
    mergeMaxFiles: config.mergeMaxFiles,
    mergeMaxTotalMb: config.mergeMaxTotalMb,
    rasterMaxPages: config.rasterMaxPages,
    tmpDir: config.tmpDir,
  });

  let server: Server | undefined;
  if (config.botMode === 'webhook') {
    server = startHttpServer(bot, config, logger);
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutting_down', { signal });
    clearInterval(maintenanceTimer);

    try {
      await bot.stop();
    } catch (error) {
      logger.warn('bot_stop_failed', {}, error);
    }

    const drained = await Promise.race([
      fileQueue.idle().then(() => true),
      new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), SHUTDOWN_DRAIN_MS);
        timer.unref();
      }),
    ]);
    if (!drained) {
      logger.warn('queue_drain_timeout', { pending: fileQueue.pending });
    }

    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  if (config.botMode === 'polling') {
    await bot.start({
      onStart: (info) => {
        logger.info('polling_started', { username: info.username });
      },
    });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ level: 'error', event: 'fatal_startup_error', message }));
  process.exit(1);
});
