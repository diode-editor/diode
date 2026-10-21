/** 3 хватает continuation'ам QuickInput/QuickOpen после `commands.execute(...)`. */
export async function flushMicrotasks(turns = 3): Promise<void> {
    for (let i = 0; i < turns; i++) {
        await Promise.resolve();
    }
}

/** Для того, что микротасками не прокачать: round-trip к субпроцессу. */
export async function settle(ms = 200): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
