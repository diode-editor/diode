import { DEFAULT_COLOR, parseHexColor } from "@tuidom/core/common/colorUtils";
import type { TerminalCell, TerminalMouseEventData } from "@tuidom/core/common/iTerminalSurface";
import { afterEach, describe, expect, it, vi } from "vitest";

import { emulatorWith, feed } from "../../../../../../TestUtils/terminalLinks.ts";
import type { ExtensionPtySession } from "../../../terminal/node/extensionPtySession.ts";

import {
    type ITerminalSelectionHost,
    type TerminalSelectionColor,
    TerminalSelectionSurface,
} from "./terminalSelectionSurface.ts";

const BACKGROUND = 0x101010;
const SELECTION = 0x264f78;
const INACTIVE = parseHexColor("#264F7880");

function mouse(
    col: number,
    row: number,
    action: TerminalMouseEventData["action"],
    { button = "left", ctrl = false, shift = false }: Partial<TerminalMouseEventData> = {},
): TerminalMouseEventData {
    return { col, row, action, button, ctrl, alt: false, shift };
}

class FakeHost implements ITerminalSelectionHost {
    public readonly colors: Partial<Record<TerminalSelectionColor, number>> = {
        "terminal.background": BACKGROUND,
        "terminal.selectionBackground": SELECTION,
        "terminal.inactiveSelectionBackground": INACTIVE,
    };

    public styleVar(name: TerminalSelectionColor, fallback?: number): number {
        const color = this.colors[name] ?? fallback;
        if (color === undefined) throw new Error(`unknown ${name}`);
        return color;
    }
}

describe("TerminalSelectionSurface", () => {
    let session: ExtensionPtySession;
    let surface: TerminalSelectionSurface;
    let host: FakeHost;
    let updates: number;

    async function setup(output: string, cols = 10, rows = 4): Promise<void> {
        session = await emulatorWith(output, cols, rows);
        surface = new TerminalSelectionSurface(session);
        host = new FakeHost();
        surface.attach(host);
        surface.setFocused(true);
        updates = 0;
        surface.onUpdate(() => {
            updates++;
        });
    }

    afterEach(() => {
        vi.useRealTimers();
        session.dispose();
    });

    function drag(from: [number, number], ...to: [number, number][]): void {
        surface.sendMouse(mouse(from[0], from[1], "down"));
        for (const [col, row] of to) surface.sendMouse(mouse(col, row, "move", { button: "none" }));
        const last = to.at(-1) ?? from;
        surface.sendMouse(mouse(last[0], last[1], "up"));
    }

    function cellAt(x: number, y: number): TerminalCell {
        const cell: TerminalCell = { char: " ", fg: DEFAULT_COLOR, bg: DEFAULT_COLOR, style: 0, width: 1 };
        surface.readCell(x, y, cell);
        return cell;
    }

    /** `#` — a cell painted with the selection background. */
    function painted(y: number, width = 10): string {
        return Array.from({ length: width }, (_, x) => (cellAt(x, y).bg === SELECTION ? "#" : ".")).join("");
    }

    it("a drag selects from the press to the pointer and paints exactly those cells", async () => {
        await setup("hello\r\nworld\r\nagain");

        drag([1, 0], [4, 0], [2, 2]);

        expect(surface.hasSelection).toBe(true);
        expect(surface.selectionText).toBe("ello\nworld\naga");
        expect([painted(0), painted(1), painted(2), painted(3)]).toEqual([
            ".#########",
            "##########",
            "###.......",
            "..........",
        ]);
        expect(updates).toBeGreaterThan(0);
    });

    it("a drag left or up selects the same cells backwards", async () => {
        await setup("hello\r\nworld");

        drag([3, 1], [0, 0]);

        expect(surface.selectionText).toBe("hello\nworl");
    });

    it("a plain click clears the selection and selects nothing; a press and release in one cell is no selection", async () => {
        await setup("hello");
        drag([0, 0], [3, 0]);

        drag([2, 0]);

        expect(surface.hasSelection).toBe(false);
        expect(surface.selectionText).toBeUndefined();
        expect(painted(0)).toBe("..........");
    });

    it("a drag back to its start keeps a one-cell selection", async () => {
        await setup("hello");

        drag([1, 0], [3, 0], [1, 0]);

        expect(surface.selectionText).toBe("e");
    });

    it("unfocused, the selection is painted with the inactive color composited over the cell's background", async () => {
        await setup("hi");
        drag([0, 0], [1, 0]);

        surface.setFocused(false);

        // #264F78 at 50% over #101010.
        expect(cellAt(0, 0).bg).toBe(0x1b3044);
    });

    it("keeps the text color, or uses terminal.selectionForeground when the theme sets one", async () => {
        await setup("\x1b[31mred");
        drag([0, 0], [2, 0]);
        const red = cellAt(0, 0).fg;
        expect(red).not.toBe(DEFAULT_COLOR);

        host.colors["terminal.selectionForeground"] = 0xffffff;

        expect(cellAt(0, 0).fg).toBe(0xffffff);
        expect(cellAt(5, 0).fg).toBe(DEFAULT_COLOR);
    });

    it("a selection over a cell with its own background composites over that background", async () => {
        await setup("\x1b[48;2;255;0;0mX");
        drag([0, 0], [1, 0]);
        surface.setFocused(false);

        // #264F78 at 50% over #FF0000.
        expect(cellAt(0, 0).bg).toBe(0x92283c);
    });

    it("a wide character is painted through its head cell", async () => {
        await setup("a中b");

        drag([2, 0], [3, 0]);

        expect(surface.selectionText).toBe("中b");
        expect(cellAt(1, 0).bg).toBe(SELECTION);
    });

    it("without a host the cells are read as is", async () => {
        session = await emulatorWith("hello", 10, 4);
        surface = new TerminalSelectionSurface(session);
        drag([0, 0], [3, 0]);

        expect(cellAt(0, 0).bg).toBe(DEFAULT_COLOR);
        expect(surface.selectionText).toBe("hell");
    });

    it("typing into the shell clears the selection and still reaches the shell", async () => {
        await setup("hello");
        const written = vi.spyOn(session, "write");
        drag([0, 0], [3, 0]);

        surface.write("x");

        expect(surface.hasSelection).toBe(false);
        expect(written).toHaveBeenCalledWith("x");
    });

    it("new output keeps the selection on its text", async () => {
        await setup("one\r\ntwo\r\nthree\r\n");
        drag([0, 1], [2, 1]);

        await feed(session, "four\r\nfive\r\nsix\r\n");

        expect(surface.selectionText).toBe("two");
    });

    it("scrolling keeps the selection on its buffer rows, not on the screen", async () => {
        await setup(Array.from({ length: 10 }, (_, i) => `row${String(i)}`).join("\r\n"));
        drag([0, 1], [3, 1]);
        expect(surface.selectionText).toBe("row7");

        surface.scrollLines(-2);

        expect(painted(1)).toBe("..........");
        expect(painted(3)).toBe("####......");
        expect(surface.selectionText).toBe("row7");
    });

    it("rows the scrollback trims off the top take the selection along; trimmed away it starts at the top", async () => {
        // The buffer is full: 1000 rows of scrollback and 4 on screen.
        await setup(Array.from({ length: 1010 }, (_, i) => String(i)).join("\r\n"));
        const top = session.buffer!.viewportY;
        drag([0, 3], [3, 3]);
        expect(surface.selectionText).toBe("1009");

        await feed(session, "\r\nmore\r\nlines");

        expect(session.buffer!.viewportY).toBe(top);
        expect(surface.selectionText).toBe("1009");
        expect(painted(1)).toBe("####......");

        surface.selectAll();
        await feed(session, "\r\nx");
        const first = session.buffer!.getLine(0)!.translateToString(true);
        expect(surface.selectionText?.split("\n")[0]).toBe(first);
    });

    it("the selection goes once the scrollback trims all of its text, before the cursor row", async () => {
        await setup(Array.from({ length: 1010 }, (_, i) => String(i)).join("\r\n"));
        surface.scrollLines(-1000);
        drag([0, 0], [3, 1]);
        expect(surface.selectionText).toBe("6\n7");

        await feed(session, "\r\nmore\r\nlines");

        expect(surface.hasSelection).toBe(false);
        expect(updates).toBeGreaterThan(0);
    });

    it("the selection goes once the scrollback trims the row it was made on", async () => {
        await setup(Array.from({ length: 1003 }, (_, i) => String(i)).join("\r\n"));
        drag([0, 1], [3, 1]);

        await feed(session, "\r\n".repeat(1010));

        expect(surface.hasSelection).toBe(false);
    });

    it("switching to the alternate buffer clears the selection", async () => {
        await setup("hello");
        drag([0, 0], [3, 0]);

        await feed(session, "\x1b[?1049h");

        expect(surface.hasSelection).toBe(false);
    });

    it("a resize clears the selection; the same size again doesn't", async () => {
        await setup("hello");
        const resized = vi.spyOn(session, "resize");
        surface.resize(10, 4);
        drag([0, 0], [3, 0]);

        surface.resize(10, 4);
        expect(surface.hasSelection).toBe(true);

        surface.resize(8, 4);
        expect(surface.hasSelection).toBe(false);
        expect(resized).toHaveBeenLastCalledWith(8, 4);
    });

    it("clearing without a selection changes nothing", async () => {
        await setup("hello");

        surface.clearSelection();

        expect(updates).toBe(0);
    });

    it("select all selects the whole buffer, scrollback included", async () => {
        await setup(Array.from({ length: 6 }, (_, i) => `r${String(i)}`).join("\r\n"));

        surface.selectAll();

        expect(surface.selectionText).toBe("r0\nr1\nr2\nr3\nr4\nr5");
        expect(painted(3)).toBe("##########");
    });

    it("events reach the session behind: links still see the Ctrl+click", async () => {
        await setup("hello");
        const forwarded = vi.spyOn(session, "sendMouse");

        surface.sendMouse(mouse(1, 0, "down", { ctrl: true }));
        surface.sendMouse(mouse(1, 0, "up", { ctrl: true }));
        surface.sendMouse(mouse(1, 0, "down", { button: "right" }));

        expect(forwarded).toHaveBeenCalledTimes(3);
        expect(surface.hasSelection).toBe(false);
    });

    it("a Ctrl+drag selects", async () => {
        await setup("hello");

        surface.sendMouse(mouse(0, 0, "down", { ctrl: true }));
        surface.sendMouse(mouse(2, 0, "move", { ctrl: true, button: "none" }));
        surface.sendMouse(mouse(2, 0, "up", { ctrl: true }));

        expect(surface.selectionText).toBe("hel");
    });

    describe("a program tracking the mouse", () => {
        it("gets the mouse: a drag selects nothing", async () => {
            await setup("hello\x1b[?1002h");
            const forwarded = vi.spyOn(session, "sendMouse");

            drag([0, 0], [3, 0]);

            expect(surface.hasSelection).toBe(false);
            expect(forwarded).toHaveBeenCalledTimes(3);
        });

        it("a Shift+drag selects, and none of its events reach the program", async () => {
            await setup("hello\x1b[?1002h");
            const forwarded = vi.spyOn(session, "sendMouse");

            surface.sendMouse(mouse(0, 0, "down", { shift: true }));
            surface.sendMouse(mouse(3, 0, "move", { shift: true, button: "none" }));
            surface.sendMouse(mouse(3, 0, "up"));
            expect(surface.selectionText).toBe("hell");
            expect(forwarded).not.toHaveBeenCalled();

            surface.sendMouse(mouse(3, 0, "down"));
            expect(forwarded).toHaveBeenCalledTimes(1);
        });
    });

    describe("a drag past an edge", () => {
        const OUTPUT = Array.from({ length: 12 }, (_, i) => `row${String(i)}`).join("\r\n");

        it("past the top scrolls the scrollback up and selects to the start of the top row", async () => {
            await setup(OUTPUT);
            vi.useFakeTimers();
            const bottom = session.buffer!.viewportY;

            surface.sendMouse(mouse(2, 1, "down"));
            surface.sendMouse(mouse(4, -2, "move", { button: "none" }));
            expect(surface.selectionText).toBe("row8\nrow");

            vi.advanceTimersByTime(50);
            expect(session.buffer!.viewportY).toBe(bottom - 2);
            expect(surface.selectionText).toBe("row6\nrow7\nrow8\nrow");

            vi.advanceTimersByTime(50);
            surface.sendMouse(mouse(4, -2, "up"));
            vi.advanceTimersByTime(500);
            expect(session.buffer!.viewportY).toBe(bottom - 4);
            expect(surface.selectionText).toBe("row4\nrow5\nrow6\nrow7\nrow8\nrow");
        });

        it("past the bottom scrolls down and selects to the end of the bottom row; back inside it stops", async () => {
            await setup(OUTPUT);
            vi.useFakeTimers();
            const bottom = session.buffer!.viewportY;
            surface.scrollLines(-5);

            surface.sendMouse(mouse(1, 0, "down"));
            surface.sendMouse(mouse(1, 4, "move", { button: "none" }));
            vi.advanceTimersByTime(100);
            expect(session.buffer!.viewportY).toBe(bottom - 3);
            expect(surface.selectionText).toBe("ow3\nrow4\nrow5\nrow6\nrow7\nrow8");

            surface.sendMouse(mouse(1, 2, "move", { button: "none" }));
            vi.advanceTimersByTime(500);
            expect(session.buffer!.viewportY).toBe(bottom - 3);
            surface.sendMouse(mouse(1, 2, "up"));
            expect(surface.selectionText).toBe("ow3\nrow4\nrow5\nrow6\nro");
        });

        it("the wheel during a drag moves the selection's end with the text under the pointer", async () => {
            await setup(OUTPUT);

            surface.sendMouse(mouse(0, 3, "down"));
            surface.sendMouse(mouse(2, 2, "move", { button: "none" }));
            surface.scrollLines(-1);
            surface.sendMouse(mouse(2, 2, "up"));

            expect(surface.selectionText).toBe("w9\nrow10\nr");
        });
    });

    it("passes the session's state through", async () => {
        await setup("ab");

        expect(surface.isExited).toBe(false);
        expect(surface.mouseEventsActive).toBe(false);
        expect(surface.applicationCursorKeys).toBe(false);
        expect(surface.kittyKeyboardFlags).toBe(0);
        expect(surface.scrollOffset).toBe(0);
        expect(surface.getCursor()).toEqual(session.getCursor());
        expect(surface.buffer?.viewportY).toBe(session.buffer?.viewportY);
        const exits: number[] = [];
        surface.onExit((code) => exits.push(code));
        session.exit(3);
        await vi.waitFor(() => {
            expect(exits).toEqual([3]);
        });
    });
});
