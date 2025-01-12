import type { Chain } from "./chain.ts";

export class Interrupt<TReason = unknown, TState = unknown> {
  reason: TReason;
  state: TState | undefined;
  chain: Chain<unknown> | undefined;

  constructor(reason: TReason, state?: TState, chain?: Chain<unknown>) {
    this.reason = reason;
    this.state = state;
    this.chain = chain;
  }

  static new<TReason, TState>(
    reason: TReason,
    state?: TState,
    chain?: Chain<unknown>,
  ) {
    return new Interrupt(reason, state, chain);
  }
}
