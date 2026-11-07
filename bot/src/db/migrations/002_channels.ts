export const migration002 = {
  id: 2,
  name: 'channel_refs',
  sql: `
    ALTER TABLE required_channels RENAME TO required_channels_old;

    CREATE TABLE required_channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_ref TEXT NOT NULL UNIQUE,
      chat_id INTEGER,
      title TEXT NOT NULL,
      join_url TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX idx_required_channels_enabled ON required_channels(is_enabled);

    INSERT INTO required_channels (id, chat_ref, chat_id, title, join_url, is_enabled, created_at)
    SELECT id, CAST(chat_id AS TEXT), chat_id, title, join_url, is_enabled, created_at
    FROM required_channels_old;

    DROP TABLE required_channels_old;

    DROP INDEX IF EXISTS idx_membership_checked;
    ALTER TABLE membership_cache RENAME TO membership_cache_old;

    CREATE TABLE membership_cache (
      user_id INTEGER NOT NULL,
      channel_ref TEXT NOT NULL,
      is_member INTEGER NOT NULL,
      checked_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, channel_ref)
    );
    CREATE INDEX idx_membership_checked ON membership_cache(checked_at);

    INSERT INTO membership_cache (user_id, channel_ref, is_member, checked_at)
    SELECT cache.user_id, channel.chat_ref, cache.is_member, cache.checked_at
    FROM membership_cache_old AS cache
    JOIN required_channels AS channel ON channel.chat_id = cache.channel_id;

    DROP TABLE membership_cache_old;
  `,
};
