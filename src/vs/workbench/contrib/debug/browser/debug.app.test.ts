// The whole workbench with the synthetic debugger registered: what `drive` does by hand — `debug.startFromConfig`,
// `debugState` going inactive → running → stopped, the keys of upstream (F5, F6, F10, F11, Shift+F11, Shift+F5)
// through the real keybinding dispatcher, and the palette entries.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_LAUNCH_CONFIG,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { MenuRegistryDIToken } from "../../../../platform/actions/common/menuRegistry.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { State } from "../common/debug.ts";
import type { Thread } from "../common/debugModel.ts";

import { DebugServiceDIToken } from "./debugService.ts";

describe("debugging in the workbench", () => {
    let h: IAppHarness;
    let registration: IDisposable & { factory: SyntheticDebugAdapterFactory };
    const debugStates: unknown[] = [];

    function debugState(): unknown {
        return h.container.get(ContextKeyServiceDIToken).getRaw("debugState");
    }

    function debugService() {
        return h.container.get(DebugServiceDIToken);
    }

    function main(): Thread {
        return debugService().getModel().getSessions()[0].getThread(1) as Thread;
    }

    beforeEach(async () => {
        h = createAppTestHarness();
        await h.workbench.activate();
        debugStates.length = 0;
        const contextKeys = h.container.get(ContextKeyServiceDIToken);
        contextKeys.onDidChange(() => {
            const state = contextKeys.getRaw("debugState");
            if (debugStates.at(-1) !== state) debugStates.push(state);
        });
    });

    afterEach(async () => {
        await debugService().stopSession(undefined);
        registration.factory.adapters.forEach((a) => {
            a.dispose();
        });
        registration.dispose();
        h.dispose();
    });

    function register(timing = NO_DELAY_TIMING): void {
        registration = registerSyntheticDebugger(debugService().getAdapterManager(), timing);
    }

    async function startStopped(): Promise<void> {
        await h.commands.execute("debug.startFromConfig", { ...SYNTHETIC_LAUNCH_CONFIG });
        await vi.waitFor(() => {
            expect(debugState()).toBe("stopped");
        });
    }

    it("debugState is inactive at the start, and no debugger is there", () => {
        register();
        registration.dispose();

        expect(debugState()).toBe("inactive");
        expect(h.container.get(ContextKeyServiceDIToken).getRaw("debuggersAvailable")).toBe(false);
    });

    it("debug.startFromConfig: inactive → initializing → running → stopped", async () => {
        register();

        await startStopped();

        expect(debugStates).toEqual(["initializing", "running", "stopped"]);
        expect(h.container.get(ContextKeyServiceDIToken).getRaw("debugType")).toBe("synthetic");
    });

    it("F10 steps over, F11 steps in, Shift+F11 steps out", async () => {
        register();
        await startStopped();

        h.testApp.sendKey("F10");
        await vi.waitFor(() => {
            expect(main().stoppedDetails?.reason).toBe("step");
            expect(main().getTopStackFrame()?.range.startLineNumber).toBe(28);
        });
        h.testApp.sendKey("F11");
        await vi.waitFor(() => {
            expect(registration.factory.adapters[0].requests.map((r) => r.command)).toContain("stepIn");
        });
        h.testApp.sendKey("Shift+F11");
        await vi.waitFor(() => {
            expect(registration.factory.adapters[0].requests.map((r) => r.command)).toContain("stepOut");
            expect(debugState()).toBe("stopped");
        });
    });

    it("the third F10 stops on the exception", async () => {
        register();
        await startStopped();

        for (let step = 0; step < 3; step++) {
            const steps = registration.factory.adapters[0].requests.filter((r) => r.command === "next").length;
            h.testApp.sendKey("F10");
            await vi.waitFor(() => {
                expect(registration.factory.adapters[0].requests.filter((r) => r.command === "next")).toHaveLength(
                    steps + 1,
                );
                expect(debugService().state).toBe(State.Stopped);
            });
        }

        await vi.waitFor(() => {
            expect(main().stoppedDetails?.reason).toBe("exception");
        });
    });

    it("F5 continues a stopped program; F6 pauses a running one", async () => {
        register({ ...NO_DELAY_TIMING, continueMs: 60_000 });
        await startStopped();

        h.testApp.sendKey("F5");
        await vi.waitFor(() => {
            expect(debugState()).toBe("running");
        });
        h.testApp.sendKey("F6");

        await vi.waitFor(() => {
            expect(debugState()).toBe("stopped");
            expect(main().stoppedDetails?.reason).toBe("pause");
        });
    });

    it("Shift+F5 stops the session", async () => {
        register();
        await startStopped();

        h.testApp.sendKey("Shift+F5");

        await vi.waitFor(() => {
            expect(debugState()).toBe("inactive");
        });
        expect(registration.factory.adapters[0].requests.map((r) => r.command)).toContain("terminate");
    });

    it("the palette lists the session commands only while debugging, and Start Debugging with a debugger", async () => {
        const menus = h.container.get(MenuRegistryDIToken);
        expect(menus.isInCommandPalette("workbench.action.debug.start")).toBe(false);
        register();
        expect(menus.isInCommandPalette("workbench.action.debug.start")).toBe(true);
        expect(menus.isInCommandPalette("workbench.action.debug.stepOver")).toBe(false);

        await startStopped();

        expect(menus.isInCommandPalette("workbench.action.debug.stepOver")).toBe(true);
        // Pause's precondition is a running session: upstream's palette leaves it out while stopped.
        expect(menus.isInCommandPalette("workbench.action.debug.pause")).toBe(false);
        expect(menus.isInCommandPalette("debug.startFromConfig")).toBe(false);
        expect(h.commands.getTitle("workbench.action.debug.stepOver")).toBe("Debug: Step Over");
    });
});
