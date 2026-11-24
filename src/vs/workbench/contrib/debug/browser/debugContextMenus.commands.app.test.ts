// The commands of the debug rows' menus run the way a key, a menu or an extension runs them, on the synthetic
// debugger: what each does with no row, another row kind, an adapter error; the call stack contexts the items get.

import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import type { MenuEntry } from "@tuidom/elements/menu/popupMenuElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugViewletHarness, type IDebugViewletHarness } from "../../../../../TestUtils/debugViewletHarness.ts";
import { setUnexpectedErrorHandler } from "../../../../base/common/errors.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { MenuRegistryDIToken } from "../../../../platform/actions/common/menuRegistry.ts";
import { ClipboardDIToken } from "../../../../platform/clipboard/common/iClipboard.ts";
import { ContextMenuServiceDIToken } from "../../../../platform/contextview/browser/contextMenuService.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { registerExtensionMenus } from "../../../services/extensions/common/extensionMenuContributor.ts";
import {
    CALLSTACK_VIEW_ID,
    DataBreakpointSetType,
    type IDebugSession,
    REPL_VIEW_ID,
    VARIABLES_VIEW_ID,
    WATCH_VIEW_ID,
} from "../common/debug.ts";
import type { DebugModel, StackFrame, Thread } from "../common/debugModel.ts";
import type { ViewModel } from "../common/debugViewModel.ts";

import { getContext, getContextForContributedActions } from "./callStackView.ts";
import { DebugServiceDIToken } from "./debugService.ts";
import { DebugViewletComponentDIToken } from "./debugViewlet.ts";
import { ReplDIToken } from "./repl.ts";

describe("Run and Debug: the commands of the rows' menus", () => {
    let t: IDebugViewletHarness;
    let shown: MenuEntry[][];

    beforeEach(async () => {
        // The sidebar's frame, its container line and the lines around the section headers take 11 rows: the
        // sections keep the heights they had in 50, where a watch's member is on screen.
        t = await createDebugViewletHarness(process.cwd(), undefined, { height: 61 });
        shown = [];
        const contextMenu = t.h.container.get(ContextMenuServiceDIToken);
        const show = contextMenu.showContextMenu.bind(contextMenu);
        vi.spyOn(contextMenu, "showContextMenu").mockImplementation((delegate) => {
            shown.push(delegate.getEntries?.() ?? []);
            show(delegate);
        });
    });

    afterEach(async () => {
        setUnexpectedErrorHandler(() => undefined);
        await t.dispose();
    });

    function mouse(x: number, y: number, button: MouseToken["button"]): void {
        for (const action of ["press", "release"] as const) {
            t.h.testApp.backend.simulateMouse({
                kind: "mouse",
                button,
                action,
                x: x + 1,
                y: y + 1,
                shiftKey: false,
                altKey: false,
                ctrlKey: false,
                raw: "",
            });
        }
    }

    function rowOf(text: string, which: "first" | "last" = "first"): { x: number; y: number } {
        const lines = t.lines();
        const y =
            which === "first"
                ? lines.findIndex((line) => line.includes(text))
                : lines.findLastIndex((line) => line.includes(text));
        expect(y, `"${text}" on screen`).toBeGreaterThanOrEqual(0);
        return { x: lines[y].indexOf(text), y };
    }

    async function menuAt(text: string, which: "first" | "last" = "first"): Promise<string[]> {
        const before = shown.length;
        const { x, y } = rowOf(text, which);
        mouse(x, y, "right");
        await vi.waitFor(() => {
            expect(shown.length).toBe(before + 1);
        });
        return (shown.at(-1) ?? []).map((entry) => (entry.type === "separator" ? "-" : entry.label));
    }

    function choose(label: string): void {
        const entry = shown.at(-1)?.find((e) => e.type !== "separator" && e.type !== "submenu" && e.label === label);
        expect(entry, `"${label}" in the menu`).toBeDefined();
        t.h.container.get(ContextMenuServiceDIToken).hideContextMenu();
        (entry as { onSelect: () => void }).onSelect();
    }

    async function startStopped(): Promise<void> {
        await t.startStopped();
        await vi.waitFor(() => {
            expect(t.screen()).toContain("count: 0");
            // The threads are read; the screen may have no room left for this one under the stopped thread's frames.
            const session = t.h.container.get(DebugServiceDIToken).getViewModel().focusedSession;
            expect(session?.getAllThreads().map((thread) => thread.name)).toContain("worker-2");
        });
    }

    function clipboard(): Promise<string> {
        return t.h.container.get(ClipboardDIToken).readText();
    }

    function model(): DebugModel {
        return t.h.container.get(DebugServiceDIToken).getModel() as DebugModel;
    }

    it("without a session: no frame to copy, no data breakpoint info, no row to copy", async () => {
        const clip = t.h.container.get(ClipboardDIToken);
        await clip.writeText("before");
        await t.h.commands.execute("debug.copyStackTrace");
        await t.h.commands.execute("debug.breakWhenValueChanges");
        await t.h.commands.execute("workbench.debug.viewlet.action.copyValue");
        await t.h.commands.execute("debug.replCopy");
        expect(await clipboard()).toBe("before");
        expect(model().getDataBreakpoints()).toEqual([]);
    });

    it("Copy Value of a watch expression with a session but no frame (it runs) copies nothing", async () => {
        await startStopped();
        const debugService = t.h.container.get(DebugServiceDIToken);
        debugService.addWatchExpression("total");
        const viewModel = debugService.getViewModel();
        (viewModel as ViewModel).setFocus(undefined, undefined, viewModel.focusedSession, false);
        await t.h.container.get(ClipboardDIToken).writeText("before");
        await t.h.commands.execute("workbench.debug.viewlet.action.copyValue", model().getWatchExpressions()[0]);
        expect(await clipboard()).toBe("before");
    });

    it("Copy Value: a watch row from its menu, an error copies the shown value; from WATCH by Ctrl+C", async () => {
        await startStopped();
        const debugService = t.h.container.get(DebugServiceDIToken);
        debugService.addWatchExpression("nope");
        debugService.addWatchExpression("total");
        t.h.container.get(ViewsServiceDIToken).openView(WATCH_VIEW_ID, true);
        await vi.waitFor(() => {
            expect(t.lines().filter((line) => line.includes("total: "))).toHaveLength(2);
        });

        await menuAt("nope", "last");
        choose("Copy Value");
        await vi.waitFor(async () => {
            expect(await clipboard()).toContain("undeclared identifier 'nope'");
        });

        const total = rowOf("total: ", "last");
        mouse(total.x, total.y, "left");
        t.h.testApp.sendKey("Ctrl+c");
        await vi.waitFor(async () => {
            expect(await clipboard()).toBe(/total: (\d+)/u.exec(t.lines()[total.y])?.[1]);
        });
    });

    it("Copy Value with the focus outside the views does nothing; F2 on a scope sets nothing", async () => {
        await startStopped();
        await t.h.container.get(ClipboardDIToken).writeText("before");
        t.h.container.get(ViewsServiceDIToken).openView(CALLSTACK_VIEW_ID, true);
        await t.h.commands.execute("workbench.debug.viewlet.action.copyValue");
        expect(await clipboard()).toBe("before");

        t.h.container.get(ViewsServiceDIToken).openView(VARIABLES_VIEW_ID, true);
        const scope = rowOf("Locals");
        mouse(scope.x, scope.y, "left");
        t.h.testApp.sendKey("F2");
        await t.h.commands.execute("workbench.debug.viewlet.action.copyValue");
        expect(t.h.container.get(DebugServiceDIToken).getViewModel().getSelectedExpression()).toBeUndefined();
        expect(await clipboard()).toBe("before");
    });

    it("a watch child without an evaluate name: the data breakpoint by its name and container", async () => {
        await startStopped();
        t.h.container.get(DebugServiceDIToken).addWatchExpression("flags");
        t.h.container.get(ViewsServiceDIToken).openView(WATCH_VIEW_ID, true);
        await vi.waitFor(() => {
            expect(t.lines().filter((line) => line.includes("flags: "))).toHaveLength(2);
        });
        const flags = rowOf("flags: ", "last");
        mouse(flags.x, flags.y, "left");
        t.h.testApp.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(t.lines().filter((line) => line.includes('["verbose"]'))).not.toHaveLength(0);
        });

        await menuAt('["verbose"]', "last");
        choose("Break on Value Change");
        await vi.waitFor(() => {
            expect(model().getDataBreakpoints()).toMatchObject([
                { description: '["verbose"]', src: { type: DataBreakpointSetType.Variable } },
            ]);
        });

        // A child with one: Copy as Expression gets the variable itself from WATCH.
        await menuAt('["debug"]', "last");
        choose("Copy as Expression");
        await vi.waitFor(async () => {
            expect(await clipboard()).toBe('flags["debug"]');
        });
    });

    it("Set Value of a watch expression: Escape sets nothing", async () => {
        await startStopped();
        t.h.container.get(DebugServiceDIToken).addWatchExpression("count");
        t.h.container.get(ViewsServiceDIToken).openView(WATCH_VIEW_ID, true);
        await vi.waitFor(() => {
            expect(t.lines().filter((line) => line.includes("count: 0"))).toHaveLength(2);
        });
        await menuAt("count: 0", "last");
        choose("Set Value");
        t.h.testApp.sendKey("Escape");
        await vi.waitFor(() => {
            expect(t.lines().filter((line) => line.includes("count: 0"))).toHaveLength(2);
        });
        expect(t.h.container.get(DebugServiceDIToken).getViewModel().getSelectedExpression()).toBeUndefined();
        // An emptied input sets nothing either.
        await menuAt("count: 0", "last");
        choose("Set Value");
        t.h.testApp.sendKey("Backspace");
        t.h.testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(t.lines().filter((line) => line.includes("count: 0"))).toHaveLength(2);
        });
        const requests = t.registerDebugger().adapters[0].requests.map((r) => r.command);
        expect(requests).not.toContain("setExpression");
    });

    it("a right click on no row: BREAKPOINTS offers the commands of all breakpoints, the others nothing", async () => {
        await startStopped();
        await t.h.container
            .get(DebugServiceDIToken)
            .addBreakpoints(Uri.file("/home/user/hello/src/main.cpp"), [{ lineNumber: 5 }]);
        const component = t.h.container.get(DebugViewletComponentDIToken);
        const before = shown.length;
        component.watch.tree.onContextMenu(undefined, 0, 0);
        component.variables.tree.onContextMenu(undefined, 0, 0);
        component.callStack.tree.onContextMenu(undefined, 0, 0);
        expect(shown.slice(before).flat()).toEqual([]);

        component.breakpoints.tree.onContextMenu(undefined, 0, 0);
        expect((shown.at(-1) ?? []).map((entry) => (entry.type === "separator" ? "-" : entry.label))).toEqual([
            // As upstream: no row is not an exception filter; Remove Breakpoint then has nothing to remove.
            "Remove Breakpoint",
            "Remove All Breakpoints",
            "-",
            "Enable All Breakpoints",
            "Disable All Breakpoints",
            "Reapply All Breakpoints",
        ]);
    });

    it("Remove Breakpoint from the menu takes every kind of breakpoint", async () => {
        await startStopped();
        const debugService = t.h.container.get(DebugServiceDIToken);
        const [source] = await debugService.addBreakpoints(Uri.file("/home/user/hello/src/main.cpp"), [
            { lineNumber: 5 },
        ]);
        await debugService.addDataBreakpoint({
            description: "count",
            src: { type: DataBreakpointSetType.Variable, dataId: "1:count" },
            canPersist: false,
            accessTypes: undefined,
            accessType: "write",
        });
        model().addInstructionBreakpoint({ instructionReference: "0x10", offset: 0, address: 16n, canPersist: false });
        const remove = (element: unknown): Promise<unknown> =>
            Promise.resolve(t.h.commands.execute("workbench.debug.viewlet.action.removeBreakpoint", element));

        // An exception filter is not a breakpoint to remove: the others stay.
        await remove(model().getExceptionBreakpoints()[0]);
        expect(model().getInstructionBreakpoints()).toHaveLength(1);
        await remove(source);
        await remove(model().getDataBreakpoints()[0]);
        await remove(model().getInstructionBreakpoints()[0]);

        expect(model().getBreakpoints()).toEqual([]);
        expect(model().getDataBreakpoints()).toEqual([]);
        expect(model().getInstructionBreakpoints()).toEqual([]);
        expect(model().getExceptionBreakpoints()).toHaveLength(2);
    });

    it("Copy of an evaluation in the Debug Console asks the adapter for the clipboard form", async () => {
        await startStopped();
        t.h.container.get(ViewsServiceDIToken).openView(REPL_VIEW_ID, true);
        const repl = t.h.container.get(ReplDIToken);
        repl.focus();
        for (const char of "count") t.h.testApp.sendKey(char);
        t.h.testApp.sendKey("Enter");
        // The console's own columns of a screen row, without the scrollbar.
        const consoleText = (line: string): string => {
            const left = repl.view.globalPosition.x;
            return line
                .slice(left, left + repl.view.layoutSize.width)
                .replace(/[█░▀▄]/gu, "")
                .trim();
        };
        await vi.waitFor(() => {
            expect(t.lines().some((line) => consoleText(line) === "0")).toBe(true);
        });
        const answer = t.lines().findLastIndex((line) => consoleText(line) === "0");
        const x = t.lines()[answer].indexOf("0", repl.view.globalPosition.x);
        mouse(x, answer, "right");
        await vi.waitFor(() => {
            expect(shown.at(-1)?.length).toBeGreaterThan(0);
        });
        choose("Copy");
        await vi.waitFor(async () => {
            expect(await clipboard()).toBe("0");
        });
        const evaluates = t.registerDebugger().adapters[0].requests.filter((r) => r.command === "evaluate");
        expect(evaluates.at(-1)?.arguments).toMatchObject({ expression: "count", context: "clipboard" });
    });

    it("the contexts of a session, a thread and a frame without a file, and of no row", async () => {
        await startStopped();
        const debugService = t.h.container.get(DebugServiceDIToken);
        const session = debugService.getViewModel().focusedSession!;
        const worker = session.getAllThreads().find((thread) => thread.name === "worker-2") as Thread;
        await worker.fetchCallStack();
        const futex = worker.getCallStack()[0] as StackFrame;

        expect(getContext(session)).toEqual({ sessionId: session.getId() });
        expect(getContextForContributedActions(session)).toBe(session.getId());
        expect(getContext(worker)).toEqual({ sessionId: session.getId(), threadId: worker.getId() });
        expect(getContextForContributedActions(worker)).toBe(worker.threadId);
        expect(futex.source.inMemory).toBe(true);
        expect(getContextForContributedActions(futex)).toBe(futex.source.name);
        expect(getContext(futex)).toEqual({
            sessionId: session.getId(),
            threadId: worker.getId(),
            frameId: futex.getId(),
            frameName: futex.name,
            frameLocation: { range: futex.range, source: futex.source.raw },
        });
        expect(getContext(null)).toBeUndefined();
        expect(getContextForContributedActions(null)).toBe("");
    });

    it("an extension's command that fails from a menu is reported, not thrown", async () => {
        await startStopped();
        const reported: unknown[] = [];
        setUnexpectedErrorHandler((error) => reported.push(error));
        t.h.commands.register("demo.fails", () => {
            throw new Error("boom");
        });
        const extension = {
            id: "test.demo",
            isBuiltin: false,
            manifest: {
                contributes: { menus: { "debug/variables/context": [{ command: "demo.fails", title: "Fail" }] } },
            },
        } as unknown as IExtension;
        const registration = registerExtensionMenus([extension], t.h.container.get(MenuRegistryDIToken));
        try {
            await menuAt("count: 0");
            choose("Fail");
            expect(String(reported[0])).toContain("boom");
        } finally {
            registration.dispose();
        }
    });
});
