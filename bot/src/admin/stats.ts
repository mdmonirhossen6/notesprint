import type { Database } from '../db/database.js';

export interface AdminStats {
  users: number;
  admins: number;
  banned: number;
  pendingFiles: number;
  approvedFiles: number;
  queuedJobs: number;
  failedJobs: number;
  channels: number;
  enabledChannels: number;
}

function count(db: Database, sql: string): number {
  const row = db.prepare(sql).get() as { total: number };
  return row.total;
}

export function getAdminStats(db: Database): AdminStats {
  return {
    users: count(db, 'SELECT COUNT(*) AS total FROM users'),
    admins: count(db, 'SELECT COUNT(*) AS total FROM admins WHERE is_active = 1'),
    banned: count(db, 'SELECT COUNT(*) AS total FROM banned_users'),
    pendingFiles: count(db, "SELECT COUNT(*) AS total FROM pending_files WHERE status = 'pending'"),
    approvedFiles: count(db, 'SELECT COUNT(*) AS total FROM approved_files WHERE deleted_at IS NULL'),
    queuedJobs: count(db, "SELECT COUNT(*) AS total FROM jobs WHERE status = 'queued'"),
    failedJobs: count(db, "SELECT COUNT(*) AS total FROM jobs WHERE status = 'failed'"),
    channels: count(db, 'SELECT COUNT(*) AS total FROM required_channels'),
    enabledChannels: count(
      db,
      'SELECT COUNT(*) AS total FROM required_channels WHERE is_enabled = 1',
    ),
  };
}
