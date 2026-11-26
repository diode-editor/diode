// The context menus of the Run and Debug rows on the synthetic debugger: a right click or Shift+F10 opens upstream's
// items for the row (VARIABLES, WATCH, CALL STACK, BREAKPOINTS), the items act on the row, an extension's item gets
// upstream's arguments, and Set Value edits the value in place.

import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import type { MenuEntry } from "@tuidom/elements/menu/popupMenuElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugViewletHarness, type IDebugViewletHarness } from "../../../../../TestUtils/debugViewletHarness.ts";
import type { SyntheticDebugAdapterFactory } from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { MenuRegistryDIToken } from "../../../../platform/actions/common/menuRegistry.ts";
import { ClipboardDIToken } from "../../../../platform/clipboard/common/iClipboard.ts";
import { ContextMenuServiceDIToken } from "../../../../platform/contextview/browser/contextMenuService.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { registerExtensionMenus } from "../../../services/extensions/common/extensionMenuContributor.ts";
import { CALLSTACK_VIEW_ID, VARIABLES_VIEW_ID, WATCH_VIEW_ID } from "../common/debug.ts";

import { DebugServiceDIToken } from "./debugService.ts";
import { DebugViewletComponentDIToken } from "./debugViewlet.ts";

describe("Run and Debug: the context menus of the rows", () => {
    let t: IDebugViewletHarness;
    let factory: SyntheticDebugAdapterFactory;
    /** The entries of the menus shown, the last one last. */
    let shown: MenuEntry[][];
    /** Where each of them opened. */
    let anchors: unknown[];

    beforeEach(async () => {
        t = await createDebugViewletHarness(process.cwd());
        shown = [];
        anchors = [];
        const contextMenu = t.h.container.get(ContextMenuServiceDIToken);
        const show = contextMenu.showContextMenu.bind(contextMenu);
        vi.spyOn(contextMenu, "showContextMenu").mockImplementation((delegate) => {
            shown.push(delegate.getEntries?.() ?? []);
            anchors.push(delegate.getAnchor());
            show(delegate);
        });
        factory = await t.startStopped();
        await vi.waitFor(() => {
            expect(t.screen()).toContain("sum: ");
            expect(t.screen()).toContain("accumulate(");
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

    /** Right-clicks `text` and waits for its menu: the labels, `-` for a separator. */
    async function menuAt(text: string): Promise<string[]> {
        const before = shown.length;
        const at = t.find(text);
        mouse(at.x, at.y, "right");
        await vi.waitFor(() => {
            expect(shown.length).toBe(before + 1);
        });
        return labels();
    }

    function labels(): string[] {
        return (shown.at(-1) ?? []).map((entry) => (entry.type === "separator" ? "-" : entry.label));
    }

    /** Runs the item of the last menu, as a click on it does. */
    function choose(label: string): void {
        const entry = shown.at(-1)?.find((e) => e.type !== "separator" && e.type !== "submenu" && e.label === label);
        expect(entry, `"${label}" in the menu`).toBeDefined();
        // The popup closes on a click, as it does here.
        t.h.container.get(ContextMenuServiceDIToken).hideContextMenu();
        (entry as { onSelect: () => void }).onSelect();
    }

    function clipboard(): Promise<string> {
        return t.h.container.get(ClipboardDIToken).readText();
    }

    it("a variable: upstream's items with the adapter's data breakpoints; the popup is on screen", async () => {
        expect(await menuAt("sum: ")).toEqual([
            "Set Value",
            "-",
            "Copy Value",
            "Copy as Expression",
            "-",
            "Add to Watch",
            "Break on Value Change",
        ]);
        expect(t.screen()).toContain("│ Set Value");
        expect(t.screen()).toContain("│ Add to Watch");
        // At the click: under the row, not in a corner of the screen.
        expect(t.find("│ Set Value").y).toBeGreaterThan(t.find("sum: ").y);

        // `count` can be watched for reads and accesses too.
        t.h.testApp.sendKey("Escape");
        expect(await menuAt("count: ")).toEqual([
            "Set Value",
            "-",
            "Copy Value",
            "Copy as Expression",
            "-",
            "Add to Watch",
            "Break on Value Read",
            "Break on Value Change",
            "Break on Value Access",
        ]);
    });

    it("Copy Value copies the adapter's answer, Copy as Expression the evaluate name, Add to Watch adds it", async () => {
        const sum = /sum: (\d+)/u.exec(t.screen())?.[1];
        await menuAt("sum: ");
        choose("Copy Value");
        await vi.waitFor(async () => {
            expect(await clipboard()).toBe(sum);
        });

        // A scope has no items: no menu.
        const before = shown.length;
        const scope = t.find("Locals");
        mouse(scope.x, scope.y, "right");
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(shown).toHaveLength(before);
        await menuAt("count: ");
        choose("Copy as Expression");
        await vi.waitFor(async () => {
            expect(await clipboard()).toBe("count");
        });

        await menuAt("count: ");
        choose("Add to Watch");
        await vi.waitFor(() => {
            expect(t.lines().filter((line) => line.includes("count: 0"))).toHaveLength(2);
        });
    });

    it("Break on Value Change and Access add data breakpoints for the variable", async () => {
        const debugService = t.h.container.get(DebugServiceDIToken);
        await menuAt("count: ");
        choose("Break on Value Access");
        await vi.waitFor(() => {
            expect(debugService.getModel().getDataBreakpoints()).toMatchObject([
                { description: "count", accessType: "readWrite" },
            ]);
        });
        await menuAt("sum: ");
        choose("Break on Value Change");
        await vi.waitFor(() => {
            expect(debugService.getModel().getDataBreakpoints().at(-1)).toMatchObject({
                description: "sum",
                accessType: "write",
            });
        });
        await vi.waitFor(() => {
            expect(t.screen()).toContain("sum");
            expect(factory.adapters[0].requests.map((r) => r.command)).toContain("setDataBreakpoints");
        });
    });

    it("Set Value puts an input over the row; Enter sets the variable and the row shows the new value", async () => {
        await menuAt("sum: ");
        choose("Set Value");
        await vi.waitFor(() => {
            expect(t.screen()).not.toContain("sum: ");
        });
        for (const key of ["4", "2"]) t.h.testApp.sendKey(key);
        const scopesRead = (): number => factory.adapters[0].requests.filter((r) => r.command === "scopes").length;
        const before = scopesRead();
        t.h.testApp.sendKey("Enter");

        await vi.waitFor(() => {
            expect(t.screen()).toContain("sum: 42");
        });
        expect(factory.adapters[0].requests.find((r) => r.command === "setVariable")?.arguments).toMatchObject({
            name: "sum",
            value: "42",
        });
        // Upstream refreshes the rows without reading the scopes anew; the next refresh reads them again.
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(scopesRead()).toBe(before);
        // The input is gone, so Ctrl+C on the row is Copy Value again.
        await t.h.container.get(ClipboardDIToken).writeText("before");
        t.h.testApp.sendKey("Ctrl+C");
        await vi.waitFor(async () => {
            expect(await clipboard()).not.toBe("before");
        });
        t.h.container.get(DebugServiceDIToken).getViewModel().updateViews();
        await vi.waitFor(() => {
            expect(scopesRead()).toBeGreaterThan(before);
        });
    });

    it("F2 edits the variable under the cursor; Escape leaves it as it was and sets nothing", async () => {
        const component = t.h.container.get(DebugViewletComponentDIToken);
        t.h.container.get(ViewsServiceDIToken).openView(VARIABLES_VIEW_ID, true);
        const at = t.find("count: 0");
        mouse(at.x, at.y, "left");
        expect(component.variables.tree.focused?.name).toBe("count");

        t.h.testApp.sendKey("F2");
        await vi.waitFor(() => {
            expect(t.screen()).not.toContain("count: 0");
        });
        t.h.testApp.sendKey("7");
        t.h.testApp.sendKey("Escape");

        await vi.waitFor(() => {
            expect(t.screen()).toContain("count: 0");
        });
        // Enter on the value as it is sets nothing either.
        t.h.testApp.sendKey("F2");
        await vi.waitFor(() => {
            expect(t.screen()).not.toContain("count: 0");
        });
        t.h.testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(t.screen()).toContain("count: 0");
        });
        expect(factory.adapters[0].requests.map((r) => r.command)).not.toContain("setVariable");
    });

    it("Shift+F10 opens the menu of the row under the cursor", async () => {
        t.h.container.get(ViewsServiceDIToken).openView(VARIABLES_VIEW_ID, true);
        const at = t.find("count: 0");
        mouse(at.x, at.y, "left");
        const before = shown.length;
        t.h.testApp.sendKey("Shift+F10");
        await vi.waitFor(() => {
            expect(shown.length).toBe(before + 1);
        });
        expect(labels()[0]).toBe("Set Value");
    });

    it("a watch expression: its items; Copy Expression, Copy All and Set Value", async () => {
        const debugService = t.h.container.get(DebugServiceDIToken);
        debugService.addWatchExpression("count");
        await vi.waitFor(() => {
            expect(t.lines().filter((line) => line.includes("count: 0"))).toHaveLength(2);
        });
        t.h.container.get(ViewsServiceDIToken).openView(WATCH_VIEW_ID, true);
        const watchRow = t.lines().findLastIndex((line) => line.includes("count: 0"));
        const x = t.lines()[watchRow].indexOf("count");
        mouse(x, watchRow, "right");
        await vi.waitFor(() => {
            expect(labels()).toContain("Add Expression");
        });
        expect(anchors.at(-1)).toEqual({ screenX: x, screenY: watchRow });
        expect(labels()).toEqual([
            "Add Expression",
            "Edit Expression",
            "Copy Expression",
            "Set Value",
            "Copy Value",
            "Copy All",
            "-",
            "Remove All Expressions",
            "Break on Value Read",
            "Break on Value Change",
            "Break on Value Access",
        ]);

        choose("Copy Expression");
        await vi.waitFor(async () => {
            expect(await clipboard()).toBe("count");
        });
        mouse(x, watchRow, "right");
        choose("Copy All");
        await vi.waitFor(async () => {
            expect(await clipboard()).toBe("count: 0");
        });
    });

    it("a frame: Restart Frame and Copy Call Stack, which copies every frame of the thread", async () => {
        t.h.container.get(ViewsServiceDIToken).openView(CALLSTACK_VIEW_ID, true);
        expect(await menuAt("accumulate(")).toEqual(["Restart Frame", "-", "Copy Call Stack"]);
        choose("Copy Call Stack");
        await vi.waitFor(async () => {
            expect((await clipboard()).split("\n")[0]).toContain("accumulate(std::vector<int> const&)");
        });
        expect((await clipboard()).split("\n").length).toBeGreaterThan(2);
    });

    it("an extension's item of debug/callstack/context gets the frame's source and its context", async () => {
        const received: unknown[][] = [];
        t.h.commands.register("demo.frameMenu", (...args: unknown[]) => {
            received.push(args);
        });
        const extension = {
            id: "test.demo",
            isBuiltin: false,
            manifest: {
                contributes: {
                    menus: {
                        "debug/callstack/context": [
                            {
                                command: "demo.frameMenu",
                                title: "Demo Frame",
                                when: "callStackItemType == 'stackFrame'",
                            },
                        ],
                    },
                },
            },
        } as unknown as IExtension;
        const registration = registerExtensionMenus([extension], t.h.container.get(MenuRegistryDIToken));
        try {
            t.h.container.get(ViewsServiceDIToken).openView(CALLSTACK_VIEW_ID, true);
            expect(await menuAt("accumulate(")).toEqual(["Restart Frame", "-", "Copy Call Stack", "-", "Demo Frame"]);
            choose("Demo Frame");

            const session = t.h.container.get(DebugServiceDIToken).getViewModel().focusedSession;
            expect(received).toHaveLength(1);
            expect(received[0][0]).toBe(Uri.file("/home/user/hello/src/main.cpp").toString());
            expect(received[0][1]).toMatchObject({
                sessionId: session?.getId(),
                threadId: expect.any(String) as unknown,
                frameId: expect.any(String) as unknown,
                frameName: "accumulate(std::vector<int> const&)",
            });
        } finally {
            registration.dispose();
        }
    });
});
