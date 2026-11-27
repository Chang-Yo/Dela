import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let budget: typeof import('../budget');

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  budget = await import('../budget');
});

afterEach(() => vi.useRealTimers());

async function settles(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let done = false;
  void promise.then(() => (done = true));
  await vi.advanceTimersByTimeAsync(ms);
  return done;
}

it('leaves half of the per-minute key budget to foreground requests', async () => {
  for (let i = 0; i < 10; i++) await budget.waitForShuiyuanBackgroundSlot();
  const eleventh = budget.waitForShuiyuanBackgroundSlot();
  expect(await settles(eleventh, 59_000)).toBe(false);
  expect(await settles(eleventh, 1_000)).toBe(true);
});

it('pauses background requests for the Retry-After of any 429', async () => {
  budget.noteShuiyuanResponse(
    new Response(null, { status: 429, headers: { 'retry-after': '30' } }),
  );
  const next = budget.waitForShuiyuanBackgroundSlot();
  expect(await settles(next, 29_000)).toBe(false);
  expect(await settles(next, 1_000)).toBe(true);
});
