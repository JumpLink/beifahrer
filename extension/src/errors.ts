import type { WireError } from '@beifahrer/core';

/** A refusal or failure that travels to the agent as a wire error, code and all. */
export class MethodError extends Error {
  constructor(readonly wire: WireError) {
    super(wire.message);
  }
}

/**
 * A refusal or failure that travels to the agent as a wire error, code and all.
 *
 * The type annotation is ON THE CONST, not only on the arrow function, and that is load-bearing:
 * TypeScript treats a call as a branch only when the declaration carries an explicit type. Without it
 * `fail()` returns `never` to the reader and to no tool at all, and every line after a `fail(...)`
 * keeps reporting the value as possibly undefined — which is how a handler can be full of `fail`
 * calls and still need `!` and `as` all over it to satisfy the compiler.
 */
export const fail: (code: WireError['code'], message: string, extra?: Partial<WireError>) => never = (
  code,
  message,
  extra = {},
) => {
  throw new MethodError({ code, message, ...extra });
};
