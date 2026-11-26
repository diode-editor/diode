// The keys the Run and Debug views give the menus and keybindings for the row under the cursor — a session's state
// and its one thread, the kind of a breakpoint, nothing — and the BREAKPOINTS title commands with no row or another
// container in front.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugViewletHarness, type IDebugViewletHarness } from "../../../../../TestUtils/debugViewletHarness.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_LAUNCH_CONFIG,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { WorkbenchContextKeysDIToken } from "../../../browser/workbenchContextKeys.ts";
import { BREAKPOINTS_VIEW_ID, CALLSTACK_VIEW_ID, type IDebugSession, State } from "../common/debug.ts";

import { DebugServiceDIToken } from "./debugService.ts";
import { DebugViewletComponentDIToken } from "./debugViewlet.ts";

describe("Run and Debug: the keys of the row under the cursor", () => {
    let t: IDebugViewletHarness;
    let registration: IDisposable | undefined;

    beforeEach(async () => {
        t = await createDebugViewletHarness(process.cwd());
        registration = undefined;
    });

    afterEach(async () => {
        await t.h.container.get(DebugServiceDIToken).stopSession(undefined);
        registration?.dispose();
        await t.dispose();
    });

    /** The context key `key` with the cursor on `element` of the view `viewId`. */
    function keyAt(viewId: string, element: unknown, key: string): unknown {
        t.h.container.get(ViewsServiceDIToken).openView(viewId, true);
        const component = t.h.container.get(DebugViewletComponentDIToken);
        const tree = viewId === CALLSTACK_VIEW_ID ? component.callStack.tree : component.breakpoints.tree;
        if (element !== undefined) tree.reveal(element as never);
        t.h.container.get(WorkbenchContextKeysDIToken).update();
        return t.h.container.get(ContextKeyServiceDIToken).getRaw(key);
    }

    it("a session row: stopped or running, one thread or several", async () => {
        const debugService = t.h.container.get(DebugServiceDIToken);
        // A continue that does not reach the next stop while the test looks.
        const synthetic = registerSyntheticDebugger(debugService.getAdapterManager(), {
            ...NO_DELAY_TIMING,
            continueMs: 60_000,
        });
        registration = synthetic;
        await t.h.commands.execute("debug.startFromConfig", { ...SYNTHETIC_LAUNCH_CONFIG });
        await t.h.commands.execute("debug.startFromConfig", { ...SYNTHETIC_LAUNCH_CONFIG, name: "second" });
        let second: IDebugSession | undefined;
        await vi.waitFor(() => {
            second = debugService
                .getModel()
                .getSessions()
                .find((s) => s.getLabel() === "second");
            expect(second?.state).toBe(State.Stopped);
        });
        const session = second!;
        for (const thread of session.getAllThreads().filter((th) => th.threadId !== 1)) await thread.terminate();
        await vi.waitFor(() => {
            expect(session.getAllThreads()).toHaveLength(1);
        });

        expect(keyAt(CALLSTACK_VIEW_ID, session, "callStackSessionHasOneThread")).toBe(true);
        expect(keyAt(CALLSTACK_VIEW_ID, session, "callStackItemStopped")).toBe(true);

        await session.continue(1);
        await vi.waitFor(() => {
            expect(session.state).toBe(State.Running);
        });
        expect(keyAt(CALLSTACK_VIEW_ID, session, "callStackItemStopped")).toBe(false);

        // Another view in front: no call stack item.
        expect(keyAt(BREAKPOINTS_VIEW_ID, undefined, "callStackItemType")).toBe("");
    });

    it("a function breakpoint row has its type; with no row the type is empty and Delete does nothing", async () => {
        const debugService = t.h.container.get(DebugServiceDIToken);
        await debugService.addFunctionBreakpoint({ name: "accumulate" });
        await vi.waitFor(() => {
            expect(t.screen()).toContain("accumulate");
        });
        const [fbp] = debugService.getModel().getFunctionBreakpoints();

        expect(keyAt(BREAKPOINTS_VIEW_ID, fbp, "breakpointItemType")).toBe("functionBreakpoint");

        await debugService.removeFunctionBreakpoints();
        await vi.waitFor(() => {
            expect(t.screen()).not.toContain("accumulate");
        });
        expect(keyAt(BREAKPOINTS_VIEW_ID, undefined, "breakpointsFocused")).toBe(true);
        expect(keyAt(BREAKPOINTS_VIEW_ID, undefined, "breakpointItemType")).toBe("");
        const removeFocused = async (): Promise<unknown> => t.h.commands.execute("debug.removeBreakpoint");
        await expect(removeFocused()).resolves.toBeUndefined();
    });

    it("Add Function Breakpoint brings BREAKPOINTS forward from another container", async () => {
        await t.h.commands.execute("workbench.view.explorer");
        expect(t.h.container.get(ViewsServiceDIToken).isViewShown(BREAKPOINTS_VIEW_ID)).toBe(false);

        // The command waits for the name: not awaited here.
        void t.h.commands.execute("workbench.debug.viewlet.action.addFunctionBreakpointAction");
        await vi.waitFor(() => {
            expect(t.screen()).toContain("Function to break on");
        });

        expect(t.h.container.get(ViewsServiceDIToken).isViewShown(BREAKPOINTS_VIEW_ID)).toBe(true);
        t.h.testApp.sendKey("Escape");
    });

    it("Toggle Presentation goes from the list to the tree and back to the list", async () => {
        const configuration = t.h.container.get(IConfigurationServiceDIToken);
        const toggle = "workbench.debug.viewlet.action.toggleBreakpointsPresentation";

        await t.h.commands.execute(toggle);
        expect(configuration.get("debug.breakpointsView.presentation")).toBe("tree");
        await t.h.commands.execute(toggle);
        // As written to the settings, not only as read back through the schema's default.
        expect(configuration.inspect("debug.breakpointsView.presentation").user).toBe("list");
    });
});
