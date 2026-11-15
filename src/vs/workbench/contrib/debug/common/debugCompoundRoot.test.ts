import { describe, expect, it, vi } from "vitest";

import { DebugCompoundRoot } from "./debugCompoundRoot.ts";

describe("DebugCompoundRoot", () => {
    it("the first stopped session stops the others once; the sessions it stops do not ask again", () => {
        const root = new DebugCompoundRoot();
        const stop = vi.fn();
        root.onDidSessionStop(stop);

        root.sessionStopped();
        root.sessionStopped();

        expect(stop).toHaveBeenCalledTimes(1);
    });
});
