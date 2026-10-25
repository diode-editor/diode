import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { feed } from "../../../TestUtils/terminalLinks.ts";
import { TerminalEditorServiceDIToken } from "../contrib/terminal/browser/terminalEditorService.ts";
import { TerminalServiceDIToken } from "../contrib/terminal/browser/terminalService.ts";
import { ExtensionPtySession } from "../contrib/terminal/node/extensionPtySession.ts";

import { QuickInputComponentDIToken } from "./parts/quickinput/quickInputComponent.ts";
import type { QuickPickElement } from "./parts/quickinput/quickPickElement.ts";

const FILES = {
    "src/a.ts": "line 1\nline 2\nline 3\n",
    "pkg/inner/b.ts": "export {};\n",
};

describe("Workbench — Terminal: Open Detected Link targets the focused terminal", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

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

    function picker(): QuickPickElement | undefined {
        h.testApp.render();
        const component = h.container.get(QuickInputComponentDIToken);
        return component.isOpen() ? component.view : undefined;
    }

    /** A panel terminal printing `src/a.ts:2`, then a terminal in an editor tab printing `pkg/inner/b.ts:1`; the user goes back to the panel one. */
    async function bootPanelFocusedAfterEditorTerminal(): Promise<void> {
        ws = createTempWorkspace({ prefix: "diode-terminal-detected-links-active-", files: FILES });
        h = createAppTestHarness({ workspaceFolder: ws.dir });

        const panelSession = await emulator();
        h.container.get(TerminalServiceDIToken).createInstance({ session: panelSession, cwd: ws.dir });
        h.commands.execute("workbench.action.terminal.toggleTerminal");
        h.testApp.render();
        await feed(panelSession, "src/a.ts:2\r\n");

        const editorSession = await emulator();
        h.container.get(TerminalEditorServiceDIToken).createTerminal({ session: editorSession, cwd: ws.dir });
        await feed(editorSession, "\r\n".repeat(8) + "pkg/inner/b.ts:1\r\n");
        h.testApp.render();

        // Terminal: Focus Terminal — the panel's terminal takes the focus back.
        await h.commands.execute("workbench.action.terminal.focus");
        h.testApp.render();
        const focused = h.testApp.focusedElement;
        expect(focused).toBeInstanceOf(TerminalViewElement);
        expect(h.testApp.backend.screenToString()).toContain("src/a.ts:2");
    }

    it("Ctrl+Shift+O in the panel terminal lists the panel terminal's links, not the editor tab's", async () => {
        await bootPanelFocusedAfterEditorTerminal();
        h.testApp.sendKey("Ctrl+Shift+O");
        let shown: QuickPickElement | undefined;
        await vi.waitFor(() => {
            shown = picker();
            expect(shown).toBeDefined();
        });

        expect(shown!.inspectState().items).toEqual(["a.ts:2"]);
    });

    it("Open Last Local File Link from the panel terminal opens the panel terminal's link", async () => {
        await bootPanelFocusedAfterEditorTerminal();
        await h.commands.execute("workbench.action.terminal.openFileLink");

        await vi.waitFor(() => {
            expect(h.activeEditor().uri.fsPath).toBe(ws.path("src/a.ts"));
        });
        expect(h.activeEditor().primaryCursorLine).toBe(1);
    });

    it("focus back in the terminal tab, still the active editor: its links again", async () => {
        await bootPanelFocusedAfterEditorTerminal();
        await h.commands.execute("workbench.action.focusActiveEditorGroup");
        h.testApp.render();
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);

        await h.commands.execute("workbench.action.terminal.openFileLink");
        await vi.waitFor(() => {
            expect(h.activeEditor().uri.fsPath).toBe(ws.path("pkg/inner/b.ts"));
        });
    });
});
