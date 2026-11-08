import { setImmediate } from 'node:timers/promises';

/**
 * Yields to the event loop so HTTP requests (health checks in particular) are
 * served between chunks of CPU-bound PDF work.
 */
export function yieldToEventLoop(): Promise<void> {
  return setImmediate();
}
