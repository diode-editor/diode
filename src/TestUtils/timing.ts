/** 3 turns are enough for QuickInput/QuickOpen continuations after `commands.execute(...)`. */
export async function flushMicrotasks(turns = 3): Promise<void> {
    for (let i = 0; i < turns; i++) {
        await Promise.resolve();
    }
}

/** For what microtasks can't flush: a round trip to the subprocess. */
export async function settle(ms = 200): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls `probe` until it holds; for state that arrives at its own pace — a debounced recompute
 * (folding: 200+ ms after the trigger) plus a subprocess round trip. Throws with `what` on timeout.
 */
export async function waitUntil(what: string, probe: () => boolean, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!probe()) {
        if (Date.now() > deadline) throw new Error(`waitUntil: ${what} did not happen within ${timeoutMs} ms`);
        await settle(20);
    }
}
