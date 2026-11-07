export interface TaskQueueOptions {
  concurrency: number;
  onTaskError?: (error: unknown) => void;
}

export interface TaskQueue {
  enqueue(task: () => Promise<void>): void;
  readonly pending: number;
  idle(): Promise<void>;
}

export function createTaskQueue(options: TaskQueueOptions): TaskQueue {
  const concurrency = Math.max(1, Math.floor(options.concurrency));
  const tasks: Array<() => Promise<void>> = [];
  let running = 0;
  let idleWaiters: Array<() => void> = [];

  function resolveIdleIfDrained(): void {
    if (running > 0 || tasks.length > 0) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  function pump(): void {
    while (running < concurrency && tasks.length > 0) {
      const task = tasks.shift()!;
      running += 1;

      void (async () => {
        try {
          await task();
        } catch (error) {
          options.onTaskError?.(error);
        } finally {
          running -= 1;
          pump();
          resolveIdleIfDrained();
        }
      })();
    }
  }

  return {
    enqueue(task) {
      tasks.push(task);
      pump();
    },
    get pending() {
      return tasks.length + running;
    },
    idle() {
      if (running === 0 && tasks.length === 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        idleWaiters.push(resolve);
      });
    },
  };
}
