import { Point } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { feed } from "../../../TestUtils/terminalLinks.ts";
import { ClipboardDIToken } from "../../platform/clipboard/common/iClipboard.ts";
import { IConfigurationServiceDIToken } from "../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { TerminalSessionFactoryDIToken } from "../contrib/terminal/common/terminalSessionFactory.ts";
import { ExtensionPtySession } from "../contrib/terminal/node/extensionPtySession.ts";

function mouse(action: MouseToken["action"], x: number, y: number, modifiers: Partial<MouseToken> = {}): MouseToken {
    // Terminal tokens are 1-based.
    return {
        kind: "mouse",
        button: "left",
        action,
        x: x + 1,
        y: y + 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
        ...modifiers,
    };
}

/** #1088: double and triple click, Shift+click, `wordSeparators` and `copyOnSelection` in the terminal. */
describe("Workbench — the terminal's double and triple click", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let sessions: ExtensionPtySession[];

    async function boot(): Promise<void> {
        ws = createTempWorkspace({ prefix: "diode-terminal-clicks-", files: { "a.txt": "alpha\n" } });
        sessions = [];
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            openFile: ws.path("a.txt"),
            size: { width: 80, height: 30 } as never,
            containerOverrides: (container) => {
                container.bind(TerminalSessionFactoryDIToken, () => (options) => {
                    const session = new ExtensionPtySession({
                        cols: options.cols,
                        rows: options.rows,
                        name: "bash",
                        onInput: () => undefined,
                        onResize: () => undefined,
                    });
                    sessions.push(session);
                    return session;
                });
            },
        });
        h.commands.execute("workbench.action.terminal.toggleTerminal");
        await sessions[0].xtermReady;
        await feed(sessions[0], "$ echo some/path/file.ts other\r\nsome/path/file.ts other\r\n$ ");
        h.testApp.render();
    }

    afterEach(() => {
        for (const session of sessions) session.dispose();
        h.dispose();
        ws.dispose();
    });

    function origin(): { x: number; y: number } {
        const focused = h.testApp.focusedElement;
        expect(focused).toBeInstanceOf(TerminalViewElement);
        return (focused as TerminalViewElement).globalPosition;
    }

    /** `clicks` presses in a row on one cell, the way a terminal reports a double or triple click. */
    function clickInTerminal(col: number, row: number, clicks: number, modifiers: Partial<MouseToken> = {}): void {
        const { x, y } = origin();
        for (let i = 0; i < clicks; i++) {
            h.testApp.backend.simulateMouse(mouse("press", x + col, y + row, modifiers));
            h.testApp.backend.simulateMouse(mouse("release", x + col, y + row, modifiers));
        }
        h.testApp.render();
    }

    /** The cells of the row painted with the selection background, as `#`. */
    function painted(row: number, width: number): string {
        const { x, y } = origin();
        const focused = h.testApp.focusedElement as TerminalViewElement;
        const selection = focused.styleVar("terminal.selectionBackground");
        return Array.from({ length: width }, (_, col) =>
            h.testApp.backend.getBgAt(new Point(x + col, y + row)) === selection ? "#" : ".",
        ).join("");
    }

    const clipboard = (): Promise<string> => h.container.get(ClipboardDIToken).readText();

    it("a double click selects the word, Ctrl+C copies it", async () => {
        await boot();

        clickInTerminal(10, 1, 2);
        expect(painted(1, 24)).toBe("#################.......");

        h.testApp.sendKey("Ctrl+C");
        await vi.waitFor(async () => {
            expect(await clipboard()).toBe("some/path/file.ts");
        });
    });

    it("a change of terminal.integrated.wordSeparators applies to the next double click", async () => {
        await boot();
        await h.container
            .get(IConfigurationServiceDIToken)
            .updateValue("terminal.integrated.wordSeparators", " ()[]{}',\"`/");

        clickInTerminal(7, 1, 2);

        expect(painted(1, 24)).toBe(".....####...............");
    });

    it("a triple click selects the line; Shift+click moves the selection's end", async () => {
        await boot();

        // The line is selected edge to edge.
        clickInTerminal(3, 1, 3);
        expect([painted(0, 24), painted(1, 24), painted(2, 24)]).toEqual([
            "........................",
            "########################",
            "........................",
        ]);

        clickInTerminal(5, 1, 2);
        clickInTerminal(20, 1, 1, { shiftKey: true });
        expect(painted(1, 24)).toBe("#####################...");
    });

    it("with terminal.integrated.copyOnSelection, a double click copies the word without Ctrl+C", async () => {
        await boot();
        await h.container.get(ClipboardDIToken).writeText("before");

        clickInTerminal(10, 1, 2);
        expect(painted(1, 24)).toBe("#################.......");
        expect(await clipboard()).toBe("before");

        await h.container.get(IConfigurationServiceDIToken).updateValue("terminal.integrated.copyOnSelection", true);
        clickInTerminal(19, 1, 2);
        await vi.waitFor(async () => {
            expect(await clipboard()).toBe("other");
        });

        // A click that clears the selection leaves the clipboard as is.
        await h.container.get(ClipboardDIToken).writeText("kept");
        clickInTerminal(2, 1, 1);
        expect(painted(1, 24)).toBe("........................");
        expect(await clipboard()).toBe("kept");
    });
});
