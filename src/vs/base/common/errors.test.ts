import { afterEach, describe, expect, it, vi } from "vitest";

import { onUnexpectedError, setUnexpectedErrorHandler } from "./errors.ts";

/** Deviation from upstream: the default logs to the console instead of crashing the process (see the errors.ts header). */

afterEach(() => {
    setUnexpectedErrorHandler((e) => {
        console.error(e);
    });
});

describe("onUnexpectedError", () => {
    it("по умолчанию пишет в консоль и не бросает", async () => {
        // The shared setupFiles installs its own handler for every test; the default
        // is visible only on a fresh module instance.
        vi.resetModules();
        const fresh = await import("./errors.ts");
        const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            const error = new Error("бум");
            expect(() => {
                fresh.onUnexpectedError(error);
            }).not.toThrow();
            expect(spy).toHaveBeenCalledWith(error);
        } finally {
            spy.mockRestore();
        }
    });

    it("зовёт установленный обработчик вместо дефолтного", () => {
        const handler = vi.fn();
        setUnexpectedErrorHandler(handler);
        const error = new Error("свой");
        onUnexpectedError(error);
        expect(handler).toHaveBeenCalledExactlyOnceWith(error);
    });
});
