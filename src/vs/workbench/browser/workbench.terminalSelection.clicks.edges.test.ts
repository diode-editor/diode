import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { feed } from "../../../TestUtils/terminalLinks.ts";
import { createTestConfigurationService } from "../../../TestUtils/testConfigurationService.ts";
import { ClipboardDIToken } from "../../platform/clipboard/common/iClipboard.ts";
import { IConfigurationServiceDIToken } from "../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { TerminalSessionFactoryDIToken } from "../contrib/terminal/common/terminalSessionFactory.ts";
import { ExtensionPtySession } from "../contrib/terminal/node/extensionPtySession.ts";

import { WorkbenchContextKeysDIToken } from "./workbenchContextKeys.ts";

interface IModifiers {
    readonly shift?: boolean;
    readonly ctrl?: boolean;
}

function mouse(action: MouseToken["action"], x: number, y: number, modifiers: IModifiers = {}): MouseToken {
    // Terminal tokens are 1-based.
    return {
        kind: "mouse",
        button: "left",
        action,
        x: x + 1,
        y: y + 1,
        shiftKey: modifiers.shift ?? false,
        altKey: false,
        ctrlKey: modifiers.ctrl ?? false,
        raw: "",
    };
}

/** #1088, the spec's edges: what a user sees and gets in the clipboard after multi-clicks in the terminal. */
describe("Workbench — the terminal's double and triple click, edges", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let sessions: ExtensionPtySession[];
    let cols: number[];
    /** What reached the shell, per session. */
    let input: string[][];

    async function boot(
        output: string,
        settings?: Readonly<Record<string, unknown>>,
        size = new Size(80, 30),
    ): Promise<void> {
        ws = createTempWorkspace({
            prefix: "diode-terminal-clicks-edges-",
            files: { "a.txt": "alpha beta\n", "src/b.ts": "one\ntwo\nthree\n" },
        });
        sessions = [];
        cols = [];
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
        await sessions[0].xtermReady;
        await feed(sessions[0], output);
        h.testApp.render();
        view = h.testApp.focusedElement as TerminalViewElement;
        expect(view).toBeInstanceOf(TerminalViewElement);
    }

    let view: TerminalViewElement;

    afterEach(() => {
        for (const session of sessions) session.dispose();
        h.dispose();
        ws.dispose();
    });

    function send(action: MouseToken["action"], at: [number, number], modifiers: IModifiers = {}): void {
        const { x, y } = view.globalPosition;
        h.testApp.backend.simulateMouse(mouse(action, x + at[0], y + at[1], modifiers));
    }

    /** `clicks` presses in a row on one cell, the way a terminal reports a double or triple click. */
    function click(at: [number, number], clicks = 1, modifiers: IModifiers = {}): void {
        for (let i = 0; i < clicks; i++) {
            send("press", at, modifiers);
            send("release", at, modifiers);
        }
        h.testApp.render();
    }

    /** `clicks - 1` clicks, then a press that drags to `to` and releases. */
    function clickDrag(at: [number, number], clicks: number, to: [number, number]): void {
        for (let i = 0; i < clicks - 1; i++) {
            send("press", at);
            send("release", at);
        }
        send("press", at);
        send("move", to);
        send("release", to);
        h.testApp.render();
    }

    /** The cells of the row painted with the selection background, as `#`. */
    function painted(row: number, width: number): string {
        const { x, y } = view.globalPosition;
        const selection = view.styleVar("terminal.selectionBackground");
        return Array.from({ length: width }, (_, col) =>
            h.testApp.backend.getBgAt(new Point(x + col, y + row)) === selection ? "#" : ".",
        ).join("");
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

    const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50));

    it("a double click on the soft-wrapped part of a word selects the whole word on both rows", async () => {
        await boot("");
        const width = view.layoutSize.width;
        // `head-` ends the first row, the word goes on `tail` on the next one.
        await feed(sessions[0], `${"x".repeat(width - 6)} head-tail end\r\n$ `);
        h.testApp.render();

        click([1, 1], 2);

        expect(await copied()).toBe("head-tail");
    });

    it("a double click on a space selects only that space", async () => {
        await boot("foo   bar\r\n$ ");

        click([4, 0], 2);

        expect(painted(0, 12)).toBe("....#.......");
    });

    it("a double click on a non-space separator selects only it", async () => {
        await boot("call(arg)\r\n$ ");

        click([4, 0], 2);

        expect(painted(0, 12)).toBe("....#.......");
        expect(await copied()).toBe("(");
    });

    it("a double click right of the text selects nothing", async () => {
        await boot("short\r\n$ ");

        click([30, 0], 2);

        expect(painted(0, 40)).toBe(".".repeat(40));
        expect(selectedKey()).toBe(false);
    });

    it("a double click then a drag to the right grows by whole words", async () => {
        await boot("alpha beta gamma delta\r\n$ ");

        clickDrag([2, 0], 2, [12, 0]);

        expect(await copied()).toBe("alpha beta gamma");
    });

    it("a double click then a drag to the left keeps the anchor word whole", async () => {
        await boot("alpha beta gamma delta\r\n$ ");

        clickDrag([13, 0], 2, [7, 0]);

        expect(await copied()).toBe("beta gamma");
    });

    it("a triple click on the soft-wrapped row selects the whole logical line", async () => {
        await boot("");
        const width = view.layoutSize.width;
        const long = "w".repeat(width) + "rest";
        await feed(sessions[0], `${long}\r\nnext\r\n$ `);
        h.testApp.render();

        click([1, 1], 3);

        expect(await copied()).toBe(long);
        expect(painted(2, 4)).toBe("....");
    });

    it("a triple click then a drag down grows by whole lines", async () => {
        await boot("one-aaaa\r\ntwo-bbbb\r\nthree-cc\r\n$ ");

        clickDrag([5, 0], 3, [1, 1]);

        expect(await copied()).toBe("one-aaaa\ntwo-bbbb");
    });

    it("a fourth click in a row keeps the line", async () => {
        await boot("one two three\r\n$ ");

        click([5, 0], 4);

        expect(await copied()).toBe("one two three");
    });

    it("Shift+click before the anchor selects from the click to the original anchor, as a drag back would", async () => {
        await boot("alpha beta gamma delta\r\n$ ");
        // A drag from `gamma` to its end: the anchor is column 11.
        send("press", [11, 0]);
        send("move", [16, 0]);
        send("release", [16, 0]);

        click([6, 0], 1, { shift: true });

        // The anchor cell stays in, like a drag from it to the left.
        expect(await copied()).toBe("beta g");
    });

    it("Shift+click inside the selection shrinks it", async () => {
        await boot("alpha beta gamma delta\r\n$ ");
        send("press", [0, 0]);
        send("move", [21, 0]);
        send("release", [21, 0]);

        click([5, 0], 1, { shift: true });

        expect(await copied()).toBe("alpha");
    });

    it("Shift+click before a double-clicked word keeps the word whole", async () => {
        await boot("alpha beta gamma delta\r\n$ ");
        click([13, 0], 2);

        click([1, 0], 1, { shift: true });

        expect(await copied()).toBe("lpha beta gamma");
    });

    it("Shift+click before a triple-clicked line keeps the line whole", async () => {
        await boot("one-aaaa\r\ntwo-bbbb\r\nthree-cc\r\n$ ");
        click([3, 1], 3);

        click([4, 0], 1, { shift: true });

        expect(await copied()).toBe("aaaa\ntwo-bbbb");
    });

    it("two quick clicks on different words are two single clicks, not a double click", async () => {
        await boot("alpha beta gamma\r\n$ ");

        click([1, 0]);
        click([7, 0]);

        expect(selectedKey()).toBe(false);
    });

    it("a double click replaces a drag selection elsewhere", async () => {
        await boot("alpha beta\r\ngamma delta\r\n$ ");
        send("press", [0, 0]);
        send("move", [8, 0]);
        send("release", [8, 0]);

        click([8, 1], 2);

        expect(await copied()).toBe("delta");
        expect(painted(0, 10)).toBe("..........");
    });

    it("Shift+click without a selection is a plain click: nothing selected, Ctrl+C goes to the shell", async () => {
        await boot("hello world\r\n$ ");

        click([6, 0], 1, { shift: true });

        expect(selectedKey()).toBe(false);
        expect(painted(0, 12)).toBe("............");
        h.testApp.sendKey("Ctrl+C");
        expect(input[0]).toEqual(["\x03"]);
    });

    it("an empty terminal.integrated.wordSeparators makes a double click take the whole run of text", async () => {
        await boot("a(b)c,d e\r\n$ ");
        await h.container.get(IConfigurationServiceDIToken).updateValue("terminal.integrated.wordSeparators", "");

        click([2, 0], 2);

        expect(await copied()).toBe("a(b)c,d e");
    });

    it("Cyrillic is part of a word", async () => {
        await boot("привет мир\r\n$ ");

        click([2, 0], 2);

        expect(await copied()).toBe("привет");
    });

    it("a double click on the right half of a wide character selects the whole CJK word", async () => {
        await boot("ab 中文字 end\r\n$ ");

        // 中 takes columns 3–4, 文 5–6, 字 7–8; the click is on 文's right half.
        click([6, 0], 2);

        expect(await copied()).toBe("中文字");
        expect(painted(0, 12)).toBe("...######...");
    });

    describe("with copyOnSelection on", () => {
        const on = { "terminal.integrated.copyOnSelection": true };

        it("the release after a drag copies, the drag steps do not", async () => {
            await boot("hello world\r\n$ ", on);
            await h.container.get(ClipboardDIToken).writeText("before");

            send("press", [0, 0]);
            send("move", [2, 0]);
            send("move", [4, 0]);
            h.testApp.render();
            await settle();
            expect(await clipboard()).toBe("before");

            send("release", [4, 0]);
            h.testApp.render();
            await vi.waitFor(async () => {
                expect(await clipboard()).toBe("hello");
            });
        });

        it("a double click then a drag copies on release, not on the second press", async () => {
            await boot("alpha beta gamma\r\n$ ", on);
            await h.container.get(ClipboardDIToken).writeText("before");

            send("press", [1, 0]);
            send("release", [1, 0]);
            send("press", [1, 0]);
            send("move", [8, 0]);
            h.testApp.render();
            await settle();
            expect(await clipboard()).toBe("before");

            send("release", [8, 0]);
            h.testApp.render();
            await vi.waitFor(async () => {
                expect(await clipboard()).toBe("alpha beta");
            });
        });

        it("a double click right of the text and a Shift+click without a selection leave the clipboard alone", async () => {
            await boot("short\r\n$ ", on);
            await h.container.get(ClipboardDIToken).writeText("kept");

            click([30, 0], 2);
            click([2, 0], 1, { shift: true });
            await settle();

            expect(await clipboard()).toBe("kept");
        });

        it("a triple click copies the line", async () => {
            await boot("one two three\r\n$ ", on);

            click([5, 0], 3);

            await vi.waitFor(async () => {
                expect(await clipboard()).toBe("one two three");
            });
        });

        it("Shift+click copies the extended selection", async () => {
            await boot("alpha beta gamma\r\n$ ", on);
            click([1, 0], 2);
            await vi.waitFor(async () => {
                expect(await clipboard()).toBe("alpha");
            });

            click([9, 0], 1, { shift: true });

            await vi.waitFor(async () => {
                expect(await clipboard()).toBe("alpha beta");
            });
        });

        it("Select All copies everything", async () => {
            await boot("first\r\nsecond\r\n$ ", on);

            h.commands.execute("workbench.action.terminal.selectAll");

            await vi.waitFor(async () => {
                expect(await clipboard()).toMatch(/^first\nsecond\n\$/u);
            });
        });
    });

    describe("with mouse tracking on", () => {
        const tracking = "hello world\r\n$ \x1b[?1000h\x1b[?1002h\x1b[?1006h";

        it("a double click goes to the program as two presses and selects nothing", async () => {
            await boot(tracking);

            click([1, 0], 2);

            expect(selectedKey()).toBe(false);
            expect(input[0].join("").split("\x1b[<0;2;1M")).toHaveLength(3);
        });

        it("a triple click goes to the program and selects nothing", async () => {
            await boot(tracking);

            click([1, 0], 3);

            expect(selectedKey()).toBe(false);
            expect(input[0].join("").split("\x1b[<0;2;1M")).toHaveLength(4);
        });

        it("Shift+double click selects the word and nothing reaches the program", async () => {
            await boot(tracking);

            click([7, 0], 2, { shift: true });

            expect(input[0]).toEqual([]);
            expect(await copied()).toBe("world");
        });
    });

    it("Ctrl+double click on a file link opens it and selects no word", async () => {
        await boot("see src/b.ts:2 here\r\n$ ");
        send("move", [6, 0], { ctrl: true });
        await settle();

        click([6, 0], 2, { ctrl: true });

        await vi.waitFor(() => {
            expect(h.activeEditor().uri.fsPath).toBe(ws.path("src/b.ts"));
        });
        expect(selectedKey()).toBe(false);
    });
});
