import type { MaybePromise } from "./types/util.ts";

export function abortable<T>(promise: MaybePromise<T>, signal?: AbortSignal) {
  if (signal?.aborted) {
    return Promise.reject(
      new AbortError("signal aborted", {
        cause: signal,
      }),
    );
  }

  const _promise = Promise.resolve(promise);

  if (!signal) {
    return _promise;
  }

  const { resolve, reject, promise: result } = Promise.withResolvers<T>();

  const handler = () => {
    cleanup();
    reject(
      new AbortError("signal aborted", {
        cause: signal,
      }),
    );
  };

  function cleanup() {
    signal!.removeEventListener("abort", handler);
  }

  signal.addEventListener("abort", handler);
  _promise.then(resolve).finally(cleanup);

  return result;
}

export class AbortError extends Error {}
