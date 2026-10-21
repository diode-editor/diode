import { afterEach, describe, expect, it, vi } from "vitest";

import { assert, assertFn, checkAdjacentItems } from "./assert.ts";
import { BugIndicatingError, setUnexpectedErrorHandler } from "./errors.ts";

/** Deviation from upstream: `assertFn` doesn't throw but goes to the error handler, otherwise the TUI wouldn't survive an edge-case diff. */

afterEach(() => {
    setUnexpectedErrorHandler((e) => {
        console.error(e);
    });
});

describe("assert", () => {
    it("stays silent on a true condition", () => {
        expect(() => {
            assert(true);
        }).not.toThrow();
    });

    it("throws BugIndicatingError with the default message on a false condition", () => {
        expect(() => {
            assert(false);
        }).toThrow(/Assertion Failed: unexpected state/);
        expect(() => {
            assert(false);
        }).toThrow(BugIndicatingError);
    });

    it("uses the passed message", () => {
        expect(() => {
            assert(false, "all bad");
        }).toThrow(/Assertion Failed: all bad/);
    });

    it("rethrows the passed error instance as is", () => {
        const error = new Error("custom");
        expect(() => {
            assert(false, error);
        }).toThrow(error);
    });
});

describe("assertFn", () => {
    it("does not call the handler on a true condition", () => {
        const handler = vi.fn();
        setUnexpectedErrorHandler(handler);
        assertFn(() => true);
        expect(handler).not.toHaveBeenCalled();
    });

    it("goes to the handler instead of throwing on a false condition", () => {
        const handler = vi.fn();
        setUnexpectedErrorHandler(handler);
        expect(() => {
            assertFn(() => false);
        }).not.toThrow();
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0]).toBeInstanceOf(BugIndicatingError);
    });

    it("a test can make the behavior strict — that is how the fixture corpus works", () => {
        setUnexpectedErrorHandler((e) => {
            throw e instanceof Error ? e : new Error(String(e));
        });
        expect(() => {
            assertFn(() => false);
        }).toThrow(BugIndicatingError);
    });
});

describe("checkAdjacentItems", () => {
    it("an empty array and a single-element array pass", () => {
        expect(checkAdjacentItems([], () => false)).toBe(true);
        expect(checkAdjacentItems([1], () => false)).toBe(true);
    });

    it("is true when the predicate holds for all pairs", () => {
        expect(checkAdjacentItems([1, 2, 3], (a, b) => a < b)).toBe(true);
    });

    it("is false when the predicate fails for any pair", () => {
        expect(checkAdjacentItems([1, 3, 2], (a, b) => a < b)).toBe(false);
    });
});

describe("BugIndicatingError", () => {
    it("instanceof works after setPrototypeOf", () => {
        expect(new BugIndicatingError("x")).toBeInstanceOf(BugIndicatingError);
        expect(new BugIndicatingError("x")).toBeInstanceOf(Error);
    });

    it("uses the default message when none is given", () => {
        expect(new BugIndicatingError().message).toBe("An unexpected bug occurred.");
        expect(new BugIndicatingError("custom").message).toBe("custom");
    });
});
