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
