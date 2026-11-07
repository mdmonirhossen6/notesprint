export interface JobRunner {
  tryStart(userId: number): AbortController | null;
  finish(userId: number): void;
  cancel(userId: number): boolean;
  isActive(userId: number): boolean;
  activeCount(): number;
}

export function createJobRunner(): JobRunner {
  const active = new Map<number, AbortController>();

  return {
    tryStart(userId) {
      if (active.has(userId)) return null;
      const controller = new AbortController();
      active.set(userId, controller);
      return controller;
    },
    finish(userId) {
      active.delete(userId);
    },
    cancel(userId) {
      const controller = active.get(userId);
      if (!controller) return false;
      controller.abort();
      return true;
    },
    isActive(userId) {
      return active.has(userId);
    },
    activeCount() {
      return active.size;
    },
  };
}
