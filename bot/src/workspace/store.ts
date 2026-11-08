import { randomBytes } from 'node:crypto';
import type { Workspace } from './types.js';

export interface StartWorkspaceResult {
  workspace: Workspace;
  previous: Workspace | null;
}

export interface WorkspaceStore {
  start(userId: number, chatId: number): StartWorkspaceResult;
  get(userId: number): Workspace | null;
  touch(userId: number): void;
  clear(userId: number): Workspace | null;
  prune(): Workspace[];
  expiringSoon(thresholdMs: number): Workspace[];
  activeCount(): number;
}

export interface WorkspaceStoreOptions {
  ttlMs: number;
  now?: () => number;
  createId?: () => string;
}

export function createWorkspaceStore(options: WorkspaceStoreOptions): WorkspaceStore {
  const now = options.now ?? Date.now;
  const createId = options.createId ?? (() => randomBytes(8).toString('hex'));
  const workspaces = new Map<number, Workspace>();

  const get = (userId: number): Workspace | null => {
    const workspace = workspaces.get(userId);
    if (!workspace) return null;
    if (now() - workspace.updatedAt <= options.ttlMs) return workspace;
    workspaces.delete(userId);
    workspace.controller.abort();
    return null;
  };

  return {
    start(userId, chatId) {
      const previous = workspaces.get(userId) ?? null;
      if (previous) {
        workspaces.delete(userId);
        previous.controller.abort();
      }

      const timestamp = now();
      const workspace: Workspace = {
        id: createId(),
        userId,
        chatId,
        files: [],
        mode: 'combine',
        operations: [],
        status: 'collecting',
        awaitingUpload: true,
        replacingFileId: null,
        awaitingText: null,
        uploading: false,
        controller: new AbortController(),
        createdAt: timestamp,
        updatedAt: timestamp,
        uploadStartedAt: null,
        processingStartedAt: null,
        processingCompletedAt: null,
        lastError: null,
        cancelRequested: false,
        expiryNotified: false,
        nextFileSeq: 1,
        nextOpSeq: 1,
      };
      workspaces.set(userId, workspace);
      return { workspace, previous };
    },

    get,

    touch(userId) {
      const workspace = get(userId);
      if (!workspace) return;
      workspace.updatedAt = now();
      workspace.expiryNotified = false;
    },

    clear(userId) {
      const workspace = workspaces.get(userId);
      if (!workspace) return null;
      workspaces.delete(userId);
      workspace.controller.abort();
      return workspace;
    },

    prune() {
      const current = now();
      const removed: Workspace[] = [];
      for (const [userId, workspace] of workspaces) {
        if (current - workspace.updatedAt <= options.ttlMs) continue;
        workspaces.delete(userId);
        workspace.controller.abort();
        removed.push(workspace);
      }
      return removed;
    },

    expiringSoon(thresholdMs) {
      const current = now();
      const expiring: Workspace[] = [];
      for (const workspace of workspaces.values()) {
        if (workspace.expiryNotified) continue;
        if (workspace.status === 'processing') continue;
        const remaining = options.ttlMs - (current - workspace.updatedAt);
        if (remaining > 0 && remaining <= thresholdMs) {
          workspace.expiryNotified = true;
          expiring.push(workspace);
        }
      }
      return expiring;
    },

    activeCount() {
      return workspaces.size;
    },
  };
}
