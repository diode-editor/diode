import { Point } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { feed } from "../../../TestUtils/terminalLinks.ts";
import { createTestConfigurationService } from "../../../TestUtils/testConfigurationService.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { ExplorerServiceDIToken } from "../contrib/files/browser/explorerService.ts";
import { TerminalEditorServiceDIToken } from "../contrib/terminal/browser/terminalEditorService.ts";
import { type TerminalService, TerminalServiceDIToken } from "../contrib/terminal/browser/terminalService.ts";
import { ExtensionPtySession } from "../contrib/terminal/node/extensionPtySession.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";

import { QuickInputComponentDIToken } from "./parts/quickinput/quickInputComponent.ts";
import type { QuickPickElement } from "./parts/quickinput/quickPickElement.ts";

const FILES = {
    "src/a.ts": "line 1\nline 2\nabcdef\nline 4\n",
    "pkg/inner/b.ts": "export {};\n",
    "long.txt": Array.from({ length: 300 }, (_, i) => `row ${String(i + 1)}`).join("\n"),
};

const OPEN_DETECTED_LINK = "workbench.action.terminal.openDetectedLink";
const OPEN_FILE_LINK = "workbench.action.terminal.openFileLink";
const PLACEHOLDER = "Select the link to open, type to filter all links";

describe("Workbench — Terminal: Open Detected Link", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let terminal: TerminalService;
    let input: string[];

    function boot(settings: Record<string, unknown> = {}): void {
        ws = createTempWorkspace({ prefix: "diode-terminal-detected-links-", files: FILES });
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            configurationService: createTestConfigurationService(settings),
        });
        terminal = h.container.get(TerminalServiceDIToken);
        input = [];
    }

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    /** A real emulator fed by the test; what the terminal sends to its "shell" lands in `input`. */
    async function emulator(): Promise<ExtensionPtySession> {
        const session = new ExtensionPtySession({
            cols: 80,
            rows: 10,
            name: "links",
            onInput: (data) => input.push(data),
            onResize: () => undefined,
        });
        await session.xtermReady;
        return session;
    }

    async function panelTerminalWith(
        output: string,
    ): Promise<{ view: TerminalViewElement; session: ExtensionPtySession }> {
        const session = await emulator();
        terminal.createInstance({ session, cwd: ws.dir });
        h.commands.execute("workbench.action.terminal.toggleTerminal");
        h.testApp.render();
        await feed(session, output);
        return { view: widget(), session };
    }

    function widget(): TerminalViewElement {
        h.testApp.render();
        const found = h.testApp.querySelectorAll("TerminalViewElement").at(-1);
        expect(found).toBeInstanceOf(TerminalViewElement);
        return found as TerminalViewElement;
    }

    function picker(): QuickPickElement | undefined {
        h.testApp.render();
        const component = h.container.get(QuickInputComponentDIToken);
        return component.isOpen() ? component.view : undefined;
    }

    async function openPicker(): Promise<QuickPickElement> {
        h.testApp.sendKey("Ctrl+Shift+O");
        let shown: QuickPickElement | undefined;
        await vi.waitFor(() => {
            shown = picker();
            expect(shown).toBeDefined();
        });
        return shown!;
    }

    function typeText(text: string): void {
        for (const char of text) h.testApp.sendKey(char);
    }

    /** The frame's lines that hold `text`, blanks collapsed; the picker is above the terminal. */
    function frameLines(text: string): string[] {
        h.testApp.render();
        return h.testApp.backend
            .screenToString()
            .split("\n")
            .filter((line) => line.includes(text))
            .map((line) => line.replace(/\s+/g, " ").trim());
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

    function screenRowOf(view: TerminalViewElement, text: string): number {
        h.testApp.render();
        const lines = h.testApp.backend.screenToString().split("\n");
        const origin = view.globalPosition;
        for (let y = 0; y < view.layoutSize.height; y++) {
            if (lines[origin.y + y].includes(text)) return y;
        }
        return -1;
    }

    it("Ctrl+Shift+O lists the viewport's links bottom-up under File; Down underlines the second; Enter opens it", async () => {
        boot();
        const { view } = await panelTerminalWith("src/a.ts:3:2 first\r\nls pkg/inner/b.ts\r\nlong.txt:250\r\n");
        const pick = await openPicker();

        expect(pick.inspectState().items).toEqual(["long.txt:250", "b.ts", "a.ts:3:2"]);
        // A file in the workspace root has no directory.
        expect(frameLines("long.txt:250").at(0)).toBe("│ long.txt:250 File │");
        expect(frameLines("b.ts").at(0)).toBe("│ b.ts pkg/inner │");
        expect(frameLines("a.ts:3:2").at(0)).toBe("│ a.ts:3:2 src │");
        expect(h.testApp.backend.screenToString()).toContain(PLACEHOLDER);
        // The active item is underlined in the terminal.
        expect(underlined(view, 2)).toBe("____________");

        h.testApp.sendKey("ArrowDown");
        expect(underlined(view, 2)).toBe("");
        expect(underlined(view, 1)).toBe("   ______________");

        h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(h.activeEditor().uri.fsPath).toBe(ws.path("src/a.ts"));
        });
        expect([h.activeEditor().primaryCursorLine, h.activeEditor().primaryCursorColumn]).toEqual([2, 1]);
        expect(picker()).toBeUndefined();
        expect(input).toEqual([]);
        expect(underlined(view, 0)).toBe("");
    });

    it("typing filters all links of the buffer, the scrollback included; the pick scrolls the terminal to it", async () => {
        boot();
        const filler = Array.from({ length: 30 }, (_, i) => `out ${String(i)}`).join("\r\n");
        const { view, session } = await panelTerminalWith(`src/a.ts:4\r\n${filler}\r\nlong.txt\r\n`);
        const pick = await openPicker();
        expect(pick.inspectState().items).toEqual(["long.txt"]);

        typeText("a.ts");
        await vi.waitFor(() => {
            expect(picker()?.inspectState().items).toEqual(["a.ts:4"]);
        });
        expect(session.scrollOffset).toBeGreaterThan(0);
        const row = screenRowOf(view, "src/a.ts:4");
        expect(row).toBeGreaterThanOrEqual(0);
        expect(underlined(view, row)).toBe("__________");

        h.testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(h.activeEditor().primaryCursorLine).toBe(3);
        });
        expect(session.scrollOffset).toBe(0);
    });

    it("Escape closes it: focus goes back to the terminal, its scroll and underline are as before", async () => {
        boot();
        const filler = Array.from({ length: 30 }, (_, i) => `out ${String(i)}`).join("\r\n");
        const { view, session } = await panelTerminalWith(`src/a.ts:4\r\n${filler}\r\n`);
        session.scrollLines(-3);
        expect(session.scrollOffset).toBe(3);
        await openPicker();
        typeText("a");
        await vi.waitFor(() => {
            expect(picker()?.inspectState().items).toEqual(["a.ts:4"]);
        });
        expect(session.scrollOffset).toBeGreaterThan(3);

        h.testApp.sendKey("Escape");
        expect(picker()).toBeUndefined();
        expect(session.scrollOffset).toBe(3);
        expect(h.testApp.focusedElement).toBe(view);
        for (let y = 0; y < 10; y++) expect(underlined(view, y)).toBe("");
        expect(h.container.get(EditorServiceDIToken).getActiveEditor()).toBeNull();
        expect(input).toEqual([]);
    });

    it("duplicate links are listed once; a folder of the workspace goes under Folder", async () => {
        boot();
        await h.workbench.activate();
        await panelTerminalWith("src/a.ts:3 src/a.ts:3\r\n./src/a.ts:3\r\ncd pkg/inner\r\nsrc/a.ts\r\n");
        const pick = await openPicker();

        expect(pick.inspectState().items).toEqual(["a.ts", "a.ts:3", "inner"]);
        expect(frameLines("a.ts").at(0)).toBe("│ a.ts src File │");
        expect(frameLines("inner").at(0)).toBe("│ inner pkg Folder │");

        h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(h.container.get(ExplorerServiceDIToken).getSelectedPaths()).toEqual([ws.path("pkg/inner")]);
        });
    });

    it("a range suffix is in the label; a file outside the workspace has its absolute directory", async () => {
        boot();
        const outside = createTempWorkspace({ prefix: "diode-terminal-outside-", files: { "c.ts": "x\n" } });
        try {
            await panelTerminalWith(`src/a.ts:2:1-3.4\r\nsrc/a.ts:3:2-5\r\n${outside.path("c.ts")}\r\n`);
            const pick = await openPicker();

            expect(pick.inspectState().items).toEqual(["c.ts", "a.ts:3:2-5", "a.ts:2-3:1-4"]);
            expect(frameLines("c.ts").at(0)).toBe(`│ c.ts ${outside.dir} File │`);
        } finally {
            outside.dispose();
        }
    });

    it("Escape ends the command; it can be run again", async () => {
        boot();
        await panelTerminalWith("src/a.ts\r\n");
        for (let round = 0; round < 2; round++) {
            const done = h.commands.execute(OPEN_DETECTED_LINK);
            await vi.waitFor(() => {
                expect(picker()?.inspectState().items).toEqual(["a.ts"]);
            });
            h.testApp.sendKey("Escape");
            await done;
            expect(picker()).toBeUndefined();
        }
    });

    it("no links — an empty list with the same placeholder; Enter does nothing", async () => {
        boot();
        await panelTerminalWith("nothing to see\r\n");
        const pick = await openPicker();

        expect(pick.inspectState().items).toEqual([]);
        expect(h.testApp.backend.screenToString()).toContain(PLACEHOLDER);
        h.testApp.sendKey("Enter");
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(h.container.get(EditorServiceDIToken).getActiveEditor()).toBeNull();
    });

    it('`enableFileLinks: "off"` — the list is empty', async () => {
        boot({ "terminal.integrated.enableFileLinks": "off" });
        await panelTerminalWith("src/a.ts:3:2\r\n");
        const pick = await openPicker();

        expect(pick.inspectState().items).toEqual([]);
        typeText("a");
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(picker()?.inspectState().items).toEqual([]);
        h.testApp.sendKey("Escape");

        await h.commands.execute(OPEN_FILE_LINK);
        expect(h.container.get(EditorServiceDIToken).getActiveEditor()).toBeNull();
    });

    it("works for a terminal in an editor tab", async () => {
        boot();
        const session = await emulator();
        h.container.get(TerminalEditorServiceDIToken).createTerminal({ session, cwd: ws.dir });
        // Below the picker, which covers the top of the editor area.
        await feed(session, "\r\n".repeat(8) + "./src/a.ts:2\r\n");
        const view = widget();
        expect(h.testApp.focusedElement).toBe(view);
        const pick = await openPicker();

        expect(pick.inspectState().items).toEqual(["a.ts:2"]);
        expect(underlined(view, 8)).toBe("____________");
        h.testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(h.activeEditor().uri.fsPath).toBe(ws.path("src/a.ts"));
        });
        expect(h.activeEditor().primaryCursorLine).toBe(1);
    });

    it("Open Last Local File Link opens the bottom file link without a picker; without links it does nothing", async () => {
        boot();
        const { session } = await panelTerminalWith("src/a.ts:2\r\nlong.txt:250 pkg/inner/b.ts\r\ncd pkg\r\n");
        await h.commands.execute(OPEN_FILE_LINK);
        await vi.waitFor(() => {
            expect(h.activeEditor().uri.fsPath).toBe(ws.path("long.txt"));
        });
        expect(h.activeEditor().primaryCursorLine).toBe(249);
        expect(picker()).toBeUndefined();

        await feed(session, "\x1b[2J\x1b[3J\x1b[H");
        h.workbench.openFile(ws.path("src/a.ts"));
        await h.commands.execute(OPEN_FILE_LINK);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(h.activeEditor().uri.fsPath).toBe(ws.path("src/a.ts"));
    });

    /** The command palette's rows for the two commands, with their shortcuts. */
    function paletteEntries(): string[] {
        h.commands.execute("workbench.action.showCommands");
        const rows = (picker()?.items ?? [])
            .filter((item) => item.label.startsWith("Terminal: Open") && item.label.includes("Link"))
            .map((item) => `${item.label} ${item.shortcut ?? ""}`.trim());
        h.testApp.sendKey("Escape");
        return rows;
    }

    it("both commands are in the palette once a terminal has been created, even after it is closed", async () => {
        boot();
        expect(paletteEntries()).toEqual([]);

        await panelTerminalWith("src/a.ts\r\n");
        h.commands.execute("workbench.action.terminal.killAll");
        expect(h.container.get(ContextKeyServiceDIToken).evaluate("terminalHasBeenCreated")).toBe(true);
        expect(paletteEntries().sort()).toEqual([
            "Terminal: Open Detected Link... Ctrl+Shift+O",
            "Terminal: Open Last Local File Link",
        ]);
        // Nothing to run against: no terminal, no picker.
        await h.commands.execute(OPEN_DETECTED_LINK);
        await h.commands.execute(OPEN_FILE_LINK);
        expect(picker()).toBeUndefined();
    });
});
