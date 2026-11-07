export interface MergeFileEntry {
  seq: number;
  path: string;
  name: string;
  sizeBytes: number;
  pages: number;
}

export interface MergeSession {
  userId: number;
  chatId: number;
  files: MergeFileEntry[];
  pending: number;
  controller: AbortController;
  createdAt: number;
  updatedAt: number;
}

export interface MergeSessionStore {
  start(userId: number, chatId: number): MergeSession;
  get(userId: number): MergeSession | null;
  reserve(userId: number): boolean;
  commit(
    userId: number,
    seq: number,
    file: Omit<MergeFileEntry, 'seq'>,
  ): MergeSession | null;
  fail(userId: number): void;
  remove(userId: number, seq: number): MergeFileEntry | null;
  clear(userId: number): MergeSession | null;
  prune(): MergeSession[];
  activeCount(): number;
}

export interface MergeSessionStoreOptions {
  ttlMs: number;
  now?: () => number;
}

export function createMergeSessionStore(
  options: MergeSessionStoreOptions,
): MergeSessionStore {
  const now = options.now ?? Date.now;
  const sessions = new Map<number, MergeSession>();
  const expired: MergeSession[] = [];

  const expire = (session: MergeSession): void => {
    session.controller.abort();
    expired.push(session);
  };

  const get = (userId: number): MergeSession | null => {
    const session = sessions.get(userId);
    if (!session) return null;
    if (now() - session.updatedAt <= options.ttlMs) return session;
    sessions.delete(userId);
    expire(session);
    return null;
  };

  return {
    start(userId, chatId) {
      const existing = get(userId);
      if (existing) return existing;

      const timestamp = now();
      const session: MergeSession = {
        userId,
        chatId,
        files: [],
        pending: 0,
        controller: new AbortController(),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      sessions.set(userId, session);
      return session;
    },

    get,

    reserve(userId) {
      const session = get(userId);
      if (!session) return false;
      session.pending += 1;
      session.updatedAt = now();
      return true;
    },

    commit(userId, seq, file) {
      const session = get(userId);
      if (!session) return null;

      session.pending = Math.max(0, session.pending - 1);
      const entry: MergeFileEntry = { ...file, seq };
      const index = session.files.findIndex((existing) => existing.seq > seq);
      if (index === -1) {
        session.files.push(entry);
      } else {
        session.files.splice(index, 0, entry);
      }
      session.updatedAt = now();
      return session;
    },

    fail(userId) {
      const session = get(userId);
      if (!session) return;
      session.pending = Math.max(0, session.pending - 1);
      session.updatedAt = now();
    },

    remove(userId, seq) {
      const session = get(userId);
      if (!session) return null;
      const index = session.files.findIndex((entry) => entry.seq === seq);
      if (index === -1) return null;
      const [entry] = session.files.splice(index, 1);
      session.updatedAt = now();
      return entry ?? null;
    },

    clear(userId) {
      const session = sessions.get(userId);
      if (!session) return null;
      sessions.delete(userId);
      session.controller.abort();
      return session;
    },

    prune() {
      const removed = expired.splice(0, expired.length);

      for (const [userId, session] of sessions) {
        if (now() - session.updatedAt <= options.ttlMs) continue;
        sessions.delete(userId);
        session.controller.abort();
        removed.push(session);
      }

      return removed;
    },

    activeCount() {
      return sessions.size;
    },
  };
}
