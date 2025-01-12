import type { Interrupt } from "../interrupt.ts";
import type { MaybePromise } from "./util.ts";
import type { Chain } from "../chain.ts";

export type ChainState = {
  index: number;
  value: unknown;
  intermediateState?: unknown;
};

// deno-lint-ignore no-explicit-any
export type ChainMethod<TReturn, TPrev, TState = any> = (
  result: TPrev,
  state?: TState,
) => MaybePromise<TReturn | Interrupt>;

export type ChainArgument<TReturn, TPrev, TState> =
  | ChainMethod<TReturn, TPrev, TState>
  | Chain<TReturn, TPrev, TState>;

export type ChainResolve<T> = T extends Chain<unknown> ? T : Chain<Awaited<T>>;

export type ChainResult<T> = T extends Chain<infer TReturn> ? TReturn : never;

export type ChainInitial<T extends Chain<unknown>> = T extends Chain<
  unknown,
  infer TInitial
> ? TInitial
  : never;

export type ChainCatch<TChain extends Chain<unknown>, TError = unknown> = Chain<
  ChainResult<TChain> | TError,
  ChainInitial<TChain>
>;

/** @ignore */
export type ChainCatchArray<
  TChains extends Chain<unknown>[],
  TError = Error,
  TResult extends Chain<unknown>[] = [],
> = TChains extends [
  infer First extends Chain<unknown>,
  ...infer Rest extends Chain<unknown>[],
] ? ChainCatchArray<Rest, TError, [...TResult, ChainCatch<First>]>
  : TResult;

/** @ignore */
export type ChainAllResult<
  TList extends Chain<unknown>[],
  TReturn extends unknown[] = [],
> = TList extends Chain<infer TValue>[] ? TList extends [
    infer Item extends Chain<unknown>,
    ...infer Rest extends Chain<unknown>[],
  ] ? ChainAllResult<Rest, [...TReturn, ChainResult<Item>]>
  : TList extends [] ? TReturn
  : TValue[]
  : never;

/** @ignore */
export type ChainAnyResult<TList extends Chain<unknown>[]> =
  ChainAllResult<TList> extends infer T extends unknown[] ? T[number] : never;
