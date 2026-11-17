import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { adapterManagerPorts, idleDebugService } from "../../../../../TestUtils/mockDebug.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";

import { AdapterManager } from "./debugAdapterManager.ts";

// Upstream `AdapterManager` (debugAdapterManager.ts:86-90) recomputes `debuggersAvailable` whenever a context key used
// in a debugger's `when` changes. F5 and Select and Start Debugging are keyed on it, so a debugger enabled after start
// (a setting turned on, a context key of an extension) must make F5 work without a restart, and the other way round.
describe("AdapterManager — `debuggersAvailable` follows the `when` of the debuggers", () => {
    let manager: AdapterManager;
    let contextKeys: ContextKeyService;

    beforeEach(() => {
        contextKeys = new ContextKeyService();
        manager = new AdapterManager(idleDebugService, adapterManagerPorts({ contextKeys }));
    });

    afterEach(() => {
        manager.dispose();
    });

    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

    it("a debugger whose `when` becomes true makes debuggers available", async () => {
        contextKeys.setRaw("qaDebuggerEnabled", false);
        manager.registerDebugger({ type: "qa", label: "QA", when: "qaDebuggerEnabled" });
        await settle();
        expect(manager.getDebugger("qa")?.enabled).toBe(false);
        expect(contextKeys.getRaw("debuggersAvailable")).toBe(false);

        contextKeys.setRaw("qaDebuggerEnabled", true);
        await settle();

        expect(manager.getDebugger("qa")?.enabled).toBe(true);
        expect(contextKeys.getRaw("debuggersAvailable")).toBe(true);
    });

    it("the only debugger whose `when` becomes false makes debuggers unavailable", async () => {
        contextKeys.setRaw("qaDebuggerEnabled", true);
        manager.registerDebugger({ type: "qa", label: "QA", when: "qaDebuggerEnabled" });
        await settle();
        expect(contextKeys.getRaw("debuggersAvailable")).toBe(true);

        contextKeys.setRaw("qaDebuggerEnabled", false);
        await settle();

        expect(manager.getDebugger("qa")?.enabled).toBe(false);
        expect(contextKeys.getRaw("debuggersAvailable")).toBe(false);
    });
});
