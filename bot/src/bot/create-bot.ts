import { Bot } from 'grammy';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { isSuperAdmin } from '../auth/access.js';
import { createStaticMembershipService } from '../channels/static-membership.js';
import type { TaskQueue } from '../files/queue.js';
import type { RateLimiter } from '../files/rate-limit.js';
import type { UploadSessionStore } from '../files/upload-session.js';
import type { JobRunner } from '../jobs/runner.js';
import type { BotDeps } from './types.js';
import { attachErrorHandler } from './ui.js';
import { registerUserHandlers } from './handlers/user.js';
import { registerUploadHandlers } from './handlers/upload.js';
import { registerAdminHandlers } from './handlers/admin.js';

export interface BotDependencies {
  config: AppConfig;
  logger: Logger;
  fileQueue: TaskQueue;
  uploadSessions: UploadSessionStore;
  uploadRateLimiter: RateLimiter;
  jobRunner: JobRunner;
}

export function createBot(dependencies: BotDependencies): Bot {
  const { config, logger, fileQueue, uploadSessions, uploadRateLimiter, jobRunner } = dependencies;

  const bot = new Bot(config.botToken, {
    client: { apiRoot: config.botApiRoot },
  });

  const membership = createStaticMembershipService({
    channels: config.requiredChannels,
    ttlSeconds: config.membershipCacheTtlSeconds,
    isAdmin: (userId) => isSuperAdmin(userId, config.superAdminId),
    client: {
      getChatMember: async (chatRef, userId) => {
        const info = await bot.api.getChatMember(chatRef, userId);
        return {
          status: info.status,
          is_member: 'is_member' in info ? info.is_member : undefined,
        };
      },
    },
  });

  const deps: BotDeps = {
    config,
    logger,
    membership,
    fileQueue,
    uploadSessions,
    uploadRateLimiter,
    jobRunner,
  };

  registerUserHandlers(bot, deps);
  registerUploadHandlers(bot, deps);
  registerAdminHandlers(bot, deps);

  attachErrorHandler(bot, logger);

  return bot;
}
