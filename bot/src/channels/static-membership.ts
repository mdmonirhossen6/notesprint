import type { RequiredChannel } from './types.js';
import type {
  ChannelMembership,
  ChatMemberInfo,
  MembershipCheckOptions,
  MembershipClient,
  MembershipService,
  MembershipSummary,
} from './membership.js';

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

interface CacheEntry {
  isMember: boolean;
  checkedAt: number;
}

export interface StaticMembershipOptions {
  channels: readonly RequiredChannel[];
  client: MembershipClient;
  ttlSeconds: number;
  isAdmin: (userId: number) => boolean;
  now?: () => number;
}

export interface StaticMembershipService extends MembershipService {
  prune(): number;
}

export function createStaticMembershipService(
  options: StaticMembershipOptions,
): StaticMembershipService {
  const { channels, client, ttlSeconds, isAdmin, now = Date.now } = options;
  const cache = new Map<string, CacheEntry>();

  function cacheKey(userId: number, chatRef: string): string {
    return `${userId}:${chatRef}`;
  }

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

    const results: ChannelMembership[] = [];
    const currentTime = now();

    for (const channel of channels) {
      const key = cacheKey(userId, channel.chatRef);
      const cached = checkOptions.force ? null : cache.get(key);

      if (cached && currentTime >= cached.checkedAt && currentTime - cached.checkedAt < ttlSeconds) {
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
        cache.set(key, { isMember, checkedAt: now() });
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
      cache.clear();
      return;
    }
    for (const key of cache.keys()) {
      if (key.startsWith(`${userId}:`)) cache.delete(key);
    }
  }

  function prune(): number {
    const currentTime = now();
    let removed = 0;
    for (const [key, entry] of cache) {
      if (currentTime - entry.checkedAt >= ttlSeconds) {
        cache.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  return { check, invalidate, prune };
}
