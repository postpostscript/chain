import type { Chain, ChainState } from "./chain.ts";
import { Interrupt } from "./interrupt.ts";
import { abortable } from "./signal.ts";
import type { ChainHandleOpts } from "./types/chain_handle.ts";

export class ChainHandle<TReturn> {
  readonly chain: Chain<TReturn>;
  state: ChainState;
  interrupt: Interrupt | undefined = undefined;
  readonly opts: ChainHandleOpts;

  constructor(
    chain: Chain<TReturn>,
    state: ChainState = {
      index: 0,
      value: undefined,
    },
    opts?: ChainHandleOpts,
  ) {
    this.chain = chain;
    this.state = state;
    this.opts = opts ?? {};
  }

  get done() {
    return this.state.index === this.chain.index + 1;
  }

  async advance(): Promise<
    | {
      done: true;
      value: TReturn;
      handle: ChainHandle<TReturn>;
    }
    | {
      done: false;
      interrupt: Interrupt | undefined;
      handle: ChainHandle<TReturn>;
    }
  > {
    if (this.done) {
      return {
        done: true,
        value: this.state.value as TReturn,
        handle: this,
      };
    }
    this.interrupt = undefined;
    let chain: Chain<unknown> = this.chain;
    while (this.state.index < chain.index) {
      chain = chain.parent!;
    }
    let value: unknown | Interrupt;
    try {
      value = await abortable(
        Promise.resolve(
          chain.method(this.state.value, this.state.intermediateState),
        ),
        this.opts?.signal,
      );
    } catch (err) {
      if (!(err instanceof Interrupt)) {
        throw err;
      }
      value = err;
    }
    if (value instanceof Interrupt) {
      this.interrupt = value;
      value.chain ??= chain;
      if (value.state !== undefined) {
        this.state.intermediateState = value.state;
      } else {
        delete this.state.intermediateState;
      }
      return {
        done: false,
        interrupt: Interrupt.new(value, this.state),
        handle: this,
      };
    }
    this.state.value = value;
    delete this.state.intermediateState;
    this.state.index += 1;
    if (this.done) {
      return {
        done: true,
        value: value as TReturn,
        handle: this,
      };
    } else {
      return {
        done: false,
        interrupt: undefined,
        handle: this,
      };
    }
  }

  async untilDone(): Promise<
    | {
      done: true;
      value: TReturn;
      handle: ChainHandle<TReturn>;
    }
    | {
      done: false;
      interrupt: Interrupt;
      handle: ChainHandle<TReturn>;
    }
  > {
    this.interrupt = undefined;
    while (!(this.done || this.interrupt)) {
      await this.advance();
    }
    if (this.interrupt) {
      return {
        done: false,
        interrupt: this.interrupt,
        handle: this,
      };
    }
    return {
      done: true,
      value: this.state.value as TReturn,
      handle: this,
    };
  }
}
