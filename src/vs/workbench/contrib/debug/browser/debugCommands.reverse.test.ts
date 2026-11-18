// The rest of upstream's `debugCommands.ts`: stepping back and reversing, Disconnect and Suspend, Open Loaded Script,
// Toggle Exception Breakpoints, Enable or Disable Breakpoint at the cursor and the views' focus commands.

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { createDebugServiceFixture, type IDebugServiceFixture } from "../../../../../TestUtils/debugServiceFixture.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_LAUNCH_CONFIG,
    SYNTHETIC_PROGRAM_ROOT,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { ServiceAccessor, Token } from "../../../../platform/instantiation/common/diContainer.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { type IDebugSession, State } from "../common/debug.ts";
import type { DebugModel, Thread } from "../common/debugModel.ts";

import { BreakpointSourcesDIToken } from "./breakpointsView.ts";
import {
    DEBUG_ACTIONS,
    disconnectAndSuspendAction,
    enableOrDisableBreakpointAction,
    FOCUS_VIEW_ACTIONS,
    reverseContinueAction,
    showLoadedScriptsAction,
    startFromConfigAction,
    stepBackAction,
    toggleExceptionBreakpointsAction,
} from "./debugCommands.ts";
import { DebugServiceDIToken, DebugServicePortsDIToken } from "./debugService.ts";

describe("debug commands: the rest of upstream's", () => {
    let fx: IDebugServiceFixture;
    let factory: SyntheticDebugAdapterFactory;
    let accessor: ServiceAccessor;
    let quickPick: Mock<(opts: { items: QuickPickItem[] }) => Promise<QuickPickItem | undefined>>;
    let quickPickMany: Mock<(opts: { items: QuickPickItem[] }) => Promise<QuickPickItem[] | undefined>>;
    let views: { openView: ReturnType<typeof vi.fn>; openViewContainer: ReturnType<typeof vi.fn> };
    let sources: { uriLabel: (uri: Uri) => string; openSource: ReturnType<typeof vi.fn> };
    let activeEditor: { uri: Uri; primaryCursorLine: number } | null;

    beforeEach(() => {
        fx = createDebugServiceFixture();
        factory = registerSyntheticDebugger(fx.service.getAdapterManager(), NO_DELAY_TIMING).factory;
        quickPick = vi.fn<(opts: { items: QuickPickItem[] }) => Promise<QuickPickItem | undefined>>();
        quickPick.mockResolvedValue(undefined);
        quickPickMany = vi.fn<(opts: { items: QuickPickItem[] }) => Promise<QuickPickItem[] | undefined>>();
        quickPickMany.mockResolvedValue(undefined);
        views = { openView: vi.fn(), openViewContainer: vi.fn() };
        sources = {
            uriLabel: (uri) => uri.path.slice(SYNTHETIC_PROGRAM_ROOT.length + 1),
            openSource: vi.fn().mockResolvedValue(undefined),
        };
        activeEditor = null;
        const services = new Map<Token<unknown>, unknown>([
            [DebugServiceDIToken, fx.service],
            [DebugServicePortsDIToken, fx.ports],
            [QuickInputServiceDIToken, { quickPick, quickPickMany }],
            [ViewsServiceDIToken, views],
            [BreakpointSourcesDIToken, sources],
            [EditorServiceDIToken, { getActiveEditor: () => activeEditor }],
        ]);
        accessor = {
            get: <T>(token: Token<T>): T => {
                if (!services.has(token)) throw new Error(`unexpected ${token.id}`);
                return services.get(token) as T;
            },
        };
    });

    afterEach(async () => {
        await fx.service.stopSession(undefined);
        factory.adapters.forEach((a) => {
            a.dispose();
        });
        fx.service.dispose();
    });

    async function startStopped(): Promise<IDebugSession> {
        await startFromConfigAction.run(accessor, SYNTHETIC_LAUNCH_CONFIG);
        await vi.waitFor(() => {
            expect(fx.service.state).toBe(State.Stopped);
        });
        return fx.service.getModel().getSessions()[0];
    }

    it("are upstream's ids", () => {
        expect(DEBUG_ACTIONS.map((a) => a.id)).toEqual(
            expect.arrayContaining([
                "workbench.action.debug.stepBack",
                "workbench.action.debug.reverseContinue",
                "workbench.action.debug.disconnectAndSuspend",
                "workbench.action.debug.showLoadedScripts",
                "debug.toggleExceptionBreakpoints",
                "debug.enableOrDisableBreakpoint",
                "workbench.debug.action.focusVariablesView",
                "workbench.debug.action.focusWatchView",
                "workbench.debug.action.focusCallStackView",
                "workbench.debug.action.focusBreakpointsView",
            ]),
        );
    });

    describe("Step Back and Reverse", () => {
        it.each([
            [stepBackAction, "stepBack"],
            [reverseContinueAction, "reverseContinue"],
        ] as const)("%# runs on the focused thread", async (action, method) => {
            await startStopped();
            const thread = fx.service.getViewModel().focusedThread as Thread;
            const spy = vi.spyOn(thread, method).mockResolvedValue(undefined);

            await action.run(accessor);

            expect(spy).toHaveBeenCalledOnce();
        });

        it("are toolbar buttons only with an adapter that steps back, enabled when stopped", () => {
            for (const action of [stepBackAction, reverseContinueAction]) {
                const button = action.menus?.find((m) => m.menuId === MenuId.DebugToolBar);
                expect(button).toMatchObject({ when: "stepBackSupported", enablement: "debugState == 'stopped'" });
                expect(action.menus?.find((m) => m.menuId === MenuId.CommandPalette)?.when).toBe("false");
            }
        });
    });

    describe("Disconnect and Suspend", () => {
        it("disconnects the call stack row's session and asks the debuggee to suspend", async () => {
            const session = await startStopped();
            const stop = vi.spyOn(fx.service, "stopSession");

            await disconnectAndSuspendAction.run(accessor, undefined, { sessionId: session.getId() });

            expect(stop).toHaveBeenCalledWith(session, true, true);
        });

        it("is in the palette while debugging and on a session's row with an adapter that suspends", () => {
            const palette = disconnectAndSuspendAction.menus?.find((m) => m.menuId === MenuId.CommandPalette);
            expect(palette).toMatchObject({
                when: "debuggersAvailable && inDebugMode",
                enablement: "focusedSessionIsAttach || (suspendDebuggeeSupported && terminateDebuggeeSupported)",
            });
            const row = disconnectAndSuspendAction.menus?.find((m) => m.menuId === MenuId.DebugCallStackContext);
            expect(row).toMatchObject({
                when: "callStackItemType == 'session' && suspendDebuggeeSupported && terminateDebuggeeSupported",
                group: "3_modification",
                order: 21,
            });
        });
    });

    describe("Open Loaded Script", () => {
        it("lists the loaded sources by name, folder and session; the picked one opens", async () => {
            await startStopped();
            quickPick.mockImplementation((opts: { items: QuickPickItem[] }) =>
                Promise.resolve(opts.items.find((item) => item.label === "list.cpp")),
            );

            await showLoadedScriptsAction.run(accessor);

            const [[opts]] = quickPick.mock.calls as [[{ placeholder: string; items: QuickPickItem[] }]];
            expect(opts.placeholder).toBe("Search loaded scripts by name");
            expect(opts.items.map((i) => [i.label, i.description, i.hint])).toEqual([
                ["main.cpp", "src", "Launch hello (lldb)"],
                ["list.cpp", "src", "Launch hello (lldb)"],
                ["queue.cpp", "src", "Launch hello (lldb)"],
            ]);
            const [[uri]] = sources.openSource.mock.calls as [[Uri]];
            expect(uri.toString()).toBe(Uri.file(`${SYNTHETIC_PROGRAM_ROOT}/src/list.cpp`).toString());
        });

        it("is in the palette while a session has loaded scripts", () => {
            expect(showLoadedScriptsAction.menus?.[0]).toMatchObject({
                when: "debuggersAvailable && inDebugMode",
                enablement: "loadedScriptsSupported",
            });
        });
    });

    describe("Toggle Exception Breakpoints", () => {
        it("checks the session's filters in a picker and toggles the ones whose check changed", async () => {
            const session = await startStopped();
            const [onThrow, onCatch] = fx.service.getModel().getExceptionBreakpointsForSession(session.getId());
            await fx.service.enableOrDisableBreakpoints(true, onThrow);
            quickPickMany.mockImplementation((opts: { items: QuickPickItem[] }) =>
                Promise.resolve(opts.items.filter((item) => item.label === "C++: on catch")),
            );

            await toggleExceptionBreakpointsAction.run(accessor);

            const [[opts]] = quickPickMany.mock.calls as [
                [{ placeholder: string; items: QuickPickItem[]; picked: QuickPickItem[] }],
            ];
            expect(opts.placeholder).toBe("Pick enabled exception breakpoints");
            expect(opts.items.map((i) => i.label)).toEqual(["C++: on throw", "C++: on catch"]);
            expect(opts.picked.map((i) => i.label)).toEqual(["C++: on throw"]);
            expect([onThrow.enabled, onCatch.enabled]).toEqual([false, true]);
        });

        it("a filter whose check stays is not toggled", async () => {
            const session = await startStopped();
            const [onThrow, onCatch] = fx.service.getModel().getExceptionBreakpointsForSession(session.getId());
            await fx.service.enableOrDisableBreakpoints(true, onThrow);
            const toggle = vi.spyOn(fx.service, "enableOrDisableBreakpoints");
            quickPickMany.mockImplementation((opts: { items: QuickPickItem[] }) => Promise.resolve(opts.items));

            await toggleExceptionBreakpointsAction.run(accessor);

            expect(toggle.mock.calls).toEqual([[true, onCatch]]);
            expect([onThrow.enabled, onCatch.enabled]).toEqual([true, true]);
        });

        it("takes the focused session's filters over the first session's", async () => {
            await startStopped();
            const model = fx.service.getModel() as DebugModel;
            model.setExceptionBreakpointsForSession("focused", [{ filter: "all", label: "All" }]);
            const [all] = model.getExceptionBreakpointsForSession("focused");
            vi.spyOn(fx.service.getViewModel(), "focusedSession", "get").mockReturnValue({
                getId: () => "focused",
            } as IDebugSession);

            await toggleExceptionBreakpointsAction.run(accessor);

            expect(all.enabled).toBe(true);
            expect(quickPickMany).not.toHaveBeenCalled();
        });

        it("a cancelled picker changes nothing", async () => {
            const session = await startStopped();
            const filters = fx.service.getModel().getExceptionBreakpointsForSession(session.getId());

            await toggleExceptionBreakpointsAction.run(accessor);

            expect(filters.map((f) => f.enabled)).toEqual([false, false]);
        });

        it("toggles a lone filter at once, and does nothing without one", async () => {
            await toggleExceptionBreakpointsAction.run(accessor);
            expect(quickPickMany).not.toHaveBeenCalled();

            const model = fx.service.getModel() as DebugModel;
            model.setExceptionBreakpointsForSession("s", [{ filter: "all", label: "All" }]);
            model.setExceptionBreakpointFallbackSession("s");
            const [all] = model.getExceptionBreakpoints();
            await toggleExceptionBreakpointsAction.run(accessor);

            expect(all.enabled).toBe(true);
            expect(quickPickMany).not.toHaveBeenCalled();
        });
    });

    describe("Enable or Disable Breakpoint", () => {
        it("toggles the breakpoint of the cursor's line; nothing without an editor", async () => {
            const uri = Uri.file("/w/a.cpp");
            await fx.service.addBreakpoints(uri, [{ lineNumber: 3 }]);
            const [bp] = fx.service.getModel().getBreakpoints();

            await enableOrDisableBreakpointAction.run(accessor);
            expect(bp.enabled).toBe(true);

            activeEditor = { uri, primaryCursorLine: 1 };
            await enableOrDisableBreakpointAction.run(accessor);
            expect(bp.enabled).toBe(true);

            activeEditor = { uri, primaryCursorLine: 2 };
            await enableOrDisableBreakpointAction.run(accessor);
            expect(bp.enabled).toBe(false);
            await enableOrDisableBreakpointAction.run(accessor);
            expect(bp.enabled).toBe(true);
        });

        it("has no keys and is not in the palette", () => {
            expect(enableOrDisableBreakpointAction.keybinding).toBeUndefined();
            expect(enableOrDisableBreakpointAction.menus?.[0].when).toBe("false");
        });
    });

    it("the views' focus commands open and focus their view", () => {
        for (const action of FOCUS_VIEW_ACTIONS) void action.run(accessor);

        expect(views.openView.mock.calls).toEqual([
            ["workbench.debug.variablesView", true],
            ["workbench.debug.watchExpressionsView", true],
            ["workbench.debug.callStackView", true],
            ["workbench.debug.breakPointsView", true],
        ]);
        expect(FOCUS_VIEW_ACTIONS.map((a) => a.title)).toEqual([
            "Run and Debug: Focus on Variables View",
            "Run and Debug: Focus on Watch View",
            "Run and Debug: Focus on Call Stack View",
            "Run and Debug: Focus on Breakpoints View",
        ]);
    });
});
