import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { feed } from "../../../TestUtils/terminalLinks.ts";
import { createTestConfigurationService, EXTENDED_TIER_SETTINGS } from "../../../TestUtils/testConfigurationService.ts";
import { ClipboardDIToken } from "../../platform/clipboard/common/iClipboard.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { TerminalServiceDIToken } from "../contrib/terminal/browser/terminalService.ts";
import { TerminalSessionFactoryDIToken } from "../contrib/terminal/common/terminalSessionFactory.ts";
import { ExtensionPtySession } from "../contrib/terminal/node/extensionPtySession.ts";

import { QuickInputComponentDIToken } from "./parts/quickinput/quickInputComponent.ts";
import { WorkbenchContextKeysDIToken } from "./workbenchContextKeys.ts";

interface IModifiers {
    readonly shift?: boolean;
    readonly ctrl?: boolean;
}

function mouse(
    action: MouseToken["action"],
    x: number,
    y: number,
    modifiers: IModifiers = {},
    button: MouseToken["button"] = "left",
): MouseToken {
    // Terminal tokens are 1-based.
    return {
        kind: "mouse",
        button,
        action,
        x: x + 1,
        y: y + 1,
        shiftKey: modifiers.shift ?? false,
        altKey: false,
        ctrlKey: modifiers.ctrl ?? false,
        raw: "",
    };
}

/** #1087, the spec's edges: what a user sees and gets in the clipboard after dragging in the terminal. */
describe("Workbench — the terminal's text selection, edges", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let sessions: ExtensionPtySession[];
    let cols: number[];
    let rowsOf: number[];
    /** What reached the shell, per session. */
    let input: string[][];

    async function boot(
        output: string,
        size = new Size(80, 30),
        settings?: Readonly<Record<string, unknown>>,
    ): Promise<ExtensionPtySession> {
        ws = createTempWorkspace({ prefix: "diode-terminal-selection-edges-", files: { "a.txt": "alpha beta\n" } });
        sessions = [];
        cols = [];
        rowsOf = [];
        input = [];
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            openFile: ws.path("a.txt"),
            size,
            configurationService: settings === undefined ? undefined : createTestConfigurationService(settings),
            containerOverrides: (container) => {
                container.bind(TerminalSessionFactoryDIToken, () => (options) => {
                    const written: string[] = [];
                    input.push(written);
                    cols.push(options.cols);
                    rowsOf.push(options.rows);
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
        h.commands.execute("workbench.action.terminal.toggleTerminal");
        const session = sessions[0];
        await session.xtermReady;
        await feed(session, output);
        h.testApp.render();
        widgetAtBoot = undefined;
        widget();
        return session;
    }

    afterEach(() => {
        for (const session of sessions) session.dispose();
        h.dispose();
        ws.dispose();
    });

    let widgetAtBoot: TerminalViewElement | undefined;
    function widget(): TerminalViewElement {
        const focused = h.testApp.focusedElement;
        if (focused instanceof TerminalViewElement) {
            widgetAtBoot = focused;
            return focused;
        }
        expect(widgetAtBoot).toBeInstanceOf(TerminalViewElement);
        return widgetAtBoot!;
    }

    function send(action: MouseToken["action"], at: [number, number], modifiers: IModifiers = {}): void {
        const { x, y } = widget().globalPosition;
        const button = action.startsWith("scroll") ? "none" : "left";
        h.testApp.backend.simulateMouse(mouse(action, x + at[0], y + at[1], modifiers, button));
    }

    function drag(from: [number, number], to: [number, number], modifiers: IModifiers = {}): void {
        send("press", from, modifiers);
        send("move", to, modifiers);
        send("release", to, modifiers);
        h.testApp.render();
    }

    function bgAt(col: number, row: number): number {
        const { x, y } = widget().globalPosition;
        return h.testApp.backend.getBgAt(new Point(x + col, y + row));
    }

    function rowText(row: number): string {
        const { x, y } = widget().globalPosition;
        return h.testApp.backend.getTextAt(new Point(x, y + row), cols[0]);
    }

    function findRow(text: string): number {
        for (let row = 0; row < rowsOf[0]; row++) {
            if (rowText(row).includes(text)) return row;
        }
        return -1;
    }

    function selectedKey(): unknown {
        h.container.get(WorkbenchContextKeysDIToken).update();
        return h.container.get(ContextKeyServiceDIToken).get("terminalTextSelected");
    }

    const clipboard = (): Promise<string> => h.container.get(ClipboardDIToken).readText();

    async function copied(): Promise<string> {
        await h.container.get(ClipboardDIToken).writeText("<untouched>");
        h.commands.execute("workbench.action.terminal.copySelection");
        let text = "<untouched>";
        await vi.waitFor(async () => {
            text = await clipboard();
            expect(text).not.toBe("<untouched>");
        });
        return text;
    }

    const selectionBg = (): number => widget().styleVar("terminal.selectionBackground");

    it("a drag over three lines takes the first from the press, the middle whole, the last up to the pointer", async () => {
        await boot("one-aaaa\r\ntwo-bbbb\r\nthree-cc\r\n$ ");

        drag([4, 0], [2, 2]);

        expect(await copied()).toBe("aaaa\ntwo-bbbb\nthr");
    });

    it("a drag upward and to the left takes the same text as the drag down", async () => {
        await boot("one-aaaa\r\ntwo-bbbb\r\nthree-cc\r\n$ ");

        drag([2, 2], [4, 0]);

        expect(await copied()).toBe("aaaa\ntwo-bbbb\nthr");
    });

    it("a drag to the left on one line takes the text between the two points", async () => {
        await boot("hello world\r\n$ ");

        drag([10, 0], [6, 0]);

        expect(await copied()).toBe("world");
    });

    it("a plain click clears the selection and creates none: Ctrl+C then goes to the shell", async () => {
        await boot("hello world\r\n$ ");
        drag([0, 0], [4, 0]);
        expect(selectedKey()).toBe(true);

        drag([2, 0], [2, 0]);

        expect(selectedKey()).toBe(false);
        expect(bgAt(0, 0)).not.toBe(selectionBg());
        h.testApp.sendKey("Ctrl+C");
        expect(input[0]).toEqual(["\x03"]);
    });

    it("a soft-wrapped line is copied without a newline, a real line break is \\n", async () => {
        await boot("");
        const width = cols[0];
        const long = "x".repeat(width) + "yyy";
        await feed(sessions[0], `${long}\r\nnext\r\n$ `);
        h.testApp.render();

        drag([0, 0], [3, 2]);

        expect(await copied()).toBe(`${long}\nnext`);
    });

    it("trailing blanks are trimmed from every line, also on a drag past the end of a short line", async () => {
        await boot("ab   \r\ncd\r\n$ ");

        drag([0, 0], [30, 1]);

        expect(await copied()).toBe("ab\ncd");
    });

    it("wide characters are copied once; starting on the right half of one takes it whole", async () => {
        await boot("中文字 end\r\n$ ");

        // 中 takes columns 0–1, 文 2–3, 字 4–5. The press is on 中's right half.
        drag([1, 0], [3, 0]);

        expect(await copied()).toBe("中文");
    });

    it("an emoji is copied once, without a blank for its second half", async () => {
        await boot("a😀b\r\n$ ");

        drag([0, 0], [3, 0]);

        expect(await copied()).toBe("a😀b");
    });

    it("Cyrillic is copied as is", async () => {
        await boot("привет мир\r\n$ ");

        drag([0, 0], [9, 0]);

        expect(await copied()).toBe("привет мир");
    });

    it("new output keeps the selection on its text, also when it scrolls the screen", async () => {
        const lines = Array.from({ length: 5 }, (_, i) => `line-${String(i).padStart(2, "0")}`);
        await boot(`${lines.join("\r\n")}\r\n`);
        drag([0, 2], [6, 2]);

        // Enough output to push line-02 up the screen (the panel is shorter than 40 rows).
        const more = Array.from({ length: 12 }, (_, i) => `more-${i}`).join("\r\n");
        await feed(sessions[0], more);
        h.testApp.render();

        expect(selectedKey()).toBe(true);
        expect(await copied()).toBe("line-02");
        const row = findRow("line-02");
        if (row >= 0) expect(bgAt(0, row)).toBe(selectionBg());
    });

    it("the wheel scrolls the scrollback and the highlight stays on its buffer line", async () => {
        const lines = Array.from({ length: 60 }, (_, i) => `line-${String(i).padStart(2, "0")}`);
        await boot(`${lines.join("\r\n")}\r\n$ `);
        const label = rowText(1).trim();
        expect(label).toMatch(/^line-\d\d$/u);
        drag([0, 1], [6, 1]);

        send("scroll-up", [2, 2]);
        h.testApp.render();

        const after = findRow(label);
        expect(after).toBeGreaterThan(1);
        expect(bgAt(0, after)).toBe(selectionBg());
        expect(bgAt(0, 1)).not.toBe(selectionBg());
        expect(await copied()).toBe(label);
    });

    it("switching to the alternate buffer clears the selection", async () => {
        await boot("hello world\r\n$ ");
        drag([0, 0], [4, 0]);

        await feed(sessions[0], "\x1b[?1049h");
        h.testApp.render();

        expect(selectedKey()).toBe(false);
    });

    it("with mouse tracking on, a plain drag goes to the program and selects nothing", async () => {
        await boot("hello world\r\n$ \x1b[?1000h\x1b[?1002h\x1b[?1006h");

        drag([0, 0], [4, 0]);

        expect(selectedKey()).toBe(false);
        expect(input[0].join("")).toContain("\x1b[<0;1;1M");
    });

    it("with mouse tracking on, Shift+drag selects and nothing reaches the program", async () => {
        await boot("hello world\r\n$ \x1b[?1000h\x1b[?1002h\x1b[?1006h");

        drag([0, 0], [4, 0], { shift: true });

        expect(input[0]).toEqual([]);
        expect(await copied()).toBe("hello");
    });

    it("Ctrl+drag selects", async () => {
        await boot("hello world\r\n$ ");

        drag([6, 0], [10, 0], { ctrl: true });

        expect(await copied()).toBe("world");
    });

    it("dragging past the top edge scrolls the scrollback and the selection follows", async () => {
        const lines = Array.from({ length: 60 }, (_, i) => `line-${String(i).padStart(2, "0")}`);
        await boot(`${lines.join("\r\n")}\r\n$ `);
        const top = rowText(0).trim();
        const end = rowText(5).trim();
        expect([top, end]).toEqual([expect.stringMatching(/^line-/u), expect.stringMatching(/^line-/u)]);
        send("press", [7, 5]);
        send("move", [3, -1]);
        await new Promise((resolve) => setTimeout(resolve, 400));
        send("release", [3, -1]);
        h.testApp.render();

        const text = await copied();
        // Lines above the original top row came into the selection.
        expect(text.startsWith(top)).toBe(false);
        expect(text).toContain(`${top}\n`);
        expect(text.endsWith(end)).toBe(true);
    });

    it("a resize with a selection does not break the terminal, and the selection can be cleared after it", async () => {
        await boot("hello world\r\n$ ");
        drag([0, 0], [4, 0]);

        h.testApp.backend.resize(new Size(60, 26));
        h.testApp.render();
        h.testApp.backend.resize(new Size(100, 30));
        h.testApp.render();

        h.commands.execute("workbench.action.terminal.clearSelection");
        expect(selectedKey()).toBe(false);
        h.testApp.sendKey("Ctrl+C");
        expect(input[0]).toEqual(["\x03"]);
    });

    it("killing the terminal with a selection resets terminalTextSelected", async () => {
        await boot("hello world\r\n$ ");
        h.commands.execute("workbench.action.terminal.new");
        await sessions[1].xtermReady;
        await feed(sessions[1], "second");
        h.testApp.render();
        const terminals = h.container.get(TerminalServiceDIToken);
        const [first, second] = terminals.getInstances();
        terminals.setActiveInstance(second.id);
        h.testApp.render();
        drag([0, 0], [3, 0]);
        expect(selectedKey()).toBe(true);

        h.commands.execute("workbench.action.terminal.kill");
        h.testApp.render();

        expect(terminals.getInstances().map((i) => i.id)).toEqual([first.id]);
        expect(selectedKey()).toBe(false);
    });

    it("with the editor focused, Ctrl+C copies the editor's selection, not the terminal's", async () => {
        await boot("hello world\r\n$ ");
        drag([0, 0], [4, 0]);

        h.workbench.focusEditor();
        h.testApp.render();
        h.testApp.sendKey("Ctrl+A");
        h.testApp.sendKey("Ctrl+C");

        await vi.waitFor(async () => {
            expect(await clipboard()).toBe("alpha beta\n");
        });
        expect(selectedKey()).toBe(true);
    });

    it("Copy Selection without a selection leaves the clipboard alone", async () => {
        await boot("hello world\r\n$ ");
        await h.container.get(ClipboardDIToken).writeText("kept");

        h.commands.execute("workbench.action.terminal.copySelection");
        h.commands.execute("workbench.action.terminal.copyAndClearSelection");
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(await clipboard()).toBe("kept");
        expect(input[0]).toEqual([]);
    });

    it("Select All over a 800-line scrollback copies all of it", async () => {
        const lines = Array.from({ length: 800 }, (_, i) => `row ${i}`);
        await boot(`${lines.join("\r\n")}\r\n$ `);

        const started = performance.now();
        h.commands.execute("workbench.action.terminal.selectAll");
        h.testApp.render();
        const text = await copied();
        const elapsed = performance.now() - started;

        expect(text.split("\n").slice(0, 3)).toEqual(lines.slice(0, 3));
        expect(text).toContain("row 799\n$");
        expect(elapsed).toBeLessThan(2000);
    });

    it("Escape that closes the Command Palette opened over the terminal keeps the terminal's selection", async () => {
        await boot("hello world\r\n$ ");
        drag([0, 0], [4, 0]);
        const quickInput = h.container.get(QuickInputComponentDIToken);

        h.testApp.sendKey("F1");
        h.testApp.render();
        expect(quickInput.isOpen()).toBe(true);
        h.testApp.sendKey("Escape");
        h.testApp.render();

        expect(quickInput.isOpen()).toBe(false);
        expect(selectedKey()).toBe(true);
        expect(bgAt(0, 0)).toBe(selectionBg());
        expect(input[0]).toEqual([]);
    });

    it("on the csi-u tier Ctrl+Shift+C copies and keeps the selection, nothing reaches the shell", async () => {
        await boot("hello world\r\n$ ", new Size(80, 30), EXTENDED_TIER_SETTINGS);
        drag([6, 0], [10, 0]);

        h.testApp.sendKey("Ctrl+Shift+C");

        await vi.waitFor(async () => {
            expect(await clipboard()).toBe("world");
        });
        expect(selectedKey()).toBe(true);
        expect(input[0]).toEqual([]);
    });

    it("hiding the panel and showing it again keeps the terminal's selection", async () => {
        await boot("hello world\r\n$ ");
        drag([0, 0], [4, 0]);

        h.commands.execute("workbench.action.togglePanel");
        h.testApp.render();
        h.commands.execute("workbench.action.togglePanel");
        h.testApp.render();

        expect(selectedKey()).toBe(true);
        expect(await copied()).toBe("hello");
    });
});
