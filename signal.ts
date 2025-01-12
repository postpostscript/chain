import { MaybePromise } from "./types/util.ts";

export function abortable<T>(promise: MaybePromise<T>, signal?: AbortSignal) {
  const _promise = Promise.resolve(promise);

  if (!signal) {
    return _promise;
  }

  let resolved = false;

  const { resolve, reject, promise: result } = Promise.withResolvers<T>();

  const handler = () => {
    cleanup();
    if (resolved) {
      return;
    }
    reject(
      new AbortError("signal aborted", {
        cause: signal,
      })
    );
  };

  function cleanup() {
    resolved = true;
    signal!.removeEventListener("abort", handler);
  }

  signal.addEventListener("abort", handler);
  _promise.then(resolve).finally(cleanup);

  return result;
}

export class AbortError extends Error {}
