import {
  assertEquals,
  assertRejects,
  assertInstanceOf,
  assertObjectMatch,
  assert,
} from "jsr:@std/assert";
import { Chain } from "./mod.ts";
import { Interrupt } from "./interrupt.ts";
import { AbortError } from "./signal.ts";

const one = Chain.resolve(1);
const two = Chain.resolve(2);
const slow = Chain.new(async () => {
  await wait(10);
  return "slow";
});
const fast = Chain.new(async () => {
  await wait(5);
  return "fast";
});
const error = Chain.new(() => {
  throw new Error();
});
const interrupt = Chain.new(() => Interrupt.new(""));

Deno.test(async function newTest() {
  assertEquals(
    await Chain.new().exec(),
    undefined,
    "empty chain resolves to undefined"
  );
  assertEquals(await Chain.new(() => 1).exec(), 1);

  await assertRejects(async () => {
    // @ts-ignore: expect error
    await Chain.new(() => Chain.resolve(1));
  }, "a chain method returning a chain errors");
});

Deno.test(async function handleTest() {
  const randomHandle = Chain.new(() => Math.random()).init();
  const initial = await randomHandle.advance();
  assertObjectMatch(initial, {
    done: true,
    handle: randomHandle,
  });

  const runAgain = await randomHandle.advance();
  assertObjectMatch(runAgain, {
    done: true,
    value: ("value" in initial ? initial.value : undefined)!,
    handle: randomHandle,
  });
});

Deno.test(async function resolveTest() {
  assertEquals(await one.exec(), 1);
  assertEquals(await Chain.resolve(one).exec(), 1, "passing a nested chain");
});

Deno.test(async function allTest() {
  assertEquals(await Chain.all([one, two]).exec(), [1, 2]);

  assertRejects(() => {
    return Chain.all([
      one,
      Chain.new(() => {
        throw new Error("test");
      }),
    ]).exec();
  }, "errors if any error");

  const interruptResult = await Chain.all([one, interrupt]).exec();
  assertInstanceOf(interruptResult, Interrupt, "interrupts if any interrupt");
  assertEquals(interruptResult.state, {
    index: 0,
    value: undefined,
    intermediateState: [
      {
        index: 1,
        value: 1,
      },
      {
        index: 0,
        value: undefined,
      },
    ],
  });
});

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.test(async function anyTest() {
  assertEquals(await Chain.any([slow, fast]).exec(), "fast", "fastest");
  await wait(5);

  assertEquals(
    await Chain.any([slow, fast, error]).exec(),
    "fast",
    "resolves when one errors"
  );
  await wait(5);

  assertEquals(
    await Chain.any([slow, fast, interrupt]).exec(),
    "fast",
    "resolves when one interrupts"
  );
  await wait(5);

  const allInterrupt = await Chain.any([interrupt, interrupt]).exec();
  assertInstanceOf(allInterrupt, Interrupt, "interrupts when all interrupt");
  assertEquals(allInterrupt.state, {
    index: 0,
    value: undefined,
    intermediateState: [
      {
        index: 0,
        value: undefined,
      },
      {
        index: 0,
        value: undefined,
      },
    ],
  });
  await wait(5);

  assertRejects(() => {
    return Chain.any([error, error]).exec();
  }, "errors when all error");
});

Deno.test(async function raceTest() {
  assertEquals(await Chain.race([slow, fast]).exec(), "fast", "fastest");
  await wait(5);

  assertRejects(() => {
    return Chain.race([slow, fast, error]).exec();
  }, "errors when one errors");
  await wait(10);

  assertEquals(
    await Chain.race([slow, fast, interrupt]).exec(),
    "fast",
    "resolves when one interrupts"
  );
  await wait(5);

  const allInterrupt = await Chain.race([interrupt, interrupt]).exec();
  assertInstanceOf(allInterrupt, Interrupt, "interrupts when all interrupt");
  assertEquals(allInterrupt.state, {
    index: 0,
    value: undefined,
    intermediateState: [
      {
        index: 0,
        value: undefined,
        intermediateState: {
          index: 0,
          value: undefined,
        },
      },
      {
        index: 0,
        value: undefined,
        intermediateState: {
          index: 0,
          value: undefined,
        },
      },
    ],
  });
  await wait(5);
});

Deno.test(async function finallyTest() {
  assertEquals(await one.finally(() => {}).exec(), 1, "value passes through");

  const result = await one.finally(interrupt).exec();
  assertInstanceOf(result, Interrupt, "interrupts when finally interrupts");
  assertEquals(result.state, {
    index: 1,
    intermediateState: {
      index: 0,
      intermediateState: {
        index: 0,
        value: undefined,
      },
      value: undefined,
    },
    value: 1,
  });

  assertRejects(async () => {
    await one.finally(error).exec();
  }, "errors when finally errors");
});

Deno.test(async function execTest() {
  assertRejects(() => {
    return interrupt.exec(undefined, {
      throwOnInterrupt: true,
    });
  }, "errors interrupts and throwOnInterrupt: true");

  let timesCalled = 0;
  const counter = Chain.new((_, state: number = 0) => {
    const next = state + 1;
    timesCalled += 1;
    if (next < 5) {
      throw Interrupt.new("counter", next);
    }
    return next;
  });

  assertEquals(await counter.execRepeatedly(), 5, "reruns after interrupts");
  assertEquals(timesCalled, 5, "counter chain method is called 5 times");

  assertRejects(() => {
    return error.execRepeatedly();
  }, "errors when chain errors");

  const errorResult = await one
    .then(error)
    .execRepeatedly(undefined, {
      handleError(error, state) {
        throw {
          message: "handleError called",
          error,
          state,
        };
      },
    })
    .catch((e) => e);
  assertObjectMatch(errorResult, {
    message: "handleError called",
    state: {
      index: 1,
      value: 1,
    },
  });

  const skipResult = await interrupt.then(one).execRepeatedly(undefined, {
    handleError(error) {
      if (error instanceof Interrupt) {
        return {
          index: (error?.state.index ?? 0) + 1,
          value: undefined,
        };
      }
      throw error;
    },
  });
  assertEquals(skipResult, 1);

  let value = 0;
  const pureRetryResult = await Chain.new(() => {
    if (value < 1) {
      value += 1;
      throw Interrupt.new("keep going");
    }
    return value;
  }).execRepeatedly(undefined, {
    handleError() {
      return;
    },
  });
  assertEquals(pureRetryResult, 1);
});

Deno.test(async function signalTest() {
  const abortImmediate = new AbortController();
  abortImmediate.abort();
  const abortImmediateResult = await one
    .exec(undefined, {
      signal: abortImmediate.signal,
    })
    .catch((e) => e);
  assertInstanceOf(
    abortImmediateResult,
    AbortError,
    "errors when already aborted"
  );

  const abortFast = new AbortController();
  setTimeout(() => abortFast.abort(), 5);
  const abortFastResult = await slow
    .execRepeatedly(undefined, {
      signal: abortFast.signal,
    })
    .catch((e) => e);
  assertInstanceOf(
    abortFastResult,
    AbortError,
    "errors when aborts after started but before chain resolves"
  );
  await wait(5);

  const abortSlow = new AbortController();
  setTimeout(() => abortSlow.abort(), 10);
  const abortSlowResult = await fast
    .execRepeatedly(undefined, {
      signal: abortSlow.signal,
    })
    .catch((e) => e);
  assertEquals(
    abortSlowResult,
    "fast",
    "succeeds when aborts after chain resolves"
  );
  await wait(5);
});
