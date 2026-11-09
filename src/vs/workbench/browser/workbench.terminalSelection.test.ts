import { Point } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { feed } from "../../../TestUtils/terminalLinks.ts";
import { ClipboardDIToken } from "../../platform/clipboard/common/iClipboard.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { TerminalServiceDIToken } from "../contrib/terminal/browser/terminalService.ts";
import { TerminalSessionFactoryDIToken } from "../contrib/terminal/common/terminalSessionFactory.ts";
import { ExtensionPtySession } from "../contrib/terminal/node/extensionPtySession.ts";
import { TerminalSelectionServiceDIToken } from "../contrib/terminalContrib/selection/browser/terminalSelectionService.ts";

import { WorkbenchContextKeysDIToken } from "./workbenchContextKeys.ts";

function mouse(action: MouseToken["action"], x: number, y: number, shiftKey = false): MouseToken {
    // Terminal tokens are 1-based.
    return {
        kind: "mouse",
        button: "left",
        action,
        x: x + 1,
        y: y + 1,
        shiftKey,
        altKey: false,
        ctrlKey: false,
        raw: "",
    };
}

/** #1087: a drag in the terminal selects, Ctrl+C with a selection copies it instead of sending SIGINT. */
describe("Workbench — the terminal's text selection", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let sessions: ExtensionPtySession[];
    /** What reached the shell, per session. */
    let input: string[][];

    async function boot(where: "panel" | "editor" = "panel"): Promise<ExtensionPtySession> {
        ws = createTempWorkspace({ prefix: "diode-terminal-selection-", files: { "a.txt": "alpha\n" } });
        sessions = [];
        input = [];
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            openFile: ws.path("a.txt"),
            size: { width: 80, height: 30 } as never,
            containerOverrides: (container) => {
                container.bind(TerminalSessionFactoryDIToken, () => (options) => {
                    const written: string[] = [];
                    input.push(written);
                    const session = new ExtensionPtySession({
                        cols: options.cols,
                        rows: options.rows,
                        name: "bash",
                        onInput: (data) => written.push(data),
                        onResize: () => undefined,
                    });
                    sessions.push(session);
                    return session;
                });
            },
        });
        h.commands.execute(
            where === "panel" ? "workbench.action.terminal.toggleTerminal" : "workbench.action.createTerminalEditor",
        );
        const session = sessions[0];
        await session.xtermReady;
        await feed(session, "$ echo hello world\r\nhello world\r\n$ ");
        h.testApp.render();
        return session;
    }

    afterEach(() => {
        for (const session of sessions) session.dispose();
        h.dispose();
        ws.dispose();
    });

    function widget(): TerminalViewElement {
        const focused = h.testApp.focusedElement;
        expect(focused).toBeInstanceOf(TerminalViewElement);
        return focused as TerminalViewElement;
    }

    function dragInTerminal(from: [number, number], to: [number, number], shift = false): void {
        const { x, y } = widget().globalPosition;
        const backend = h.testApp.backend;
        backend.simulateMouse(mouse("press", x + from[0], y + from[1], shift));
        backend.simulateMouse(mouse("move", x + to[0], y + to[1], shift));
        backend.simulateMouse(mouse("release", x + to[0], y + to[1], shift));
        h.testApp.render();
    }

    function bgAt(col: number, row: number): number {
        const { x, y } = widget().globalPosition;
        return h.testApp.backend.getBgAt(new Point(x + col, y + row));
    }

    function contextKey(key: "terminalTextSelected" | "terminalTextSelectedInFocused"): unknown {
        h.container.get(WorkbenchContextKeysDIToken).update();
        return h.container.get(ContextKeyServiceDIToken).get(key);
    }

    const clipboard = (): Promise<string> => h.container.get(ClipboardDIToken).readText();

    it("a drag paints the selected cells with terminal.selectionBackground and sets the context keys", async () => {
        await boot();
        const plain = bgAt(0, 1);

        dragInTerminal([0, 1], [4, 1]);

        const selection = widget().styleVar("terminal.selectionBackground");
        expect([0, 1, 2, 3, 4].map((col) => bgAt(col, 1))).toEqual(Array(5).fill(selection));
        expect(bgAt(5, 1)).toBe(plain);
        expect(contextKey("terminalTextSelected")).toBe(true);
        expect(contextKey("terminalTextSelectedInFocused")).toBe(true);
    });

    it("Ctrl+C with a selection copies it and clears it, nothing reaches the shell; without one it is ^C", async () => {
        await boot();
        dragInTerminal([0, 1], [10, 1]);

        h.testApp.sendKey("Ctrl+C");

        await vi.waitFor(async () => {
            expect(await clipboard()).toBe("hello world");
        });
        expect(input[0]).toEqual([]);
        expect(contextKey("terminalTextSelected")).toBe(false);
        h.testApp.render();
        expect(bgAt(0, 1)).toBe(bgAt(0, 3));

        h.testApp.sendKey("Ctrl+C");
        expect(input[0]).toEqual(["\x03"]);
    });

    it("Escape clears the selection; without one it goes to the shell", async () => {
        await boot();
        dragInTerminal([0, 1], [4, 1]);

        h.testApp.sendKey("Escape");
        expect(contextKey("terminalTextSelected")).toBe(false);
        expect(input[0]).toEqual([]);

        h.testApp.sendKey("Escape");
        expect(input[0]).toEqual(["\x1b"]);
    });

    it("typing into the shell clears the selection", async () => {
        await boot();
        dragInTerminal([0, 1], [4, 1]);

        h.testApp.sendKey("a");

        expect(input[0]).toEqual(["a"]);
        expect(contextKey("terminalTextSelected")).toBe(false);
    });

    it("copying without a selection leaves the clipboard as is, whatever the context keys said", async () => {
        await boot();
        await h.container.get(ClipboardDIToken).writeText("before");

        await h.container.get(TerminalSelectionServiceDIToken).copySelection();

        expect(await clipboard()).toBe("before");
    });

    it("without a terminal the selection commands do nothing", async () => {
        await boot();
        h.commands.execute("workbench.action.terminal.kill");
        await vi.waitFor(() => {
            expect(h.container.get(TerminalServiceDIToken).getActiveInstanceAcrossHosts()).toBeNull();
        });
        await h.container.get(ClipboardDIToken).writeText("before");
        const service = h.container.get(TerminalSelectionServiceDIToken);

        service.selectAll();
        service.clearSelection();
        await service.copySelection();

        expect(await clipboard()).toBe("before");
    });

    it("Copy Selection keeps the selection; Select All takes the whole buffer", async () => {
        await boot();
        dragInTerminal([0, 1], [4, 1]);

        h.commands.execute("workbench.action.terminal.copySelection");
        await vi.waitFor(async () => {
            expect(await clipboard()).toBe("hello");
        });
        expect(contextKey("terminalTextSelected")).toBe(true);

        h.commands.execute("workbench.action.terminal.selectAll");
        h.commands.execute("workbench.action.terminal.copySelection");
        await vi.waitFor(async () => {
            // As xterm.js: the screen's empty rows below the prompt are lines too.
            expect(await clipboard()).toMatch(/^\$ echo hello world\nhello world\n\$\n+$/u);
        });
    });

    it("unfocused, the selection stays and is painted with terminal.inactiveSelectionBackground", async () => {
        await boot();
        const terminal = widget();
        dragInTerminal([0, 1], [4, 1]);

        h.workbench.focusEditor();
        h.testApp.render();

        expect(contextKey("terminalTextSelected")).toBe(true);
        expect(contextKey("terminalTextSelectedInFocused")).toBe(false);
        const { x, y } = terminal.globalPosition;
        const bg = h.testApp.backend.getBgAt(new Point(x, y + 1));
        expect(bg).not.toBe(terminal.styleVar("terminal.selectionBackground"));
        expect(bg).not.toBe(h.testApp.backend.getBgAt(new Point(x, y + 3)));
    });

    it("each terminal keeps its own selection across switching tabs", async () => {
        await boot();
        const terminals = h.container.get(TerminalServiceDIToken);
        h.commands.execute("workbench.action.terminal.new");
        await sessions[1].xtermReady;
        await feed(sessions[1], "second");
        h.testApp.render();
        const [first, second] = terminals.getInstances();

        terminals.setActiveInstance(first.id);
        h.testApp.render();
        dragInTerminal([0, 1], [4, 1]);
        terminals.setActiveInstance(second.id);
        h.testApp.render();
        expect(contextKey("terminalTextSelected")).toBe(false);
        dragInTerminal([0, 0], [2, 0]);

        terminals.setActiveInstance(first.id);
        h.testApp.render();
        h.commands.execute("workbench.action.terminal.copySelection");
        await vi.waitFor(async () => {
            expect(await clipboard()).toBe("hello");
        });
        terminals.setActiveInstance(second.id);
        h.testApp.render();
        h.commands.execute("workbench.action.terminal.copySelection");
        await vi.waitFor(async () => {
            expect(await clipboard()).toBe("sec");
        });
    });

    it("a terminal in an editor tab selects and copies the same way", async () => {
        await boot("editor");
        dragInTerminal([7, 0], [11, 0]);

        h.testApp.sendKey("Ctrl+C");

        await vi.waitFor(async () => {
            expect(await clipboard()).toBe("hello");
        });
        expect(input[0]).toEqual([]);
    });
});
