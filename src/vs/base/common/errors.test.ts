import { afterEach, describe, expect, it, vi } from "vitest";

import { isSigPipeError, onUnexpectedError, setUnexpectedErrorHandler } from "./errors.ts";

/** Deviation from upstream: the default logs to the console instead of crashing the process (see the errors.ts header). */

afterEach(() => {
    setUnexpectedErrorHandler((e) => {
        console.error(e);
    });
});

describe("onUnexpectedError", () => {
    it("by default logs to the console and does not throw", async () => {
        // The shared setupFiles installs its own handler for every test; the default
        // is visible only on a fresh module instance.
        vi.resetModules();
        const fresh = await import("./errors.ts");
        const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            const error = new Error("boom");
            expect(() => {
                fresh.onUnexpectedError(error);
            }).not.toThrow();
            expect(spy).toHaveBeenCalledWith(error);
        } finally {
            spy.mockRestore();
        }
    });

    it("calls the installed handler instead of the default one", () => {
        const handler = vi.fn();
        setUnexpectedErrorHandler(handler);
        const error = new Error("custom");
        onUnexpectedError(error);
        expect(handler).toHaveBeenCalledExactlyOnceWith(error);
    });
});

describe("isSigPipeError", () => {
    const withCode = (code: string, syscall?: string): Error =>
        Object.assign(new Error(code), { code, ...(syscall !== undefined ? { syscall } : {}) });

    it("EPIPE from a write, in any case of the syscall name", () => {
        expect(isSigPipeError(withCode("EPIPE", "write"))).toBe(true);
        expect(isSigPipeError(withCode("EPIPE", "WRITE"))).toBe(true);
    });

    it("not EPIPE, not a write, or not an object at all", () => {
        expect(isSigPipeError(withCode("ECONNRESET", "write"))).toBe(false);
        expect(isSigPipeError(withCode("EPIPE", "read"))).toBe(false);
        expect(isSigPipeError(withCode("EPIPE"))).toBe(false);
        expect(isSigPipeError(new Error("EPIPE"))).toBe(false);
        expect(isSigPipeError(null)).toBe(false);
        expect(isSigPipeError(undefined)).toBe(false);
        expect(isSigPipeError("EPIPE")).toBe(false);
    });
});
