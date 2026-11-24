import { describe, expect, it } from "vitest";

import { getShellIntegrationTimeout } from "./terminalEnvironment.ts";

describe("getShellIntegrationTimeout", () => {
    it("-1 (the default), any negative or a non-number: 5000 ms with the injection on, 2000 without", () => {
        for (const value of [-1, -5, undefined, "100", null]) {
            expect(getShellIntegrationTimeout(value, true, 0)).toBe(5000);
            expect(getShellIntegrationTimeout(value, false, 0)).toBe(2000);
        }
    });

    it("0 — no wait; 1..499 — 500 ms; above — the value itself", () => {
        expect(getShellIntegrationTimeout(0, true, 0)).toBe(0);
        expect(getShellIntegrationTimeout(1, true, 0)).toBe(500);
        expect(getShellIntegrationTimeout(499, false, 0)).toBe(500);
        expect(getShellIntegrationTimeout(500, true, 0)).toBe(500);
        expect(getShellIntegrationTimeout(60_000, true, 0)).toBe(60_000);
    });

    it("the time since the process started is taken off, down to 0", () => {
        expect(getShellIntegrationTimeout(-1, true, 1200)).toBe(3800);
        expect(getShellIntegrationTimeout(800, true, 300)).toBe(500);
        expect(getShellIntegrationTimeout(800, true, 800)).toBe(0);
        expect(getShellIntegrationTimeout(800, true, 10_000)).toBe(0);
    });
});
