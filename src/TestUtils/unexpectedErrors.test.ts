import { describe, expect, it } from "vitest";

import { onUnexpectedError } from "../vs/base/common/errors.ts";

import { UnexpectedErrorCollector } from "./unexpectedErrors.ts";

describe("UnexpectedErrorCollector", () => {
    it("silent without errors", () => {
        const collector = new UnexpectedErrorCollector();
        collector.install();
        expect(() => {
            collector.check(false);
        }).not.toThrow();
    });

    it("throws the first error with the collected count and cause, then forgets them", () => {
        const collector = new UnexpectedErrorCollector();
        collector.install();
        const first = new Error("first");
        onUnexpectedError(first);
        onUnexpectedError(new Error("second"));
        let caught: unknown;
        try {
            collector.check(false);
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(Error);
        expect((caught as Error).message).toMatch(/^onUnexpectedError during the test \(2\): Error: first\n\s+at /);
        expect((caught as Error).cause).toBe(first);
        expect(() => {
            collector.check(false);
        }).not.toThrow();
    });

    it("skips the error check for a failed test", () => {
        const collector = new UnexpectedErrorCollector();
        collector.install();
        onUnexpectedError(new Error("boom"));
        expect(() => {
            collector.check(true);
        }).not.toThrow();
        expect(() => {
            collector.check(false);
        }).not.toThrow();
    });

    it("install resets what was collected", () => {
        const collector = new UnexpectedErrorCollector();
        collector.install();
        onUnexpectedError(new Error("stale"));
        collector.install();
        expect(() => {
            collector.check(false);
        }).not.toThrow();
    });
});
