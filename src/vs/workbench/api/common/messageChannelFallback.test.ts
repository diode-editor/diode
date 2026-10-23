import { describe, expect, it } from "vitest";

import { jsonImage, summarizeMessage } from "./messageChannelFallback.ts";

describe("jsonImage", () => {
    it("is what the JSON wire carried: functions and undefined fields dropped, toJSON honored, a function in an array is null", () => {
        const when = new Date(0);
        expect(jsonImage({ fn: () => 1, gap: undefined, when, list: [1, () => 2], keep: "x" })).toEqual({
            when: when.toJSON(),
            list: [1, null],
            keep: "x",
        });
    });

    it("throws like JSON.stringify on a cycle and on a bare function (no JSON at all)", () => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        expect(() => jsonImage(cyclic)).toThrow();
        expect(() => jsonImage(() => 1)).toThrow();
    });
});

describe("summarizeMessage", () => {
    it("names the RPC envelope: kind, #id, method", () => {
        expect(summarizeMessage({ kind: "req", id: 7, method: "commands.executeCommand" })).toBe(
            "req#7 commands.executeCommand",
        );
        expect(summarizeMessage({ kind: "notif", method: "window.statusBarItem.update" })).toBe(
            "notif window.statusBarItem.update",
        );
        expect(summarizeMessage({ kind: "res", id: 3 })).toBe("res#3");
        expect(summarizeMessage({ id: 1, payload: "x" })).toBe("message#1");
    });

    it("anything that is not an RPC envelope is just 'message' — including null, undefined and a string", () => {
        expect(summarizeMessage({})).toBe("message");
        expect(summarizeMessage(null)).toBe("message");
        expect(summarizeMessage(undefined)).toBe("message");
        expect(summarizeMessage("ping")).toBe("message");
        expect(summarizeMessage({ kind: 1, id: "7", method: null })).toBe("message");
    });
});
