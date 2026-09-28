import { describe, expect, it } from "vitest";

import { describeRejection } from "./describeRejection.ts";

describe("describeRejection", () => {
    it("у Error берёт стек — по «Error: message» виноватого не найти", () => {
        const described = describeRejection(new Error("boom"));

        expect(described).toContain("Error: boom");
        expect(described).toContain("describeRejection.test.ts");
    });

    it("Error без стека описывается именем и сообщением", () => {
        const error = new Error("boom");
        error.stack = undefined;

        expect(describeRejection(error)).toBe("Error: boom");
    });

    it("не-Error причины печатаются как есть", () => {
        expect(describeRejection("plain string")).toBe("plain string");
        expect(describeRejection(undefined)).toBe("undefined");
        expect(describeRejection({ code: 42 })).toBe("[object Object]");
    });
});
