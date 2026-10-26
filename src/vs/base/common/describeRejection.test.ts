import { describe, expect, it } from "vitest";

import { describeRejection } from "./describeRejection.ts";

describe("describeRejection", () => {
    it('takes the stack of an Error — "Error: message" alone does not point to the culprit', () => {
        const described = describeRejection(new Error("boom"));

        expect(described).toContain("Error: boom");
        expect(described).toContain("describeRejection.test.ts");
    });

    it("an Error without a stack is described by name and message", () => {
        const error = new Error("boom");
        error.stack = undefined;

        expect(describeRejection(error)).toBe("Error: boom");
    });

    it("non-Error reasons are printed as is", () => {
        expect(describeRejection("plain string")).toBe("plain string");
        expect(describeRejection(undefined)).toBe("undefined");
        expect(describeRejection({ code: 42 })).toBe("[object Object]");
    });

    it("a value that cannot be printed does not throw: the type tag and a note", () => {
        const badStack = new Error("boom");
        Object.defineProperty(badStack, "stack", {
            get(): never {
                throw new Error("no stack");
            },
        });

        expect(describeRejection(Object.create(null))).toBe("[object Object] (could not be described)");
        expect(describeRejection(badStack)).toBe("[object Error] (could not be described)");
    });
});
