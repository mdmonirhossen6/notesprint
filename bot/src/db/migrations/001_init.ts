export const migration001 = {
  id: 1,
  name: 'initial_schema',
  sql: `
    CREATE TABLE users (
      tg_id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT NOT NULL,
      last_name TEXT,
      language_code TEXT,
      is_bot INTEGER NOT NULL DEFAULT 0,
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );
    CREATE INDEX idx_users_last_seen ON users(last_seen_at);

    CREATE TABLE admins (
      tg_id INTEGER PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin', 'moderator')),
      granted_by INTEGER,
      granted_at INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX idx_admins_role ON admins(role, is_active);

    CREATE TABLE banned_users (
      tg_id INTEGER PRIMARY KEY,
      reason TEXT,
      banned_by INTEGER,
      banned_at INTEGER NOT NULL
    );

    CREATE TABLE required_channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL UNIQUE,
      title TEXT NOT NULL,
      join_url TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE membership_cache (
      user_id INTEGER NOT NULL,
      channel_id INTEGER NOT NULL,
      is_member INTEGER NOT NULL,
      checked_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, channel_id)
    );
    CREATE INDEX idx_membership_checked ON membership_cache(checked_at);

    CREATE TABLE pending_files (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      file_id TEXT NOT NULL,
      file_unique_id TEXT,
      file_name TEXT,
      mime_type TEXT,
      size_bytes INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
      created_at INTEGER NOT NULL,
      decided_by INTEGER,
      decided_at INTEGER
    );
    CREATE INDEX idx_pending_status_created ON pending_files(status, created_at);
    CREATE INDEX idx_pending_user ON pending_files(user_id);

    CREATE TABLE approved_files (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      file_id TEXT NOT NULL,
      r2_key TEXT NOT NULL,
      file_name TEXT,
      mime_type TEXT,
      size_bytes INTEGER NOT NULL,
      approved_by INTEGER NOT NULL,
      approved_at INTEGER NOT NULL,
      retention_until INTEGER,
      deleted_at INTEGER
    );
    CREATE INDEX idx_approved_user ON approved_files(user_id);
    CREATE INDEX idx_approved_retention ON approved_files(retention_until);

    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      tool TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
      input_json TEXT NOT NULL,
      output_path TEXT,
      error_code TEXT,
      error_message TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER
    );
    CREATE INDEX idx_jobs_status_created ON jobs(status, created_at);
    CREATE INDEX idx_jobs_user ON jobs(user_id);

    CREATE TABLE promotions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      image_file_id TEXT,
      button_text TEXT NOT NULL,
      button_url TEXT NOT NULL,
      show_on_start INTEGER NOT NULL DEFAULT 1,
      show_after_process INTEGER NOT NULL DEFAULT 1,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      frequency_hours INTEGER NOT NULL DEFAULT 24,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE campaign_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      event TEXT NOT NULL CHECK (event IN ('start', 'click', 'conversion')),
      created_at INTEGER NOT NULL
    );
    CREATE INDEX idx_campaign_events_campaign ON campaign_events(campaign, event);

    CREATE TABLE admin_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      detail_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX idx_admin_logs_admin_created ON admin_logs(admin_id, created_at);

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `,
};
