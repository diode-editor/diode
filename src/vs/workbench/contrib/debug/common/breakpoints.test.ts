import { describe, expect, it } from "vitest";

import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";

import { Breakpoints } from "./breakpoints.ts";

describe("Breakpoints (contributes.breakpoints)", () => {
    it("is enabled while its when clause holds", () => {
        const keys = new ContextKeyService();
        const breakpoints = new Breakpoints({ language: "cpp", when: "debugState == 'stopped'" }, keys);
        expect(breakpoints.language).toBe("cpp");
        expect(breakpoints.enabled).toBe(false);
        keys.set("debugState", "stopped");
        expect(breakpoints.enabled).toBe(true);
        keys.dispose();
    });

    it("is always enabled without a when clause or with one that does not parse", () => {
        const never = { evaluate: (): boolean => false };
        expect(new Breakpoints({ language: "cpp" }, never).enabled).toBe(true);
        expect(new Breakpoints({ language: "cpp", when: "(a &&" }, never).enabled).toBe(true);
    });
});
