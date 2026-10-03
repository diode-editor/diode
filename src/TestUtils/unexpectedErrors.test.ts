import { describe, expect, it } from "vitest";

import { onUnexpectedError } from "../vs/base/common/errors.ts";

import { UnexpectedErrorCollector } from "./unexpectedErrors.ts";

describe("UnexpectedErrorCollector", () => {
    it("без ошибок молчит", () => {
        const collector = new UnexpectedErrorCollector();
        collector.install();
        expect(() => {
            collector.check(false);
        }).not.toThrow();
    });

    it("бросает первую ошибку с числом собранных и причиной, затем забывает их", () => {
        const collector = new UnexpectedErrorCollector();
        collector.install();
        const first = new Error("первая");
        onUnexpectedError(first);
        onUnexpectedError(new Error("вторая"));
        let caught: unknown;
        try {
            collector.check(false);
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(Error);
        expect((caught as Error).message).toMatch(/^onUnexpectedError during the test \(2\): Error: первая\n\s+at /);
        expect((caught as Error).cause).toBe(first);
        expect(() => {
            collector.check(false);
        }).not.toThrow();
    });

    it("у упавшего теста ошибки не проверяет", () => {
        const collector = new UnexpectedErrorCollector();
        collector.install();
        onUnexpectedError(new Error("бум"));
        expect(() => {
            collector.check(true);
        }).not.toThrow();
        expect(() => {
            collector.check(false);
        }).not.toThrow();
    });

    it("install сбрасывает накопленное", () => {
        const collector = new UnexpectedErrorCollector();
        collector.install();
        onUnexpectedError(new Error("старая"));
        collector.install();
        expect(() => {
            collector.check(false);
        }).not.toThrow();
    });
});
