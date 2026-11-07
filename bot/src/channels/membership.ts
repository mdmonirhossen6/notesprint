import type { Database } from '../db/database.js';
import { nowSeconds } from '../lib/time.js';
import { listChannels } from './repository.js';
import type { RequiredChannel } from './types.js';

export interface ChatMemberInfo {
  status: string;
  is_member?: boolean | undefined;
}

export interface MembershipClient {
  getChatMember(chatRef: string, userId: number): Promise<ChatMemberInfo>;
}

export interface ChannelMembership {
  channel: RequiredChannel;
  isMember: boolean;
  cached: boolean;
  unavailable: boolean;
}

export interface MembershipSummary {
  adminBypass: boolean;
  channels: ChannelMembership[];
  missing: ChannelMembership[];
  allJoined: boolean;
  hasUnavailable: boolean;
}

export interface MembershipCheckOptions {
  force?: boolean;
}

export interface MembershipService {
  check(userId: number, options?: MembershipCheckOptions): Promise<MembershipSummary>;
  invalidate(userId?: number): void;
}

export interface MembershipServiceOptions {
  db: Database;
  client: MembershipClient;
  ttlSeconds: number;
  isAdmin: (userId: number) => boolean;
  now?: () => number;
}

const JOINED_STATUSES = new Set(['creator', 'administrator', 'member']);
const NOT_JOINED_STATUSES = new Set(['left', 'kicked']);

function isMemberStatus(info: ChatMemberInfo): boolean {
  if (JOINED_STATUSES.has(info.status)) return true;
  if (info.status === 'restricted') return info.is_member === true;
  return false;
}

function isKnownStatus(status: string): boolean {
  return JOINED_STATUSES.has(status) || NOT_JOINED_STATUSES.has(status) || status === 'restricted';
}

function readCache(
  db: Database,
  userId: number,
  channelRef: string,
): { isMember: boolean; checkedAt: number } | null {
  const row = db
    .prepare(
      'SELECT is_member, checked_at FROM membership_cache WHERE user_id = ? AND channel_ref = ?',
    )
    .get(userId, channelRef) as { is_member: number; checked_at: number } | undefined;

  return row ? { isMember: row.is_member === 1, checkedAt: row.checked_at } : null;
}

function writeCache(
  db: Database,
  userId: number,
  channelRef: string,
  isMember: boolean,
  checkedAt: number,
): void {
  db.prepare(`
    INSERT INTO membership_cache (user_id, channel_ref, is_member, checked_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, channel_ref) DO UPDATE SET
      is_member = excluded.is_member,
      checked_at = excluded.checked_at
  `).run(userId, channelRef, isMember ? 1 : 0, checkedAt);
}

export function pruneMembershipCache(
  db: Database,
  maxAgeSeconds: number,
  at = nowSeconds(),
): number {
  const result = db
    .prepare('DELETE FROM membership_cache WHERE checked_at < ?')
    .run(at - maxAgeSeconds);
  return Number(result.changes);
}

export function createMembershipService(options: MembershipServiceOptions): MembershipService {
  const { db, client, ttlSeconds, isAdmin, now = nowSeconds } = options;

  async function check(
    userId: number,
    checkOptions: MembershipCheckOptions = {},
  ): Promise<MembershipSummary> {
    if (isAdmin(userId)) {
      return {
        adminBypass: true,
        channels: [],
        missing: [],
        allJoined: true,
        hasUnavailable: false,
      };
    }

    const channels = listChannels(db, { enabledOnly: true });
    const results: ChannelMembership[] = [];

    for (const channel of channels) {
      const cached = checkOptions.force ? null : readCache(db, userId, channel.chatRef);
      const checkedAt = now();

      if (cached && checkedAt >= cached.checkedAt && checkedAt - cached.checkedAt < ttlSeconds) {
        results.push({
          channel,
          isMember: cached.isMember,
          cached: true,
          unavailable: false,
        });
        continue;
      }

      try {
        const info = await client.getChatMember(channel.chatRef, userId);
        if (!isKnownStatus(info.status)) {
          throw new Error(`Unexpected chat member status: ${info.status}`);
        }

        const isMember = isMemberStatus(info);
        writeCache(db, userId, channel.chatRef, isMember, checkedAt);
        results.push({ channel, isMember, cached: false, unavailable: false });
      } catch {
        results.push({ channel, isMember: false, cached: false, unavailable: true });
      }
    }

    const missing = results.filter((entry) => !entry.isMember);
    return {
      adminBypass: false,
      channels: results,
      missing,
      allJoined: missing.length === 0,
      hasUnavailable: results.some((entry) => entry.unavailable),
    };
  }

  function invalidate(userId?: number): void {
    if (userId === undefined) {
      db.prepare('DELETE FROM membership_cache').run();
      return;
    }
    db.prepare('DELETE FROM membership_cache WHERE user_id = ?').run(userId);
  }

  return { check, invalidate };
}
