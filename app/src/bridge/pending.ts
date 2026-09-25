/**
 * Calls that went out over a socket and wait for their answer. No sockets in here: the bridge
 * (towards an extension) and the hub client (towards the hub) both keep one table per socket.
 *
 * Every entry ends exactly once: answered, timed out, or rejected because its socket is gone.
 * Nothing waits forever — a call whose socket dies must fail at once with a reason, not hang
 * until the agent gives up.
 */

interface Waiting {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class PendingCalls {
  #next = 1;
  #waiting = new Map<number, Waiting>();

  /** Register a call. `onTimeout` builds the error it fails with when no answer comes in time. */
  open<T>(timeoutMs: number, onTimeout: () => Error): { id: number; promise: Promise<T> } {
    const id = this.#next++;
    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiting.delete(id);
        reject(onTimeout());
      }, timeoutMs);
      this.#waiting.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
    });
    return { id, promise };
  }

  /** Deliver an answer. False for an id nobody waits for (late, duplicate, or made up). */
  resolve(id: number, value: unknown): boolean {
    const waiting = this.#take(id);
    waiting?.resolve(value);
    return waiting !== undefined;
  }

  reject(id: number, error: Error): boolean {
    const waiting = this.#take(id);
    waiting?.reject(error);
    return waiting !== undefined;
  }

  /** The socket is gone: fail everything still waiting on it. */
  rejectAll(error: () => Error): void {
    // Deleting the current entry while iterating a Map is well-defined in JS.
    for (const id of this.#waiting.keys()) this.reject(id, error());
  }

  get size(): number {
    return this.#waiting.size;
  }

  #take(id: number): Waiting | undefined {
    const waiting = this.#waiting.get(id);
    if (!waiting) return undefined;
    this.#waiting.delete(id);
    clearTimeout(waiting.timer);
    return waiting;
  }
}
