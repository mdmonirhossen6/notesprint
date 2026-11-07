import type { Database } from '../db/database.js';
import { nowSeconds } from '../lib/time.js';

export interface TelegramUserLike {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string | undefined;
  username?: string | undefined;
  language_code?: string | undefined;
}

export function upsertUser(db: Database, user: TelegramUserLike, at = nowSeconds()): void {
  db.prepare(`
    INSERT INTO users (
      tg_id, username, first_name, last_name, language_code, is_bot, first_seen_at, last_seen_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tg_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      language_code = excluded.language_code,
      last_seen_at = excluded.last_seen_at
  `).run(
    user.id,
    user.username ?? null,
    user.first_name,
    user.last_name ?? null,
    user.language_code ?? null,
    user.is_bot ? 1 : 0,
    at,
    at,
  );
}

export function isBanned(db: Database, tgId: number): boolean {
  const row = db.prepare('SELECT 1 AS found FROM banned_users WHERE tg_id = ?').get(tgId);
  return row !== undefined;
}

export function countUsers(db: Database): number {
  const row = db.prepare('SELECT COUNT(*) AS total FROM users').get() as { total: number };
  return row.total;
}

export function getFirstSeenAt(db: Database, tgId: number): number | null {
  const row = db.prepare('SELECT first_seen_at FROM users WHERE tg_id = ?').get(tgId) as
    | { first_seen_at: number }
    | undefined;
  return row?.first_seen_at ?? null;
}
