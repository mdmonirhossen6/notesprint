export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  now?: () => number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  tryAcquire(userId: number): RateLimitDecision;
  reset(userId?: number): void;
  size(): number;
  prune(): number;
}

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const limit = Math.max(1, Math.floor(options.limit));
  const windowMs = Math.max(1, Math.floor(options.windowMs));
  const now = options.now ?? Date.now;
  const hits = new Map<number, number[]>();

  function activeHits(userId: number, currentTime: number): number[] {
    const entries = hits.get(userId);
    if (!entries) return [];

    const cutoff = currentTime - windowMs;
    let expired = 0;
    while (expired < entries.length && entries[expired]! <= cutoff) expired += 1;
    if (expired > 0) entries.splice(0, expired);
    if (entries.length === 0) hits.delete(userId);

    return entries;
  }

  return {
    tryAcquire(userId) {
      const currentTime = now();
      const entries = activeHits(userId, currentTime);

      if (entries.length >= limit) {
        const retryAfterMs = entries[0]! + windowMs - currentTime;
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
        };
      }

      entries.push(currentTime);
      hits.set(userId, entries);

      return {
        allowed: true,
        remaining: limit - entries.length,
        retryAfterSeconds: 0,
      };
    },
    reset(userId) {
      if (userId === undefined) hits.clear();
      else hits.delete(userId);
    },
    size() {
      return hits.size;
    },
    prune() {
      const currentTime = now();
      let removed = 0;
      for (const [userId, entries] of hits) {
        let expired = 0;
        while (expired < entries.length && entries[expired]! <= currentTime - windowMs) {
          expired += 1;
        }
        if (expired > 0) entries.splice(0, expired);
        if (entries.length === 0) {
          hits.delete(userId);
          removed += 1;
        }
      }
      return removed;
    },
  };
}
