import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { adapterManagerPorts, idleDebugService } from "../../../../../TestUtils/mockDebug.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";

import { AdapterManager } from "./debugAdapterManager.ts";

// Upstream `canSetBreakpointsIn` (debugAdapterManager.ts:316): never in jsonc and log, anywhere by
// `debug.allowBreakpointsEverywhere`, else in a language of `contributes.breakpoints` whose `when` holds. The gutter
// redraws on `onDidChangeCanSetBreakpoints`.
describe("AdapterManager — where breakpoints can be set", () => {
    let manager: AdapterManager;
    let contextKeys: ContextKeyService;
    let everywhere: boolean;
    let changes: number;

    beforeEach(() => {
        contextKeys = new ContextKeyService();
        everywhere = false;
        manager = new AdapterManager(
            idleDebugService,
            adapterManagerPorts({ contextKeys, allowBreakpointsEverywhere: () => everywhere }),
        );
        changes = 0;
        manager.onDidChangeCanSetBreakpoints(() => {
            changes++;
        });
    });

    afterEach(() => {
        manager.dispose();
    });

    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

    it("in a language of `contributes.breakpoints` only, until the contribution goes", () => {
        expect(manager.canSetBreakpointsIn("cpp")).toBe(false);

        const registration = manager.registerBreakpoints({ language: "cpp" });
        expect(changes).toBe(1);
        expect(manager.canSetBreakpointsIn("cpp")).toBe(true);
        expect(manager.canSetBreakpointsIn("c")).toBe(false);

        registration.dispose();
        expect(changes).toBe(2);
        expect(manager.canSetBreakpointsIn("cpp")).toBe(false);
    });

    it("a contribution that goes takes only its own language", () => {
        manager.registerBreakpoints({ language: "cpp" });
        manager.registerBreakpoints({ language: "c" }).dispose();
        expect(manager.canSetBreakpointsIn("cpp")).toBe(true);
        expect(manager.canSetBreakpointsIn("c")).toBe(false);
    });

    it("everywhere with `debug.allowBreakpointsEverywhere`, but never in jsonc, log or a file without a language", () => {
        everywhere = true;
        expect(manager.canSetBreakpointsIn("plaintext")).toBe(true);
        manager.registerBreakpoints({ language: "jsonc" });
        manager.registerBreakpoints({ language: "log" });
        expect(manager.canSetBreakpointsIn("jsonc")).toBe(false);
        expect(manager.canSetBreakpointsIn("log")).toBe(false);
        expect(manager.canSetBreakpointsIn("")).toBe(false);
    });

    it("while the `when` of the contribution holds; a change of its key is a change", async () => {
        contextKeys.setRaw("qaBreakpoints", false);
        manager.registerBreakpoints({ language: "cpp", when: "qaBreakpoints" });
        expect(manager.canSetBreakpointsIn("cpp")).toBe(false);
        const before = changes;

        contextKeys.setRaw("qaBreakpoints", true);
        await settle();

        expect(changes).toBe(before + 1);
        expect(manager.canSetBreakpointsIn("cpp")).toBe(true);
        contextKeys.setRaw("unrelated", true);
        await settle();
        expect(changes).toBe(before + 1);

        // A batch of keys where only one is the contribution's.
        contextKeys.setRaw("unrelated", false);
        contextKeys.setRaw("qaBreakpoints", false);
        await settle();
        expect(changes).toBe(before + 2);
    });

    it("a debugger registered, or one whose `when` changes, is a change: the lane follows `debuggersAvailable`", async () => {
        contextKeys.setRaw("qaDebugger", false);
        manager.registerDebugger({ type: "qa", label: "QA", when: "qaDebugger" });
        expect(changes).toBe(1);

        contextKeys.setRaw("qaDebugger", true);
        await settle();

        expect(changes).toBe(2);
        expect(manager.hasEnabledDebuggers()).toBe(true);
    });
});
