// Edges of the debug context menus on the synthetic debugger, seen as the user sees them: where a right click
// opens a menu and what it offers.

import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import type { MenuEntry } from "@tuidom/elements/menu/popupMenuElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugViewletHarness, type IDebugViewletHarness } from "../../../../../TestUtils/debugViewletHarness.ts";
import { MenuRegistryDIToken } from "../../../../platform/actions/common/menuRegistry.ts";
import { ClipboardDIToken } from "../../../../platform/clipboard/common/iClipboard.ts";
import { ContextMenuServiceDIToken } from "../../../../platform/contextview/browser/contextMenuService.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { registerExtensionMenus } from "../../../services/extensions/common/extensionMenuContributor.ts";
import { REPL_VIEW_ID, VARIABLES_VIEW_ID, WATCH_VIEW_ID } from "../common/debug.ts";

import { DebugServiceDIToken } from "./debugService.ts";
import { ReplDIToken } from "./repl.ts";

describe("Run and Debug: edges of the context menus", () => {
    let t: IDebugViewletHarness;
    let shown: MenuEntry[][];

    beforeEach(async () => {
        // The sidebar's frame, its container line and the lines around the section headers take 11 rows: the
        // sections keep the heights they had in 50, where `p` and a watch's member are on screen.
        t = await createDebugViewletHarness(process.cwd(), undefined, { height: 61 });
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
        });
    });

    afterEach(async () => {
        await t.dispose();
    });

    function rightClick(x: number, y: number): void {
        click(x, y, "right");
    }

    function leftClick(x: number, y: number): void {
        click(x, y, "left");
    }

    function click(x: number, y: number, button: MouseToken["button"]): void {
        for (const action of ["press", "release"] as const) {
            const token: MouseToken = {
                kind: "mouse",
                button,
                action,
                x: x + 1,
                y: y + 1,
                shiftKey: false,
                altKey: false,
                ctrlKey: false,
                raw: "",
            };
            t.h.testApp.backend.simulateMouse(token);
        }
    }

    function labels(): string[] {
        return (shown.at(-1) ?? []).map((entry) => (entry.type === "separator" ? "-" : entry.label));
    }

    /** Contributes `command` to `menu` as an extension's manifest does; returns the arguments it got, per run. */
    function contribute(menu: string, command: string): { received: unknown[][]; dispose(): void } {
        const received: unknown[][] = [];
        const commandRegistration = t.h.commands.register(command, (...args: unknown[]) => {
            received.push(args);
        });
        const extension = {
            id: "test.edges",
            isBuiltin: false,
            manifest: { contributes: { menus: { [menu]: [{ command, title: `Demo ${command}` }] } } },
        } as unknown as IExtension;
        const menuRegistration = registerExtensionMenus([extension], t.h.container.get(MenuRegistryDIToken));
        return {
            received,
            dispose: () => {
                menuRegistration.dispose();
                (commandRegistration as { dispose?: () => void } | undefined)?.dispose?.();
            },
        };
    }

    async function chooseOnRow(text: string, label: string): Promise<void> {
        const at = t.find(text);
        const before = shown.length;
        rightClick(at.x, at.y);
        await vi.waitFor(() => {
            expect(shown.length).toBe(before + 1);
        });
        const entry = shown.at(-1)?.find((e) => e.type !== "separator" && e.type !== "submenu" && e.label === label);
        expect(entry, `"${label}" in ${JSON.stringify(labels())}`).toBeDefined();
        t.h.container.get(ContextMenuServiceDIToken).hideContextMenu();
        (entry as { onSelect: () => void }).onSelect();
    }

    it("debug/variables/context: the item gets upstream's { sessionId, container: the scope, variable }", async () => {
        const contribution = contribute("debug/variables/context", "edges.variable");
        try {
            t.h.container.get(ViewsServiceDIToken).openView(VARIABLES_VIEW_ID, true);
            await chooseOnRow("count: 0", "Demo edges.variable");

            const session = t.h.container.get(DebugServiceDIToken).getViewModel().focusedSession;
            expect(contribution.received).toHaveLength(1);
            expect(contribution.received[0]).toHaveLength(1);
            expect(contribution.received[0][0]).toMatchObject({
                sessionId: session?.getId(),
                container: { name: "Locals", variablesReference: expect.any(Number) as unknown },
                variable: { name: "count", value: "0", evaluateName: "count", variablesReference: 0 },
            });
        } finally {
            contribution.dispose();
        }
    });

    it("debug/variables/context on a member: the container is the parent variable", async () => {
        const contribution = contribute("debug/variables/context", "edges.member");
        try {
            t.h.container.get(ViewsServiceDIToken).openView(VARIABLES_VIEW_ID, true);
            const p = t.find("p: {");
            leftClick(p.x, p.y);
            t.h.testApp.sendKey("ArrowRight");
            await vi.waitFor(() => {
                expect(t.screen()).toMatch(/\bx: 1\.5/u);
            });
            await chooseOnRow("x: 1.5", "Demo edges.member");

            expect(contribution.received).toHaveLength(1);
            expect(contribution.received[0][0]).toMatchObject({
                container: { name: "p", value: "{x:1.5, y:-2}" },
                variable: { name: "x", value: "1.5" },
            });
        } finally {
            contribution.dispose();
        }
    });

    it("debug/watch/context on a member of a watch expression: the container is { expression }", async () => {
        const contribution = contribute("debug/watch/context", "edges.watchMember");
        try {
            t.h.container.get(DebugServiceDIToken).addWatchExpression("p");
            t.h.container.get(ViewsServiceDIToken).openView(WATCH_VIEW_ID, true);
            await vi.waitFor(() => {
                expect(t.lines().filter((line) => line.includes("p: {x:1.5"))).toHaveLength(2);
            });
            const lines = t.lines();
            const row = lines.findLastIndex((line) => line.includes("p: {x:1.5"));
            leftClick(lines[row].indexOf("p: {"), row);
            t.h.testApp.sendKey("ArrowRight");
            await vi.waitFor(() => {
                expect(t.screen()).toMatch(/\bx: 1\.5/u);
            });
            await chooseOnRow("x: 1.5", "Demo edges.watchMember");

            expect(contribution.received).toHaveLength(1);
            // The element itself, as upstream; an extension gets its JSON form across the extension host.
            expect(JSON.parse(JSON.stringify(contribution.received[0][0]))).toMatchObject({
                container: { expression: "p" },
                variable: { name: "x", value: "1.5" },
            });
        } finally {
            contribution.dispose();
        }
    });

    it("the Debug Console: a right click on the empty space below the rows opens its menu, and Paste fills the input", async () => {
        // Upstream's REPL tree opens DebugConsoleContext for a click on no row too (`e.element` undefined): the
        // usual way to paste into the console is a right click anywhere in it.
        const repl = t.h.container.get(ReplDIToken);
        t.h.container.get(ViewsServiceDIToken).openView(REPL_VIEW_ID, true);
        t.h.container.get(ReplDIToken).focus();
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

        // Cleared, the console is empty space where the answer was.
        const lines = t.lines();
        const answer = lines.findIndex((line) => consoleText(line) === "0");
        const x = lines[answer].indexOf("0", repl.view.globalPosition.x);
        repl.clearRepl();
        await vi.waitFor(() => {
            expect(consoleText(t.lines()[answer])).toBe("");
        });
        const before = shown.length;
        rightClick(x, answer);
        await vi.waitFor(() => {
            expect(shown.length).toBe(before + 1);
        });
        expect(labels()).toContain("Paste");
        expect(labels()).toContain("Clear Console");

        await t.h.container.get(ClipboardDIToken).writeText("sum");
        const paste = shown.at(-1)?.find((e) => e.type !== "separator" && e.type !== "submenu" && e.label === "Paste");
        t.h.container.get(ContextMenuServiceDIToken).hideContextMenu();
        (paste as { onSelect: () => void }).onSelect();
        await vi.waitFor(() => {
            expect(repl.input.inputState.value).toBe("sum");
        });
    });
});
