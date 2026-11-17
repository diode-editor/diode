// More context menus of the debug views on the synthetic debugger: a thread's, a breakpoint's and the Debug
// Console's; the keys of the VARIABLES and WATCH commands; an error of Set Value; Set Value of a watch expression.

import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import type { MenuEntry } from "@tuidom/elements/menu/popupMenuElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugViewletHarness, type IDebugViewletHarness } from "../../../../../TestUtils/debugViewletHarness.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { ClipboardDIToken } from "../../../../platform/clipboard/common/iClipboard.ts";
import { ContextMenuServiceDIToken } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import {
    BREAKPOINTS_VIEW_ID,
    CALLSTACK_VIEW_ID,
    REPL_VIEW_ID,
    VARIABLES_VIEW_ID,
    WATCH_VIEW_ID,
} from "../common/debug.ts";
import type { Thread } from "../common/debugModel.ts";

import { DebugServiceDIToken } from "./debugService.ts";
import { DebugViewletComponentDIToken } from "./debugViewlet.ts";
import { ReplDIToken } from "./repl.ts";

describe("Run and Debug: more context menus and the keys of the rows", () => {
    let t: IDebugViewletHarness;
    let shown: MenuEntry[][];

    beforeEach(async () => {
        t = await createDebugViewletHarness(process.cwd());
        shown = [];
        const contextMenu = t.h.container.get(ContextMenuServiceDIToken);
        const show = contextMenu.showContextMenu.bind(contextMenu);
        vi.spyOn(contextMenu, "showContextMenu").mockImplementation((delegate) => {
            shown.push(delegate.getEntries?.() ?? []);
            show(delegate);
        });
        await t.startStopped();
        await vi.waitFor(() => {
            expect(t.screen()).toContain("count: 0");
            // The threads are read; the screen may have no room left for them under the stopped thread's frames.
            const session = t.h.container.get(DebugServiceDIToken).getViewModel().focusedSession;
            expect(session?.getAllThreads().map((thread) => thread.name)).toContain("worker-2");
        });
    });

    afterEach(async () => {
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

    async function menuAt(text: string, which: "first" | "last" = "first"): Promise<string[]> {
        const before = shown.length;
        const lines = t.lines();
        const y =
            which === "first"
                ? lines.findIndex((line) => line.includes(text))
                : lines.findLastIndex((line) => line.includes(text));
        expect(y, `"${text}" on screen`).toBeGreaterThanOrEqual(0);
        mouse(lines[y].indexOf(text), y, "right");
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

    function clipboard(): Promise<string> {
        return t.h.container.get(ClipboardDIToken).readText();
    }

    it("a stopped thread: Continue and the steps, then Terminate Thread; the item acts on that thread", async () => {
        t.h.container.get(ViewsServiceDIToken).openView(CALLSTACK_VIEW_ID, true);
        const session = t.h.container.get(DebugServiceDIToken).getViewModel().focusedSession;
        const worker = session?.getAllThreads().find((thread) => thread.name === "worker-2");
        t.h.container.get(DebugViewletComponentDIToken).callStack.tree.reveal(worker as Thread);
        await vi.waitFor(() => {
            expect(t.screen()).toContain("worker-2");
        });
        expect(await menuAt("worker-2")).toEqual([
            "Continue",
            "Step Over",
            "Step Into",
            "Step Out",
            "-",
            "Terminate Thread",
        ]);
        choose("Terminate Thread");
        await vi.waitFor(() => {
            expect(session?.getAllThreads().map((thread) => thread.name)).not.toContain("worker-2");
        });
    });

    it("a breakpoint: Remove Breakpoint takes that row; the commands of all breakpoints follow", async () => {
        const debugService = t.h.container.get(DebugServiceDIToken);
        await debugService.addBreakpoints(Uri.file("/home/user/hello/src/main.cpp"), [
            { lineNumber: 5 },
            { lineNumber: 9 },
        ]);
        await debugService.addFunctionBreakpoint({ name: "accumulate" });
        t.h.container.get(ViewsServiceDIToken).openView(BREAKPOINTS_VIEW_ID, true);
        await vi.waitFor(() => {
            expect(t.screen()).toContain("accumulate");
        });

        // An exception filter has only its condition, which `cpp_throw` takes.
        expect(await menuAt("C++: on throw")).toEqual(["Edit Condition..."]);
        t.h.container.get(ContextMenuServiceDIToken).hideContextMenu();
        expect(await menuAt("accumulate", "last")).toEqual([
            "Edit Condition...",
            "Edit Function Condition...",
            "Edit Hit Count...",
            "-",
            "Remove Breakpoint",
            "Remove All Breakpoints",
            "-",
            "Enable All Breakpoints",
            "Disable All Breakpoints",
            "Reapply All Breakpoints",
        ]);
        choose("Remove Breakpoint");
        await vi.waitFor(() => {
            expect(debugService.getModel().getFunctionBreakpoints()).toHaveLength(0);
        });
        expect(debugService.getModel().getBreakpoints()).toHaveLength(2);
    });

    it("the Debug Console: Copy and Copy All of the rows, Paste into the input, Clear Console", async () => {
        const repl = t.h.container.get(ReplDIToken);
        t.h.container.get(ViewsServiceDIToken).openView(REPL_VIEW_ID, true);
        t.h.container.get(ReplDIToken).focus();
        for (const char of "count + 1") t.h.testApp.sendKey(char === " " ? "Space" : char);
        t.h.testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(t.lines().some((line) => line.replace(/[█░▀▄]/gu, "").trim() === "1")).toBe(true);
        });

        expect(await menuAt("count + 1", "last")).toEqual([
            "Copy",
            "Copy All",
            "Paste",
            "-",
            "Collapse All",
            "Clear Console",
        ]);
        choose("Copy");
        await vi.waitFor(async () => {
            expect(await clipboard()).toBe("count + 1");
        });
        await menuAt("count + 1", "last");
        choose("Copy All");
        await vi.waitFor(async () => {
            expect(await clipboard()).toContain("count + 1\n1\n");
        });

        await t.h.container.get(ClipboardDIToken).writeText("sum");
        await menuAt("count + 1", "last");
        choose("Paste");
        await vi.waitFor(() => {
            expect(repl.input.inputState.value).toBe("sum");
        });
        expect(repl.input.isFocused).toBe(true);

        await menuAt("count + 1", "last");
        choose("Clear Console");
        await vi.waitFor(() => {
            expect(t.screen()).not.toContain("count + 1");
        });
    });

    it("Ctrl+C copies the value under the cursor of VARIABLES; Ctrl+Alt+C the expression of WATCH", async () => {
        t.h.container.get(ViewsServiceDIToken).openView(VARIABLES_VIEW_ID, true);
        const at = t.find("count: 0");
        mouse(at.x, at.y, "left");
        await t.h.container.get(ClipboardDIToken).writeText("");
        t.h.testApp.sendKey("Ctrl+c");
        await vi.waitFor(async () => {
            expect(await clipboard()).toBe("0");
        });

        t.h.container.get(DebugServiceDIToken).addWatchExpression("total");
        t.h.container.get(ViewsServiceDIToken).openView(WATCH_VIEW_ID, true);
        await vi.waitFor(() => {
            expect(t.lines().filter((line) => line.includes("total: "))).toHaveLength(2);
        });
        const lines = t.lines();
        const y = lines.findLastIndex((line) => line.includes("total: "));
        mouse(lines[y].indexOf("total"), y, "left");
        t.h.testApp.sendKey("Ctrl+Alt+c");
        await vi.waitFor(async () => {
            expect(await clipboard()).toBe("total");
        });
    });

    it("an error of Set Value keeps the input open with the adapter's message; Escape gives up", async () => {
        await menuAt("count: 0");
        choose("Set Value");
        for (const char of "abc") t.h.testApp.sendKey(char);
        t.h.testApp.sendKey("Enter");

        await vi.waitFor(() => {
            expect(t.screen()).toContain("error: 'abc' is not a number");
        });
        t.h.testApp.sendKey("Escape");
        await vi.waitFor(() => {
            expect(t.screen()).toContain("count: 0");
            expect(t.screen()).not.toContain("is not a number");
        });
    });

    it("Set Value of a watch expression sets it through the adapter; both views show the new value", async () => {
        t.h.container.get(DebugServiceDIToken).addWatchExpression("count");
        await vi.waitFor(() => {
            expect(t.lines().filter((line) => line.includes("count: 0"))).toHaveLength(2);
        });
        t.h.container.get(ViewsServiceDIToken).openView(WATCH_VIEW_ID, true);
        expect(await menuAt("count: 0", "last")).toContain("Set Value");
        choose("Set Value");
        t.h.testApp.sendKey("9");
        t.h.testApp.sendKey("Enter");

        await vi.waitFor(() => {
            expect(t.lines().filter((line) => line.includes("count: 9"))).toHaveLength(2);
        });
    });
});
