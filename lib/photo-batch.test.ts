import { describe, expect, it } from "vitest";
import { PHOTO_UPLOAD_CONCURRENCY, mapWithConcurrency, orderedCommitter, takeSlots } from "./photo-batch";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("mapWithConcurrency", () => {
  it("never runs more than `limit` at once and starts the rest as slots free up", async () => {
    const gates = Array.from({ length: 5 }, () => deferred<number>());
    let running = 0;
    let peak = 0;
    const started: number[] = [];
    const run = mapWithConcurrency(gates, PHOTO_UPLOAD_CONCURRENCY, async (gate, i) => {
      started.push(i);
      running++;
      peak = Math.max(peak, running);
      try { return await gate.promise; } finally { running--; }
    });
    await tick();
    expect(started).toEqual([0, 1]);
    gates[1]!.resolve(1);
    await tick();
    expect(started).toEqual([0, 1, 2]);
    gates[0]!.resolve(0);
    gates[2]!.resolve(2);
    gates[3]!.resolve(3);
    gates[4]!.resolve(4);
    await run;
    expect(peak).toBe(2);
    expect(PHOTO_UPLOAD_CONCURRENCY).toBe(2);
  });

  it("keeps results in selection order even when they finish out of order", async () => {
    const delays = [30, 5, 15, 0];
    const results = await mapWithConcurrency(delays, 2, (ms, i) => new Promise<string>((resolve) => setTimeout(() => resolve(`foto-${i}`), ms)));
    expect(results).toEqual([0, 1, 2, 3].map((i) => ({ ok: true, value: `foto-${i}` })));
  });

  it("reports a failure per item without losing the others", async () => {
    const seen: number[] = [];
    const results = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("La foto pesa demasiado");
      return n * 10;
    }, (_, index) => seen.push(index));
    expect(results[0]).toEqual({ ok: true, value: 10 });
    expect(results[1]).toMatchObject({ ok: false });
    expect((results[1] as { error: Error }).error.message).toBe("La foto pesa demasiado");
    expect(results[2]).toEqual({ ok: true, value: 30 });
    expect(seen.sort()).toEqual([0, 1, 2]);
  });

  it("handles empty lists and silly limits", async () => {
    expect(await mapWithConcurrency([], 2, async () => 1)).toEqual([]);
    expect(await mapWithConcurrency([1, 2], 0, async (n) => n)).toEqual([{ ok: true, value: 1 }, { ok: true, value: 2 }]);
  });
});

describe("takeSlots", () => {
  it("takes only what fits in the row, in selection order", () => {
    expect(takeSlots(["a", "b", "c"], 10, 12)).toEqual({ take: ["a", "b"], skipped: 1 });
    expect(takeSlots(["a", "b"], 0, 4)).toEqual({ take: ["a", "b"], skipped: 0 });
  });

  it("takes nothing when the row is full (or over the limit)", () => {
    expect(takeSlots(["a"], 4, 4)).toEqual({ take: [], skipped: 1 });
    expect(takeSlots(["a"], 7, 4)).toEqual({ take: [], skipped: 1 });
  });
});

describe("orderedCommitter", () => {
  it("only commits a prefix once every earlier photo has finished", () => {
    const commits: Array<{ values: string[]; from: number }> = [];
    const settle = orderedCommitter<string>(4, (values, from) => commits.push({ values, from }));
    settle(1, "b");
    expect(commits).toEqual([]);
    settle(0, "a");
    expect(commits).toEqual([{ values: ["a", "b"], from: 0 }]);
    settle(3, "d");
    settle(3, "again");
    expect(commits).toHaveLength(1);
    settle(2, "c");
    expect(commits[1]).toEqual({ values: ["c", "d"], from: 2 });
  });
});
