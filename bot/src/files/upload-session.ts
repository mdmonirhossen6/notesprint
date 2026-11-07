export interface UploadSessionStoreOptions {
  ttlMs: number;
  now?: () => number;
}

export interface UploadSessionStore {
  start(userId: number): void;
  isActive(userId: number): boolean;
  take(userId: number): boolean;
  clear(userId: number): void;
  size(): number;
  prune(): number;
}

interface Session {
  expiresAt: number;
}

export function createUploadSessionStore(options: UploadSessionStoreOptions): UploadSessionStore {
  const ttlMs = Math.max(1, Math.floor(options.ttlMs));
  const now = options.now ?? Date.now;
  const sessions = new Map<number, Session>();

  function isExpired(session: Session, currentTime: number): boolean {
    return session.expiresAt <= currentTime;
  }

  return {
    start(userId) {
      sessions.set(userId, { expiresAt: now() + ttlMs });
    },
    isActive(userId) {
      const session = sessions.get(userId);
      if (!session) return false;
      if (isExpired(session, now())) {
        sessions.delete(userId);
        return false;
      }
      return true;
    },
    take(userId) {
      const session = sessions.get(userId);
      if (!session) return false;
      sessions.delete(userId);
      return !isExpired(session, now());
    },
    clear(userId) {
      sessions.delete(userId);
    },
    size() {
      return sessions.size;
    },
    prune() {
      const currentTime = now();
      let removed = 0;
      for (const [userId, session] of sessions) {
        if (isExpired(session, currentTime)) {
          sessions.delete(userId);
          removed += 1;
        }
      }
      return removed;
    },
  };
}
