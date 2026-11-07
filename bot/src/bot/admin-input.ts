import type { ChannelDraft } from '../channels/types.js';
import { nowSeconds } from '../lib/time.js';

export type AdminInputPayload =
  | { kind: 'channel_add' }
  | { kind: 'channel_add_link'; draft: ChannelDraft };

export type StoredAdminInput = AdminInputPayload & { expiresAt: number };

export interface AdminInputStore {
  set(userId: number, payload: AdminInputPayload): void;
  get(userId: number): StoredAdminInput | null;
  clear(userId: number): void;
}

export function createAdminInputStore(
  ttlSeconds = 300,
  now: () => number = nowSeconds,
): AdminInputStore {
  const entries = new Map<number, StoredAdminInput>();

  return {
    set(userId, payload) {
      entries.set(userId, { ...payload, expiresAt: now() + ttlSeconds });
    },
    get(userId) {
      const entry = entries.get(userId);
      if (!entry) return null;
      if (entry.expiresAt <= now()) {
        entries.delete(userId);
        return null;
      }
      return entry;
    },
    clear(userId) {
      entries.delete(userId);
    },
  };
}
