import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { MembershipService } from '../channels/membership.js';
import type { TaskQueue } from '../files/queue.js';
import type { RateLimiter } from '../files/rate-limit.js';
import type { UploadSessionStore } from '../files/upload-session.js';
import type { JobRunner } from '../jobs/runner.js';

export interface BotDeps {
  config: AppConfig;
  logger: Logger;
  membership: MembershipService;
  fileQueue: TaskQueue;
  uploadSessions: UploadSessionStore;
  uploadRateLimiter: RateLimiter;
  jobRunner: JobRunner;
}
