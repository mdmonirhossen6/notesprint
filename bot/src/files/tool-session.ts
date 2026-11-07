import type { NupSettings } from '../pdf/nup.js';
import type { ToolId } from '../tools/definitions.js';

export type ToolAwaitingInput = 'ranges' | 'order' | 'group-size' | 'number-start';

export interface ToolSettings {
  mode?: 'extract' | 'every' | 'groups' | 'keep' | 'remove' | undefined;
  rangesText?: string | undefined;
  indices?: number[] | undefined;
  groupSize?: number | undefined;
  angle?: 90 | 180 | 270 | undefined;
  scope?: 'all' | 'selected' | undefined;
  quality?: 'low' | 'medium' | 'high' | undefined;
  threshold?: 'light' | 'balanced' | 'strong' | undefined;
  clearLevel?: 'low' | 'medium' | 'high' | undefined;
  nup?: NupSettings | undefined;
  awaiting?: ToolAwaitingInput | null | undefined;
}

export interface ToolSession {
  userId: number;
  chatId: number;
  tool: ToolId;
  filePath: string;
  fileName: string;
  sizeBytes: number;
  pages: number;
  uploading: boolean;
  settings: ToolSettings;
  controller: AbortController;
  createdAt: number;
  updatedAt: number;
}

export interface StartToolSessionResult {
  session: ToolSession;
  previous: ToolSession | null;
}

export interface ToolSessionStore {
  start(userId: number, chatId: number, tool: ToolId): StartToolSessionResult;
  get(userId: number): ToolSession | null;
  touch(userId: number): void;
  clear(userId: number): ToolSession | null;
  prune(): ToolSession[];
  activeCount(): number;
}

export interface ToolSessionStoreOptions {
  ttlMs: number;
  now?: () => number;
}

export function createToolSessionStore(options: ToolSessionStoreOptions): ToolSessionStore {
  const now = options.now ?? Date.now;
  const sessions = new Map<number, ToolSession>();
  const expired: ToolSession[] = [];

  const expire = (session: ToolSession): void => {
    session.controller.abort();
    expired.push(session);
  };

  const get = (userId: number): ToolSession | null => {
    const session = sessions.get(userId);
    if (!session) return null;
    if (now() - session.updatedAt <= options.ttlMs) return session;
    sessions.delete(userId);
    expire(session);
    return null;
  };

  return {
    start(userId, chatId, tool) {
      const previous = sessions.get(userId) ?? null;
      if (previous) {
        sessions.delete(userId);
        previous.controller.abort();
      }

      const timestamp = now();
      const session: ToolSession = {
        userId,
        chatId,
        tool,
        filePath: '',
        fileName: '',
        sizeBytes: 0,
        pages: 0,
        uploading: false,
        settings: {},
        controller: new AbortController(),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      sessions.set(userId, session);
      return { session, previous };
    },

    get,

    touch(userId) {
      const session = get(userId);
      if (session) session.updatedAt = now();
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
