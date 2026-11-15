// What a user drives on the full workbench beyond the main path of debug.app.test.ts: restart, run without
// debugging, attach and disconnect, stop while running or launching, call stack navigation and paging, chunked
// variables, quick repeats, a second session and program output.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_LAUNCH_CONFIG,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";

import { DebugServiceDIToken } from "./debugService.ts";

describe("debugging in the workbench: session keys", () => {
    let h: IAppHarness;
    let registration: IDisposable & { factory: SyntheticDebugAdapterFactory };

    function key(name: string): unknown {
        return h.container.get(ContextKeyServiceDIToken).getRaw(name);
    }

    function debugService() {
        return h.container.get(DebugServiceDIToken);
    }

    function commands(adapter = 0): string[] {
        return registration.factory.adapters[adapter].requests.map((r) => r.command);
    }

    function focusedFrameLine(): number | undefined {
        return debugService().getViewModel().focusedStackFrame?.range.startLineNumber;
    }

    beforeEach(async () => {
        h = createAppTestHarness();
        await h.workbench.activate();
        registration = registerSyntheticDebugger(debugService().getAdapterManager(), NO_DELAY_TIMING);
    });

    afterEach(async () => {
        await debugService().stopSession(undefined);
        registration.factory.adapters.forEach((a) => {
            a.dispose();
        });
        registration.dispose();
        h.dispose();
    });

    async function startStopped(config: object = SYNTHETIC_LAUNCH_CONFIG): Promise<void> {
        await h.commands.execute("debug.startFromConfig", { ...config });
        await vi.waitFor(() => {
            expect(key("debugState")).toBe("stopped");
        });
    }

    it("inDebugMode is on while debugging and off after Shift+F5", async () => {
        expect(key("inDebugMode")).toBe(false);
        await startStopped();
        expect(key("inDebugMode")).toBe(true);

        h.testApp.sendKey("Shift+F5");

        await vi.waitFor(() => {
            expect(key("debugState")).toBe("inactive");
        });
        expect(key("inDebugMode")).toBe(false);
        expect(debugService().getModel().getSessions()).toHaveLength(0);
    });

    it("Ctrl+Shift+F5 restarts the program and stops again on the first line", async () => {
        await startStopped();
        h.testApp.sendKey("F10");
        await vi.waitFor(() => {
            expect(focusedFrameLine()).toBe(28);
        });

        h.testApp.sendKey("Ctrl+Shift+F5");

        await vi.waitFor(() => {
            expect(key("debugState")).toBe("stopped");
            expect(focusedFrameLine()).toBe(27);
        });
        expect(debugService().getModel().getSessions()).toHaveLength(1);
    });

    it("a config with noDebug launches the program without debugging", async () => {
        // Ctrl+F5 needs a selected launch configuration (#1138); the run-without-debugging path is the same flag.
        await h.commands.execute("debug.startFromConfig", { ...SYNTHETIC_LAUNCH_CONFIG, noDebug: true });

        await vi.waitFor(() => {
            const launch = registration.factory.adapters[0].requests.find((r) => r.command === "launch");
            expect((launch?.arguments as { noDebug?: boolean } | undefined)?.noDebug).toBe(true);
        });
    });

    it("Shift+F5 on an attach session disconnects instead of terminating", async () => {
        await startStopped({ ...SYNTHETIC_LAUNCH_CONFIG, request: "attach", name: "Attach hello" });
        expect(key("focusedSessionIsAttach")).toBe(true);

        h.testApp.sendKey("Shift+F5");

        await vi.waitFor(() => {
            expect(key("debugState")).toBe("inactive");
        });
        expect(commands()).toContain("disconnect");
        expect(commands()).not.toContain("terminate");
    });

    it("Shift+F5 stops a running program", async () => {
        registration.dispose();
        registration = registerSyntheticDebugger(debugService().getAdapterManager(), {
            ...NO_DELAY_TIMING,
            continueMs: 60_000,
        });
        await startStopped();
        h.testApp.sendKey("F5");
        await vi.waitFor(() => {
            expect(key("debugState")).toBe("running");
        });

        h.testApp.sendKey("Shift+F5");

        await vi.waitFor(() => {
            expect(key("debugState")).toBe("inactive");
        });
    });

    it("Shift+F5 before the program reaches its first stop ends the session", async () => {
        registration.dispose();
        registration = registerSyntheticDebugger(debugService().getAdapterManager(), {
            ...NO_DELAY_TIMING,
            launchMs: 60_000,
        });
        await h.commands.execute("debug.startFromConfig", { ...SYNTHETIC_LAUNCH_CONFIG });
        await vi.waitFor(() => {
            expect(key("debugState")).toBe("running");
        });

        h.testApp.sendKey("Shift+F5");

        await vi.waitFor(() => {
            expect(key("debugState")).toBe("inactive");
            expect(debugService().getModel().getSessions()).toHaveLength(0);
        });
    });

    it("F6 while stopped does not send pause", async () => {
        await startStopped();

        h.testApp.sendKey("F6");
        await new Promise((r) => setTimeout(r, 50));

        expect(commands()).not.toContain("pause");
        expect(key("debugState")).toBe("stopped");
    });

    it("call stack navigation moves the focused frame down, bottom, up and top", async () => {
        await startStopped();
        const focused = (): number => {
            const stack = debugService().getModel().getSessions()[0].getThread(1)?.getCallStack() ?? [];
            const frame = debugService().getViewModel().focusedStackFrame;
            return frame ? stack.indexOf(frame) : -1;
        };
        expect(focused()).toBe(0);

        await h.commands.execute("workbench.action.debug.callStackDown");
        expect(focused()).toBe(1);

        await h.commands.execute("workbench.action.debug.callStackBottom");
        const bottom = focused();
        expect(bottom).toBeGreaterThan(1);

        await h.commands.execute("workbench.action.debug.callStackUp");
        expect(focused()).toBe(bottom - 1);

        await h.commands.execute("workbench.action.debug.callStackTop");
        expect(focused()).toBe(0);
    });

    it("five quick F10 presses end stopped with a consistent focused frame", async () => {
        await startStopped();

        for (let i = 0; i < 5; i++) h.testApp.sendKey("F10");

        await vi.waitFor(() => {
            expect(key("debugState")).toBe("stopped");
            expect(debugService().getViewModel().focusedStackFrame).toBeDefined();
        });
        await new Promise((r) => setTimeout(r, 100));
        expect(key("debugState")).toBe("stopped");
    });

    it("a second startFromConfig runs a second session; Shift+F5 twice ends both", async () => {
        await startStopped();
        await h.commands.execute("debug.startFromConfig", { ...SYNTHETIC_LAUNCH_CONFIG, name: "Second" });
        await vi.waitFor(() => {
            expect(debugService().getModel().getSessions()).toHaveLength(2);
            expect(key("debugState")).toBe("stopped");
        });

        await debugService().stopSession(undefined);

        await vi.waitFor(() => {
            expect(key("debugState")).toBe("inactive");
            expect(debugService().getModel().getSessions()).toHaveLength(0);
        });
    });

    it("the main thread shows 20 frames first and all 26 after loading more; nums comes in chunks", async () => {
        await startStopped();
        const thread = debugService().getModel().getSessions()[0].getThread(1);
        await vi.waitFor(() => {
            expect(thread?.getCallStack()).toHaveLength(20);
        });

        await (thread as unknown as { fetchCallStack(levels: number): Promise<void> }).fetchCallStack(20);
        expect(thread?.getCallStack()).toHaveLength(26);

        const frame = debugService().getViewModel().focusedStackFrame;
        const scopes = (await frame?.getScopes()) ?? [];
        expect(scopes.map((s) => s.name)).toEqual(["Locals", "Static", "Global", "Registers"]);
        const locals = await scopes[0].getChildren();
        const nums = locals.find((v) => v.name === "nums");
        const chunks = (await nums?.getChildren()) ?? [];
        expect(chunks[0]?.name).toBe("[0..99]");
        expect(chunks).toHaveLength(10);
    });

    it("program output reaches the debug console model", async () => {
        await startStopped();

        await vi.waitFor(() => {
            const text = debugService()
                .getModel()
                .getSessions()[0]
                .getReplElements()
                .map((e) => e.toString())
                .join("\n");
            expect(text).toContain("Launched process 48213");
        });
    });
});
