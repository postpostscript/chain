export * from "./types/chain.ts";

import { ChainHandle } from "./chain_handle.ts";
import { Interrupt } from "./interrupt.ts";
import { AbortError } from "./signal.ts";
import type { MaybePromise } from "./types/util.ts";
import type {
  ChainAllResult,
  ChainAnyResult,
  ChainArgument,
  ChainMethod,
  ChainResolve,
  ChainState,
} from "./types/chain.ts";
import { ChainHandleOpts } from "./types/chain_handle.ts";

export class Chain<
  TReturn,
  TInitial = unknown,
  // deno-lint-ignore no-explicit-any
  TState = any,
  // deno-lint-ignore no-explicit-any
  TPrev = any,
> {
  // @ts-ignore: see typeTest, tag is necessary to cause type warnings for TInitial
  #_tag_TInitial: TInitial;

  index = 0;
  parent: Chain<TPrev, TInitial> | undefined;
  method: ChainMethod<TReturn, TPrev, TState>;

  constructor(method: ChainMethod<TReturn, TPrev>) {
    this.method = method;
  }

  then<TNextReturn, TNextState = unknown>(
    method: ChainArgument<TNextReturn, TReturn, TNextState>,
  ): Chain<TNextReturn, TInitial, TNextState, TReturn> {
    if (arguments.length === 2) {
      throw new Error(
        "Chain.prototype.then only accepts one argument (Chain instances cannot be awaited)",
      );
    }

    const child = Chain.new<TNextReturn, TReturn, TNextState>(
      method,
    ) as unknown as Chain<TNextReturn, TInitial, TNextState, TReturn>;
    child.index = this.index + 1;
    child.parent = this;
    return child;
  }

  catch<TNext, TError = unknown, TState = unknown>(
    handleError: ChainArgument<TNext, TError, TState>,
  ): Chain<TReturn | TNext, TInitial> {
    return Chain.new(
      async (previous: TInitial, state: ChainState | undefined) => {
        try {
          const value = await this.exec(
            state ?? {
              index: 0,
              value: previous,
            },
          );
          if (value instanceof Interrupt) {
            return value;
          }

          return [true, value] as const;
        } catch (e) {
          return [false, e as TError] as const;
        }
      },
    ).then(
      (result, state?: ChainState): Promise<TReturn | TNext | Interrupt> => {
        if (result[0]) {
          return Promise.resolve(result[1]);
        }

        return Chain.new(handleError).exec(
          state ?? {
            index: 0,
            value: result[1],
          },
        );
      },
    );
  }

  finally(
    // deno-lint-ignore no-explicit-any
    arg: ChainArgument<unknown, any, unknown>,
  ): Chain<TReturn, TInitial, ChainState, TReturn> {
    return this.then(async (value, state) => {
      const result = await Chain.new(arg).exec(state);
      if (result instanceof Interrupt) {
        return Interrupt.new(result, result.state);
      }
      return value;
    });
  }

  init(
    state: ChainState = {
      index: 0,
      value: undefined,
    },
    opts?: ChainHandleOpts,
  ) {
    return new ChainHandle(this, state, opts);
  }

  async exec<TThrow extends boolean = false>(
    state?: ChainState,
    opts?: {
      throwOnInterrupt?: TThrow;
      signal?: AbortSignal;
    },
  ): Promise<TThrow extends true ? TReturn : TReturn | Interrupt> {
    const handle = this.init(state || { index: 0, value: undefined }, {
      signal: opts?.signal,
    });
    const result = await handle.untilDone();
    if (result.done) {
      return result.value;
    } else {
      const interrupt = Interrupt.new(
        result.interrupt.reason,
        handle.state,
        this,
      );
      if (opts?.throwOnInterrupt) {
        throw interrupt;
      }
      return interrupt as TThrow extends true ? never : Interrupt;
    }
  }

  async execRepeatedly(
    state?: ChainState,
    {
      handleError,
      signal,
    }: {
      handleError?: (
        e: unknown,
        state: ChainState | undefined,
      ) => MaybePromise<ChainState | void>;
      signal?: AbortSignal;
    } = {},
  ): Promise<TReturn> {
    const handle = this.init(state, {
      signal,
    });
    while (true) {
      try {
        const result = await handle.advance();
        if (result.done) {
          return result.value;
        } else if (result.interrupt) {
          throw result.interrupt;
        }
        continue;
      } catch (e) {
        if (e instanceof AbortError) {
          throw e;
        } else if (handleError) {
          handle.state = (await handleError(e, handle.state)) ?? handle.state;
        } else if (e instanceof Interrupt) {
          handle.state = e.state;
        } else {
          throw e;
        }
      }
    }
  }

  static new(): Chain<void>;
  static new<TReturn, TInitial, TState>(
    value: Chain<TReturn, TInitial, TState>,
  ): Chain<TReturn, TInitial, ChainState, TInitial>;
  static new<TReturn, TInitial, TState>(
    value: () => MaybePromise<TReturn | Interrupt>,
  ): Chain<
    TReturn extends Interrupt ? never
      : TReturn,
    // deno-lint-ignore no-explicit-any
    any,
    TState,
    // deno-lint-ignore no-explicit-any
    any
  >;
  static new<TReturn, TInitial, TState>(
    value: ChainMethod<TReturn, TInitial, TState>,
  ): Chain<
    TReturn extends Interrupt ? never
      : TReturn,
    TInitial,
    TState,
    TInitial
  >;
  static new<TReturn, TInitial, TState>(
    value: ChainArgument<TReturn, TInitial, TState>,
  ): Chain<TReturn, TInitial, TState, TInitial>;
  static new<TReturn, TInitial, TState>(
    value?: ChainArgument<TReturn, TInitial, TState>,
  ):
    | Chain<TReturn | never, TInitial, TState | ChainState, TInitial>
    | Chain<void> {
    if (!value) {
      return new Chain(() => {});
    }
    const method: ChainMethod<TReturn, TInitial, TState | ChainState> =
      typeof value === "object"
        ? (((result: TInitial, state?: ChainState) => {
          return value.exec(
            state ?? {
              index: 0,
              value: result,
            },
          );
        }) as ChainMethod<TReturn, TInitial, TState | ChainState>)
        : (value as ChainMethod<TReturn, TInitial, TState | ChainState>);
    return new Chain<TReturn, TInitial, TState | ChainState, TInitial>(method);
  }

  static resolve<const T>(value: T): ChainResolve<T> {
    return (
      value instanceof Chain ? value : Chain.new(() => value)
    ) as ChainResolve<T>;
  }

  static all<
    TInitial extends unknown,
    const Chains extends Chain<unknown, TInitial>[],
  >(chains: Chains): Chain<ChainAllResult<Chains>, TInitial> {
    return Chain.new(async (initial: TInitial, state: ChainState[] = []) => {
      const results = await Promise.all(
        chains.map((subchain, i) => {
          return subchain
            .init(
              state[i] || {
                index: 0,
                value: initial,
              },
            )
            .untilDone();
        }),
      );

      let done = true;
      const values: unknown[] = [];
      const reasons: unknown[] = [];
      const states: ChainState[] = [];

      for (const result of results) {
        values.push("value" in result ? result.value : undefined);
        reasons.push(
          "interrupt" in result ? result.interrupt.reason : undefined,
        );
        states.push(result.handle.state);

        done = done && result.done;
      }

      if (!done) {
        return Interrupt.new(reasons, states);
      }

      return values as ChainAllResult<Chains>;
    });
  }

  static any<const Chains extends Chain<unknown>[]>(
    chains: Chains,
  ): Chain<ChainAnyResult<Chains>> {
    // deno-lint-ignore no-explicit-any
    return Chain.new((_: any, state: ChainState[] = []) => {
      //   console.log("cahin method running", state);
      const { promise, resolve, reject } = Promise.withResolvers<
        ChainAnyResult<Chains> | Interrupt
      >();

      (async () => {
        let resolved = false;
        let errorCount = 0;

        const results = await Promise.all(
          chains.map(async (subchain, i) => {
            try {
              const result = await subchain
                .init(
                  state[i] || {
                    index: 0,
                    value: undefined,
                  },
                )
                .untilDone();

              if (resolved) {
                return;
              } else if (!result.done) {
                return result;
              }

              resolved = true;
              resolve(result.value as ChainAnyResult<Chains>);
            } catch (error) {
              errorCount += 1;
              return {
                done: false,
                error,
              } as const;
            }
          }),
        );

        if (resolved) {
          return;
        }

        const reasons: unknown[] = [];
        const states: (ChainState | undefined)[] = [];

        for (const result of results) {
          let reason: unknown = undefined;
          let state: ChainState | undefined = undefined;
          if (result) {
            if ("interrupt" in result) {
              reason = result.interrupt?.reason;
            } else if ("error" in result) {
              reason = result.error;
            }
            if ("handle" in result) {
              state = result.handle.state;
            }
            reasons.push(reason);
            states.push(state);
          }
        }

        if (errorCount === chains.length) {
          reject(new AggregateError(reasons));
        }

        resolve(Interrupt.new(reasons, states));
      })();

      return promise;
    });
  }

  static race<const Chains extends Chain<unknown>[]>(
    chains: Chains,
  ): Chain<ChainAnyResult<Chains>> {
    const wrappedChains = chains.map((chain) =>
      chain
        .then((value) => [true, value as ChainAnyResult<Chains>] as const)
        .catch((value) => [false, value] as const)
    );
    return this.any(wrappedChains).then((pair) => {
      if (!pair[0]) {
        throw pair[1];
      }
      return pair[1];
    });
  }
}
