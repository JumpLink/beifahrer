import type { WireError } from '@beifahrer/core';

/** A refusal or failure that travels to the agent as a wire error, code and all. */
export class MethodError extends Error {
  constructor(readonly wire: WireError) {
    super(wire.message);
  }
}

export const fail = (code: WireError['code'], message: string, extra: Partial<WireError> = {}): never => {
  throw new MethodError({ code, message, ...extra });
};
