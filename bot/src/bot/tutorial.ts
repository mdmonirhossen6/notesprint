export interface TutorialStore {
  seen(userId: number): boolean;
  markSeen(userId: number): void;
  prune(): number;
  size(): number;
}

export interface TutorialStoreOptions {
  ttlMs: number;
  now?: () => number;
}

export function createTutorialStore(options: TutorialStoreOptions): TutorialStore {
  const now = options.now ?? Date.now;
  const seenAt = new Map<number, number>();

  return {
    seen(userId) {
      const timestamp = seenAt.get(userId);
      if (timestamp === undefined) return false;
      if (now() - timestamp > options.ttlMs) {
        seenAt.delete(userId);
        return false;
      }
      return true;
    },
    markSeen(userId) {
      seenAt.set(userId, now());
    },
    prune() {
      const current = now();
      let removed = 0;
      for (const [userId, timestamp] of seenAt) {
        if (current - timestamp > options.ttlMs) {
          seenAt.delete(userId);
          removed += 1;
        }
      }
      return removed;
    },
    size() {
      return seenAt.size;
    },
  };
}
