// Picking a worker from Debug: Select Debug Session / Debug: Select Debug Console, as a user does: the picked
// session's paused frame becomes the focused one, so VARIABLES show the worker's locals (upstream `focusStackFrame(
// undefined, undefined, session, { explicit: true })` focuses the top frame of the session's stopped thread). A
// worker whose frames have no source has no top frame (upstream `Thread.getTopStackFrame` takes only a frame with an
// available source, `debugModel.ts:634` of 1.127): its session is focused without a frame, as Ctrl+PageDown does,
// and VARIABLES let go of the app's locals.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugViewletHarness, type IDebugViewletHarness } from "../../../../../TestUtils/debugViewletHarness.ts";
import { typeText } from "../../../../../TestUtils/domQueries.ts";
import {
    SYNTHETIC_LAUNCH_CONFIG,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { QuickInputComponentDIToken } from "../../../browser/parts/quickinput/quickInputComponent.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { type IDebugSession, State, VARIABLES_VIEW_ID } from "../common/debug.ts";

import { DebugServiceDIToken } from "./debugService.ts";

const FILE = "src/main.cpp";

const PICKERS = [["workbench.action.debug.selectDebugSession"], ["workbench.action.debug.selectDebugConsole"]];

describe("picking a worker session", () => {
    let ws: ITempWorkspace;
    let t: IDebugViewletHarness;
    let factory: SyntheticDebugAdapterFactory;

    beforeEach(async () => {
        ws = createTempWorkspace({ files: { [FILE]: "alpha\nbeta\ngamma\n" } });
        t = await createDebugViewletHarness(ws.dir, ws.dir);
        t.h.workbench.openFile(ws.path(FILE));
        factory = t.registerDebugger();
    });

    afterEach(async () => {
        await t.dispose();
        ws.dispose();
    });

    /**
     * The workers run the app's program, so their locals would read the same: a worker's names get a `w_` prefix to
     * tell whose VARIABLES are on screen. `withoutSource`: the workers' frames come with no source, as the Debug Demo
     * extension's attached workers do (no workspace folder), or js-debug's frames of a worker's internals.
     */
    function markWorkers(withoutSource: boolean): void {
        const create = factory.createDebugAdapter.bind(factory);
        factory.createDebugAdapter = () => {
            const adapter = create();
            // The first adapter is the app's.
            if (factory.adapters.length === 1) return adapter;
            const accept = adapter.acceptMessage.bind(adapter);
            adapter.acceptMessage = (message: DebugProtocol.ProtocolMessage) => {
                const response = message as DebugProtocol.Response;
                if (response.type === "response" && response.body) {
                    if (response.command === "stackTrace" && withoutSource) {
                        for (const frame of (response as DebugProtocol.StackTraceResponse).body.stackFrames) {
                            delete frame.source;
                        }
                    }
                    if (response.command === "variables") {
                        for (const v of (response as DebugProtocol.VariablesResponse).body.variables) {
                            v.name = `w_${v.name}`;
                        }
                    }
                }
                accept(message);
            };
            return adapter;
        };
    }

    function sessions(): IDebugSession[] {
        return t.h.container.get(DebugServiceDIToken).getModel().getSessions();
    }

    /** The rows of the VARIABLES view, between its title and WATCH's. */
    function variables(): string {
        const rows = t.lines();
        const start = rows.findIndex((row) => row.includes("VARIABLES"));
        const end = rows.findIndex((row, i) => i > start && row.includes("WATCH"));
        return rows.slice(start + 1, end).join("\n");
    }

    async function startWithWorkers(): Promise<void> {
        await t.h.commands.execute("debug.startFromConfig", {
            ...SYNTHETIC_LAUNCH_CONFIG,
            name: "app",
            workers: ["task A", "task B"],
        });
        await vi.waitFor(() => {
            expect(sessions().filter((s) => s.state === State.Stopped)).toHaveLength(3);
        });
        t.h.container.get(ViewsServiceDIToken).setViewVisible(VARIABLES_VIEW_ID, true);
        // The app's frame is focused: its locals.
        await vi.waitFor(() => {
            expect(variables()).toMatch(/ sum: /u);
        });
    }

    async function pick(command: string, typed: string): Promise<void> {
        const quickInput = t.h.container.get(QuickInputComponentDIToken);
        const run = t.h.commands.execute(command);
        await vi.waitFor(() => {
            expect(quickInput.isOpen()).toBe(true);
        });
        typeText(t.h.testApp, typed);
        t.h.testApp.sendKey("Enter");
        await run;
    }

    it.each(PICKERS)("%s: VARIABLES show the picked worker's locals", async (command) => {
        markWorkers(false);
        await startWithWorkers();

        await pick(command, "task B");

        await vi.waitFor(() => {
            expect(variables()).toContain("w_sum: ");
        });
    });

    it.each(PICKERS)(
        "%s: a worker whose frames have no source — its session, no frame, not the app's locals",
        async (command) => {
            markWorkers(true);
            await startWithWorkers();

            await pick(command, "task B");

            await vi.waitFor(() => {
                expect(t.h.container.get(DebugServiceDIToken).getViewModel().focusedSession?.name).toBe("task B");
            });
            expect(t.h.container.get(DebugServiceDIToken).getViewModel().focusedStackFrame).toBeUndefined();
            await vi.waitFor(() => {
                expect(variables()).not.toMatch(/ sum: /u);
            });
        },
    );

    it("the toolbar's Focus Session (workbench.action.debug.focusProcess): a worker whose frames have no source — its session, no frame", async () => {
        // With the setting the toolbar's select lists the workers; picking one runs Focus Session with it.
        await t.h.container.get(IConfigurationServiceDIToken).updateValue("debug.showSubSessionsInToolBar", true);
        markWorkers(true);
        await startWithWorkers();
        const worker = sessions().find((s) => s.name === "task B")!;

        await t.h.commands.execute("workbench.action.debug.focusProcess", worker);

        expect(t.h.container.get(DebugServiceDIToken).getViewModel().focusedSession?.name).toBe("task B");
        expect(t.h.container.get(DebugServiceDIToken).getViewModel().focusedStackFrame).toBeUndefined();
        await vi.waitFor(() => {
            expect(variables()).not.toMatch(/ sum: /u);
        });
    });
});
