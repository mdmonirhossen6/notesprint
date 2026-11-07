import type { Database } from '../db/database.js';
import { transaction } from '../db/database.js';
import { nowSeconds } from '../lib/time.js';
import type { NewRequiredChannel, RequiredChannel } from './types.js';
import { normalizeChannelRef } from './validation.js';

interface ChannelRow {
  id: number;
  chat_ref: string;
  chat_id: number | null;
  title: string;
  join_url: string | null;
  is_enabled: number;
  created_at: number;
}

function toChannel(row: ChannelRow): RequiredChannel {
  return {
    id: row.id,
    chatRef: row.chat_ref,
    chatId: row.chat_id,
    title: row.title,
    joinUrl: row.join_url,
    isEnabled: row.is_enabled === 1,
    createdAt: row.created_at,
  };
}

const SELECT_COLUMNS = 'id, chat_ref, chat_id, title, join_url, is_enabled, created_at';

export function listChannels(
  db: Database,
  options: { enabledOnly?: boolean } = {},
): RequiredChannel[] {
  const where = options.enabledOnly ? 'WHERE is_enabled = 1' : '';
  const rows = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM required_channels ${where} ORDER BY id`)
    .all() as unknown as ChannelRow[];
  return rows.map(toChannel);
}

export function getChannel(db: Database, id: number): RequiredChannel | null {
  const row = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM required_channels WHERE id = ?`)
    .get(id) as ChannelRow | undefined;
  return row ? toChannel(row) : null;
}

export function findChannelByRef(db: Database, chatRef: string): RequiredChannel | null {
  const row = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM required_channels WHERE chat_ref = ?`)
    .get(normalizeChannelRef(chatRef)) as ChannelRow | undefined;
  return row ? toChannel(row) : null;
}

export function addChannel(
  db: Database,
  input: NewRequiredChannel,
  at = nowSeconds(),
): { created: boolean; channel: RequiredChannel } {
  const chatRef = normalizeChannelRef(input.chatRef);
  const existing = findChannelByRef(db, chatRef);
  if (existing) return { created: false, channel: existing };

  const result = db
    .prepare(`
      INSERT INTO required_channels (chat_ref, chat_id, title, join_url, is_enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      chatRef,
      input.chatId,
      input.title.trim(),
      input.joinUrl,
      input.isEnabled === false ? 0 : 1,
      at,
    );

  const channel = getChannel(db, Number(result.lastInsertRowid));
  if (!channel) throw new Error('Failed to read the channel that was just inserted');
  return { created: true, channel };
}

export function setChannelEnabled(db: Database, id: number, enabled: boolean): RequiredChannel | null {
  db.prepare('UPDATE required_channels SET is_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  return getChannel(db, id);
}

export function updateChannelJoinUrl(
  db: Database,
  id: number,
  joinUrl: string | null,
): RequiredChannel | null {
  db.prepare('UPDATE required_channels SET join_url = ? WHERE id = ?').run(joinUrl, id);
  return getChannel(db, id);
}

export function removeChannel(db: Database, id: number): RequiredChannel | null {
  const channel = getChannel(db, id);
  if (!channel) return null;

  transaction(db, () => {
    db.prepare('DELETE FROM membership_cache WHERE channel_ref = ?').run(channel.chatRef);
    db.prepare('DELETE FROM required_channels WHERE id = ?').run(id);
  });

  return channel;
}

export function countChannels(db: Database): { total: number; enabled: number } {
  const row = db
    .prepare(
      'SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN is_enabled = 1 THEN 1 ELSE 0 END), 0) AS enabled FROM required_channels',
    )
    .get() as { total: number; enabled: number };
  return { total: row.total, enabled: row.enabled };
}
