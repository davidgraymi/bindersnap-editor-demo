import { describe, expect, it } from "bun:test";

import { createRequestGate } from "./request-gate";

/** A task that resolves only when told to, so a test can hold slots open. */
function deferred() {
  let resolve!: (value: string) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createRequestGate", () => {
  it("rejects a limit that would admit nothing", () => {
    expect(() => createRequestGate(0)).toThrow();
    expect(() => createRequestGate(-1)).toThrow();
    expect(() => createRequestGate(1.5)).toThrow();
  });

  it("runs up to the limit at once and holds the rest back", async () => {
    const gate = createRequestGate(2);
    const gates = [deferred(), deferred(), deferred(), deferred()];
    let started = 0;

    const runs = gates.map((entry) =>
      gate.run(async () => {
        started += 1;
        return entry.promise;
      }),
    );

    await tick();
    expect(started).toBe(2);
    expect(gate.inFlight).toBe(2);
    expect(gate.queued).toBe(2);

    gates[0]!.resolve("a");
    await tick();
    expect(started).toBe(3);
    expect(gate.inFlight).toBe(2);
    expect(gate.queued).toBe(1);

    for (const entry of gates) entry.resolve("done");
    await Promise.all(runs);
    expect(gate.inFlight).toBe(0);
    expect(gate.queued).toBe(0);
  });

  it("returns each task's own value to its own caller", async () => {
    const gate = createRequestGate(2);
    const results = await Promise.all(
      ["a", "b", "c", "d", "e"].map((value) =>
        gate.run(async () => {
          await tick();
          return value;
        }),
      ),
    );
    expect(results).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("frees the slot when a task throws, so the queue keeps moving", async () => {
    const gate = createRequestGate(1);

    const failure = gate.run(async () => {
      throw new Error("gitea said no");
    });
    await expect(failure).rejects.toThrow("gitea said no");

    // A rejection that stranded its slot would leave this waiting forever.
    await expect(gate.run(async () => "after")).resolves.toBe("after");
    expect(gate.inFlight).toBe(0);
  });

  it("admits waiters in the order they arrived", async () => {
    const gate = createRequestGate(1);
    const order: number[] = [];
    const runs = [1, 2, 3, 4].map((n) =>
      gate.run(async () => {
        order.push(n);
        await tick();
      }),
    );
    await Promise.all(runs);
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it("never exceeds the limit under a burst", async () => {
    const gate = createRequestGate(4);
    let running = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 50 }, () =>
        gate.run(async () => {
          running += 1;
          peak = Math.max(peak, running);
          await tick();
          running -= 1;
        }),
      ),
    );

    expect(peak).toBe(4);
    expect(gate.inFlight).toBe(0);
  });
  it("takes turns between lanes, so one request's burst does not starve another", async () => {
    const gate = createRequestGate(1);
    const order: string[] = [];
    const hold = deferred();

    // Occupy the only slot, then queue a burst in one lane before a single
    // call in another arrives.
    const first = gate.run(() => hold.promise, { lane: "library" });
    await tick();
    const runs = [
      ...["l1", "l2", "l3"].map((name) =>
        gate.run(
          async () => {
            order.push(name);
          },
          { lane: "library" },
        ),
      ),
      gate.run(
        async () => {
          order.push("detail");
        },
        { lane: "change-detail" },
      ),
    ];

    hold.resolve("done");
    await Promise.all([first, ...runs]);
    // Strict FIFO would have been l1, l2, l3, detail.
    expect(order).toEqual(["l1", "detail", "l2", "l3"]);
    expect(gate.queued).toBe(0);
  });

  it("drops a waiter whose request was abandoned", async () => {
    const gate = createRequestGate(1);
    const hold = deferred();
    const first = gate.run(() => hold.promise);
    await tick();

    const controller = new AbortController();
    let ran = false;
    const abandoned = gate.run(
      async () => {
        ran = true;
      },
      { lane: "gone", signal: controller.signal },
    );
    await tick();
    expect(gate.queued).toBe(1);

    controller.abort(new Error("the browser left"));
    await expect(abandoned).rejects.toThrow("the browser left");
    expect(gate.queued).toBe(0);

    hold.resolve("done");
    await first;
    expect(ran).toBe(false);
    expect(gate.inFlight).toBe(0);
    // And the slot it never took is still usable.
    await expect(gate.run(async () => "after")).resolves.toBe("after");
  });

  it("refuses at once a task whose signal has already aborted", async () => {
    const gate = createRequestGate(4);
    const controller = new AbortController();
    controller.abort(new Error("too late"));
    await expect(
      gate.run(async () => "never", { signal: controller.signal }),
    ).rejects.toThrow("too late");
    expect(gate.inFlight).toBe(0);
  });
});
