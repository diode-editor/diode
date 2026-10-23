import { vi } from "vitest";

/**
 * The folding recompute waits out a delay from the last trigger (upstream `{ min: 200 }`, 300 ms until the
 * first measurement, then adaptive). Under fake timers (`vi.useFakeTimers()`) this is enough for a recompute
 * whose provider replies at once; a test about the delay itself advances the clock by explicit amounts.
 */
export const FOLDING_SETTLE_MS = 300;

export async function foldsSettled(): Promise<void> {
    await vi.advanceTimersByTimeAsync(FOLDING_SETTLE_MS);
}
