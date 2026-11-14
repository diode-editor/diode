import { describe, expect, it } from "vitest";

import { getStateLabel, isDebugConfig, isFrameDeemphasized, type IStackFrame, State } from "./debug.ts";

describe("debug.ts", () => {
    it("names each state as the debugState context key does", () => {
        expect([State.Inactive, State.Initializing, State.Stopped, State.Running].map(getStateLabel)).toEqual([
            "inactive",
            "initializing",
            "stopped",
            "running",
        ]);
    });

    it("a frame is deemphasized by its own hint, else by its source's", () => {
        const frame = (presentationHint: string | undefined, sourceHint?: "deemphasize" | "emphasize") =>
            ({ presentationHint, source: { presentationHint: sourceHint } }) as IStackFrame;
        expect(isFrameDeemphasized(frame("subtle"))).toBe(true);
        expect(isFrameDeemphasized(frame("deemphasize"))).toBe(true);
        expect(isFrameDeemphasized(frame(undefined, "deemphasize"))).toBe(true);
        expect(isFrameDeemphasized(frame("normal", "deemphasize"))).toBe(false);
        expect(isFrameDeemphasized(frame(undefined, "emphasize"))).toBe(false);
    });

    it("a launch configuration has a type and a request, a compound has neither", () => {
        expect(isDebugConfig({ type: "lldb", request: "launch", name: "a" })).toBe(true);
        expect(isDebugConfig({ name: "both", configurations: [] })).toBe(false);
        expect(isDebugConfig({ type: "lldb", name: "x" } as never)).toBe(false);
    });
});
