import * as path from "node:path";

import { Point } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { feed } from "../../../TestUtils/terminalLinks.ts";
import { createTestConfigurationService } from "../../../TestUtils/testConfigurationService.ts";
import type { InMemoryConfigurationService } from "../../platform/configuration/common/inMemoryConfigurationService.ts";
import { EXPLORER_VIEWLET_ID } from "../contrib/files/browser/explorerComponent.ts";
import { ExplorerServiceDIToken } from "../contrib/files/browser/explorerService.ts";
import { SEARCH_VIEWLET_ID } from "../contrib/search/browser/searchComponent.ts";
import { TerminalEditorServiceDIToken } from "../contrib/terminal/browser/terminalEditorService.ts";
import { type TerminalService, TerminalServiceDIToken } from "../contrib/terminal/browser/terminalService.ts";
import { ExtensionPtySession } from "../contrib/terminal/node/extensionPtySession.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";

import { SidebarServiceDIToken } from "./parts/sidebar/sidebarService.ts";

const FILES = {
    "src/a.ts": "line 1\nline 2\nabcdef\nline 4\n",
    "pkg/inner/b.ts": "export {};\n",
    "long.txt": Array.from({ length: 300 }, (_, i) => `row ${String(i + 1)}`).join("\n"),
};

describe("Workbench — terminal file links", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let terminal: TerminalService;
    let configuration: InMemoryConfigurationService;

    function boot(settings: Record<string, unknown> = {}): void {
        ws = createTempWorkspace({ prefix: "diode-terminal-links-", files: FILES });
        configuration = createTestConfigurationService(settings);
        h = createAppTestHarness({ workspaceFolder: ws.dir, configurationService: configuration });
        terminal = h.container.get(TerminalServiceDIToken);
    }

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    /** A real emulator fed by the test: the output is what a shell would print. */
    async function emulator(): Promise<ExtensionPtySession> {
        const session = new ExtensionPtySession({
            cols: 80,
            rows: 10,
            name: "links",
            onInput: () => undefined,
            onResize: () => undefined,
        });
        await session.xtermReady;
        return session;
    }

    async function panelTerminalWith(output: string): Promise<TerminalViewElement> {
        const session = await emulator();
        terminal.createInstance({ session, cwd: ws.dir });
        h.commands.execute("workbench.action.terminal.toggleTerminal");
        h.testApp.render();
        await feed(session, output);
        return widget();
    }

    function widget(): TerminalViewElement {
        h.testApp.render();
        const found = h.testApp.querySelectorAll("TerminalViewElement").at(-1);
        expect(found).toBeInstanceOf(TerminalViewElement);
        return found as TerminalViewElement;
    }

    function mouse(
        view: TerminalViewElement,
        x: number,
        y: number,
        action: MouseToken["action"],
        { ctrlKey = true, button = "none" }: { ctrlKey?: boolean; button?: MouseToken["button"] } = {},
    ): void {
        const origin = view.globalPosition;
        h.testApp.backend.simulateMouse({
            kind: "mouse",
            button,
            action,
            x: origin.x + x + 1,
            y: origin.y + y + 1,
            shiftKey: false,
            altKey: false,
            ctrlKey,
            raw: "",
        });
    }

    function ctrlClick(view: TerminalViewElement, x: number, y: number): void {
        mouse(view, x, y, "press", { button: "left" });
        mouse(view, x, y, "release", { button: "left" });
    }

    /** `_` per underlined cell of the widget row, trailing blanks trimmed. */
    function underlined(view: TerminalViewElement, y: number): string {
        h.testApp.render();
        const origin = view.globalPosition;
        const screen = h.testApp.app.screen;
        let row = "";
        for (let x = 0; x < view.layoutSize.width; x++) {
            const style = screen.getCell(new Point(origin.x + x, origin.y + y)).style;
            row += (style & StyleFlags.Underline) !== 0 ? "_" : " ";
        }
        return row.trimEnd();
    }

    it("Ctrl+hover underlines exactly the link in the frame; Ctrl+click opens the file at line:col", async () => {
        boot();
        const view = await panelTerminalWith("src/a.ts:3:2 is here\r\n");
        expect(underlined(view, 0)).toBe("");

        mouse(view, 4, 0, "move", { ctrlKey: false });
        expect(underlined(view, 0)).toBe("");
        mouse(view, 4, 0, "move");
        await vi.waitFor(() => {
            expect(underlined(view, 0)).toBe("____________");
        });
        mouse(view, 15, 0, "move");
        await vi.waitFor(() => {
            expect(underlined(view, 0)).toBe("");
        });

        ctrlClick(view, 4, 0);
        await vi.waitFor(() => {
            expect(h.activeEditor().uri.fsPath).toBe(ws.path("src/a.ts"));
        });
        const editor = h.activeEditor();
        expect([editor.primaryCursorLine, editor.primaryCursorColumn]).toEqual([2, 1]);
        h.testApp.render();
        expect(h.testApp.focusedElement).not.toBeInstanceOf(TerminalViewElement);
        expect(h.testApp.backend.screenToString()).toContain("a.ts");
    });

    it("a click without Ctrl doesn't open anything", async () => {
        boot();
        const view = await panelTerminalWith("src/a.ts:3:2\r\n");
        mouse(view, 2, 0, "press", { button: "left", ctrlKey: false });
        mouse(view, 2, 0, "release", { button: "left", ctrlKey: false });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(h.container.get(EditorServiceDIToken).getActiveEditor()).toBeNull();
    });

    it("Ctrl+click on a workspace folder reveals it in the Explorer", async () => {
        boot();
        const view = await panelTerminalWith("ls pkg/inner\r\n");
        await h.workbench.activate();
        const sidebar = h.container.get(SidebarServiceDIToken);
        sidebar.showViewlet(SEARCH_VIEWLET_ID);
        ctrlClick(view, 5, 0);
        await vi.waitFor(() => {
            expect(h.container.get(ExplorerServiceDIToken).getSelectedPaths()).toEqual([ws.path("pkg/inner")]);
        });
        expect(sidebar.getActiveViewletId()).toBe(EXPLORER_VIEWLET_ID);
        h.testApp.render();
        expect(h.testApp.backend.screenToString()).toMatch(/inner/);
    });

    it("a folder outside the workspace is not a link", async () => {
        boot();
        const view = await panelTerminalWith(`cd ${path.dirname(ws.dir)}\r\n`);
        mouse(view, 5, 0, "move");
        ctrlClick(view, 5, 0);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(underlined(view, 0)).toBe("");
        expect(h.container.get(ExplorerServiceDIToken).getSelectedPaths()).toEqual([]);
    });

    // Kitty protocol: Control alone is a key with press (event type 1) and release (3) events.
    const CONTROL_PRESS = "\x1b[57442;5u";
    const CONTROL_RELEASE = "\x1b[57442;1:3u";

    function rawKey(sequence: string): void {
        h.testApp.backend.sendRaw(sequence);
        h.testApp.backend.flushInput();
    }

    it("Ctrl alone under a resting pointer underlines; its release, another key or leaving the widget clear it", async () => {
        boot();
        const view = await panelTerminalWith("src/a.ts:3:2 is here\r\n");
        mouse(view, 4, 0, "move", { ctrlKey: false });
        const hover = async (): Promise<void> => {
            rawKey(CONTROL_PRESS);
            await vi.waitFor(() => {
                expect(underlined(view, 0)).toBe("____________");
            });
        };
        await hover();
        rawKey(CONTROL_RELEASE);
        expect(underlined(view, 0)).toBe("");

        await hover();
        h.testApp.sendKey("a");
        expect(underlined(view, 0)).toBe("");

        await hover();
        mouse(view, 4, -3, "move");
        expect(underlined(view, 0)).toBe("");

        // Another key let go while Ctrl stays held keeps the underline.
        mouse(view, 4, 0, "move", { ctrlKey: false });
        await hover();
        rawKey("\x1b[97;5:3u");
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(underlined(view, 0)).toBe("____________");
    });

    it("relative paths resolve against the shell's cwd, else the cwd the terminal started in", async () => {
        boot();
        const started = await emulator();
        terminal.createInstance({ session: started, cwd: ws.path("pkg") });
        h.commands.execute("workbench.action.terminal.toggleTerminal");
        await feed(started, "inner/b.ts src/a.ts\r\n");
        let view = widget();
        mouse(view, 3, 0, "move");
        await vi.waitFor(() => {
            expect(underlined(view, 0)).toBe("__________");
        });
        // Not under the cwd: the workspace root is the next base.
        mouse(view, 13, 0, "move");
        await vi.waitFor(() => {
            expect(underlined(view, 0)).toBe("           ________");
        });

        const moved = Object.assign(await emulator(), { getCwd: () => Promise.resolve(ws.path("pkg/inner")) });
        terminal.createInstance({ session: moved, cwd: ws.dir });
        await feed(moved, "b.ts\r\n");
        view = widget();
        mouse(view, 1, 0, "move");
        await vi.waitFor(() => {
            expect(underlined(view, 0)).toBe("____");
        });
    });

    it("a terminal keeps the `enableFileLinks` value it was created with, also in a new widget", async () => {
        boot();
        await panelTerminalWith("src/a.ts:3:2\r\n");
        await configuration.updateValue("terminal.integrated.enableFileLinks", "off");
        h.commands.execute("workbench.action.terminal.moveToEditor");
        const view = widget();
        mouse(view, 3, 0, "move");
        await vi.waitFor(() => {
            expect(underlined(view, 0)).toBe("____________");
        });
    });

    it('`terminal.integrated.enableFileLinks: "off"` — no underline, no opening', async () => {
        boot({ "terminal.integrated.enableFileLinks": "off" });
        const view = await panelTerminalWith("src/a.ts:3:2\r\n");
        mouse(view, 2, 0, "move");
        ctrlClick(view, 2, 0);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(underlined(view, 0)).toBe("");
        expect(h.container.get(EditorServiceDIToken).getActiveEditor()).toBeNull();
    });

    // Upstream (xterm Linkifier `_handleMouseUp`) activates a link on mouse-up, and only when both the
    // press and the release are on that same link.
    it("Ctrl+press on a link and release off it (a drag) opens nothing", async () => {
        boot();
        const view = await panelTerminalWith("src/a.ts:3:2 is here\r\n");
        mouse(view, 4, 0, "move");
        await vi.waitFor(() => {
            expect(underlined(view, 0)).toBe("____________");
        });
        mouse(view, 4, 0, "press", { button: "left" });
        // A human holds the button a moment before dragging.
        await new Promise((resolve) => setTimeout(resolve, 100));
        mouse(view, 9, 0, "move", { button: "left" });
        mouse(view, 30, 0, "move", { button: "left" });
        mouse(view, 30, 0, "release", { button: "left" });
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(h.container.get(EditorServiceDIToken).getActiveEditor()).toBeNull();
    });

    it("Ctrl+press alone doesn't open the file — it opens on release over the link", async () => {
        boot();
        const view = await panelTerminalWith("src/a.ts:3:2\r\n");
        mouse(view, 4, 0, "move");
        await vi.waitFor(() => {
            expect(underlined(view, 0)).toBe("____________");
        });
        mouse(view, 4, 0, "press", { button: "left" });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(h.container.get(EditorServiceDIToken).getActiveEditor()).toBeNull();
        mouse(view, 4, 0, "release", { button: "left" });
        await vi.waitFor(() => {
            expect(h.activeEditor().uri.fsPath).toBe(ws.path("src/a.ts"));
        });
    });

    // Spec item 3 "an already open file is activated"; upstream opens with `revealIfOpened: true`.
    it("a file already open in another editor group is revealed there, not opened again in the active group", async () => {
        boot();
        const groups = h.container.get(EditorServiceDIToken).editorGroups;
        // Group 1: b.ts, a.ts. Group 2: b.ts only, active.
        h.workbench.openFile(ws.path("pkg/inner/b.ts"));
        h.commands.execute("workbench.action.splitEditorRight");
        h.commands.execute("workbench.action.focusFirstEditorGroup");
        h.workbench.openFile(ws.path("src/a.ts"));
        h.commands.execute("workbench.action.focusSecondEditorGroup");
        const [first, second] = groups.groups;
        expect([first.editorCount, second.editorCount]).toEqual([2, 1]);
        expect(groups.activeGroup === second).toBe(true);

        const view = await panelTerminalWith("src/a.ts:4\r\n");
        mouse(view, 3, 0, "move");
        await vi.waitFor(() => {
            expect(underlined(view, 0)).toBe("__________");
        });
        ctrlClick(view, 3, 0);
        await vi.waitFor(() => {
            expect(h.activeEditor().uri.fsPath).toBe(ws.path("src/a.ts"));
        });
        expect(groups.activeGroup === first).toBe(true);
        expect(second.editorCount).toBe(1);
        expect(h.activeEditor().primaryCursorLine).toBe(3);
    });

    it("a file open only in another group, as its first tab, is revealed there", async () => {
        boot();
        const groups = h.container.get(EditorServiceDIToken).editorGroups;
        // Group 1: a.ts. Group 2: b.ts, active.
        h.workbench.openFile(ws.path("src/a.ts"));
        h.commands.execute("workbench.action.splitEditorRight");
        h.workbench.openFile(ws.path("pkg/inner/b.ts"));
        h.commands.execute("workbench.action.closeOtherEditors");
        const [first, second] = groups.groups;
        expect([first.editorCount, second.editorCount]).toEqual([1, 1]);

        const view = await panelTerminalWith("src/a.ts:2\r\n");
        ctrlClick(view, 3, 0);
        await vi.waitFor(() => {
            expect(groups.activeGroup === first).toBe(true);
        });
        expect(second.editorCount).toBe(1);
        expect(h.activeEditor().primaryCursorLine).toBe(1);
    });

    it("a file open in the active group and in another one is activated in the active group", async () => {
        boot();
        const groups = h.container.get(EditorServiceDIToken).editorGroups;
        h.workbench.openFile(ws.path("src/a.ts"));
        h.commands.execute("workbench.action.splitEditorRight");
        const [first, second] = groups.groups;
        expect(groups.activeGroup === second).toBe(true);

        const view = await panelTerminalWith("src/a.ts:2\r\n");
        ctrlClick(view, 3, 0);
        await vi.waitFor(() => {
            expect(h.activeEditor().primaryCursorLine).toBe(1);
        });
        expect(groups.activeGroup === second).toBe(true);
        expect([first.editorCount, second.editorCount]).toEqual([1, 1]);
    });

    // An opener failure goes to onUnexpectedError, which fails the test (unexpectedErrors.setup.ts).
    it("a path without line:col activates the file and keeps its cursor", async () => {
        boot();
        h.workbench.openFile(ws.path("src/a.ts"));
        h.activeEditor().goToPosition(2, 3);
        const view = await panelTerminalWith("src/a.ts\r\n");
        ctrlClick(view, 3, 0);
        await vi.waitFor(() => {
            expect(h.testApp.focusedElement).not.toBeInstanceOf(TerminalViewElement);
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect([h.activeEditor().primaryCursorLine, h.activeEditor().primaryCursorColumn]).toEqual([2, 3]);
    });

    it("a line far below the first screen is scrolled into view", async () => {
        boot();
        const view = await panelTerminalWith("long.txt:250\r\n");
        ctrlClick(view, 3, 0);
        await vi.waitFor(() => {
            expect(h.activeEditor().primaryCursorLine).toBe(249);
        });
        h.testApp.render();
        expect(h.activeEditor().viewState.scrollTop).toBeGreaterThan(200);
    });

    it("a terminal in an editor tab has links too", async () => {
        boot();
        const session = await emulator();
        h.container.get(TerminalEditorServiceDIToken).createTerminal({ session, cwd: ws.dir });
        await feed(session, "./src/a.ts:4\r\n");
        const view = widget();
        mouse(view, 3, 0, "move");
        await vi.waitFor(() => {
            expect(underlined(view, 0)).toBe("____________");
        });
        ctrlClick(view, 3, 0);
        await vi.waitFor(() => {
            expect(h.activeEditor().uri.fsPath).toBe(ws.path("src/a.ts"));
        });
        expect(h.activeEditor().primaryCursorLine).toBe(3);
    });
});
