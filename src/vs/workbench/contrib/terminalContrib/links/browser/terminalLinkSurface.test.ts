import { DEFAULT_COLOR } from "@tuidom/core/common/colorUtils";
import type { TerminalCell, TerminalMouseEventData } from "@tuidom/core/common/iTerminalSurface";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeTerminalSurface } from "../../../../../../TestUtils/FakeTerminalSurface.ts";
import { emulatorWith, fakeLinkProvider, feed } from "../../../../../../TestUtils/terminalLinks.ts";
import type { ExtensionPtySession } from "../../../terminal/node/extensionPtySession.ts";
import type { ITerminalLink } from "../common/terminalLinkProvider.ts";

import { TerminalLinkSurface } from "./terminalLinkSurface.ts";

const DISK = { "/ws/src/a.ts": "file", "/ws/b.ts": "file" } as const;

function mouse(
    col: number,
    row: number,
    { action = "move", button = "none", ctrl = true }: Partial<TerminalMouseEventData> = {},
): TerminalMouseEventData {
    return { col, row, action, button, ctrl, alt: false, shift: false };
}

describe("TerminalLinkSurface", () => {
    let session: ExtensionPtySession;
    let surface: TerminalLinkSurface;
    let opened: ITerminalLink[];
    let updates: number;

    async function setup(output: string, cols = 40): Promise<void> {
        session = await emulatorWith(output, cols, 5);
        opened = [];
        surface = new TerminalLinkSurface(session, fakeLinkProvider({ disk: DISK }), (link) => {
            opened.push(link);
            return Promise.resolve();
        });
        updates = 0;
        surface.onUpdate(() => {
            updates++;
        });
    }

    afterEach(() => {
        session.dispose();
    });

    function styleAt(x: number, y: number): number | undefined {
        const cell: TerminalCell = { char: " ", fg: DEFAULT_COLOR, bg: DEFAULT_COLOR, style: 0, width: 1 };
        return surface.readCell(x, y, cell) ? cell.style : undefined;
    }

    function underlined(y: number, width = 40): string {
        return Array.from({ length: width }, (_, x) => ((styleAt(x, y) ?? 0) & StyleFlags.Underline ? "_" : " "))
            .join("")
            .trimEnd();
    }

    const hovered = (): string | undefined => surface.hoveredLink?.text;

    it("Ctrl+hover underlines exactly the link's cells; without Ctrl nothing", async () => {
        await setup("see src/a.ts:3:2 here");
        surface.sendMouse(mouse(6, 0, { ctrl: false }));
        await Promise.resolve();
        expect(underlined(0)).toBe("");

        surface.sendMouse(mouse(6, 0));
        await vi.waitFor(() => {
            expect(hovered()).toBe("src/a.ts:3:2");
        });
        expect(underlined(0)).toBe("    ____________");
        expect(updates).toBeGreaterThan(0);
    });

    it("moving off the link or releasing Ctrl removes the underline", async () => {
        await setup("see src/a.ts:3:2 here");
        surface.sendMouse(mouse(6, 0));
        await vi.waitFor(() => {
            expect(hovered()).toBeDefined();
        });
        surface.sendMouse(mouse(18, 0));
        await vi.waitFor(() => {
            expect(hovered()).toBeUndefined();
        });

        surface.sendMouse(mouse(6, 0));
        await vi.waitFor(() => {
            expect(hovered()).toBeDefined();
        });
        surface.sendMouse(mouse(7, 0, { ctrl: false }));
        expect(hovered()).toBeUndefined();
        expect(underlined(0)).toBe("");
    });

    it("Ctrl press and release under a resting pointer toggle the underline; leaving the widget clears it", async () => {
        await setup("src/a.ts");
        surface.sendMouse(mouse(2, 0, { ctrl: false }));
        surface.setModifier(true);
        await vi.waitFor(() => {
            expect(hovered()).toBe("src/a.ts");
        });
        surface.setModifier(false);
        expect(hovered()).toBeUndefined();

        surface.setModifier(true);
        await vi.waitFor(() => {
            expect(hovered()).toBe("src/a.ts");
        });
        surface.pointerLeft();
        expect(hovered()).toBeUndefined();
        surface.setModifier(true);
        await Promise.resolve();
        expect(hovered()).toBeUndefined();
    });

    it("a stale lookup doesn't override a newer pointer position", async () => {
        await setup("src/a.ts ./b.ts");
        surface.sendMouse(mouse(1, 0));
        surface.sendMouse(mouse(11, 0));
        await vi.waitFor(() => {
            expect(hovered()).toBe("./b.ts");
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(hovered()).toBe("./b.ts");
    });

    it("a late lookup doesn't override a newer one, even with the hover cleared in between", async () => {
        await setup("src/a.ts ./b.ts");
        const links = await fakeLinkProvider({ disk: DISK }).provideLinks(session.buffer!, 0);
        const pending: ((links: ITerminalLink[]) => void)[] = [];
        const slow = new TerminalLinkSurface(
            session,
            { provideLinks: () => new Promise((resolve) => pending.push(resolve)) },
            () => Promise.resolve(),
        );
        slow.sendMouse(mouse(1, 0));
        slow.setModifier(false);
        slow.sendMouse(mouse(11, 0));
        pending[1](links);
        await vi.waitFor(() => {
            expect(slow.hoveredLink?.text).toBe("./b.ts");
        });
        pending[0](links);
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(slow.hoveredLink?.text).toBe("./b.ts");
    });

    it("moving within the hovered link doesn't redraw", async () => {
        await setup("see src/a.ts:3:2 here");
        surface.sendMouse(mouse(5, 0));
        await vi.waitFor(() => {
            expect(hovered()).toBe("src/a.ts:3:2");
        });
        const before = updates;
        surface.sendMouse(mouse(9, 0));
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(updates).toBe(before);
        expect(hovered()).toBe("src/a.ts:3:2");
    });

    it("a revealed link is underlined apart from the hover; revealing it again doesn't redraw; undefined clears it", async () => {
        await setup("see src/a.ts:3:2 here\r\n./b.ts");
        const [link] = await fakeLinkProvider({ disk: DISK }).provideLinks(session.buffer!, 0);

        surface.setRevealedLink(link);
        expect(updates).toBe(1);
        expect(underlined(0)).toBe("    ____________");
        surface.setRevealedLink({ ...link });
        expect(updates).toBe(1);

        surface.sendMouse(mouse(1, 1));
        await vi.waitFor(() => {
            expect(hovered()).toBe("./b.ts");
        });
        expect([underlined(0), underlined(1)]).toEqual(["    ____________", "______"]);

        surface.setRevealedLink(undefined);
        expect([underlined(0), underlined(1)]).toEqual(["", "______"]);
    });

    it("output re-checks the hover: a grown link is re-underlined, output elsewhere keeps it, no Ctrl — no hover", async () => {
        await setup("src/a.ts");
        surface.sendMouse(mouse(2, 0, { ctrl: false }));
        await feed(session, "\x1b[3;1Hzz\x1b[1;9H");
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(hovered()).toBeUndefined();

        surface.sendMouse(mouse(2, 0));
        await vi.waitFor(() => {
            expect(hovered()).toBe("src/a.ts");
        });
        await feed(session, ":3");
        await vi.waitFor(() => {
            expect(hovered()).toBe("src/a.ts:3");
        });
        expect(underlined(0)).toBe("__________");
        await feed(session, "\x1b[4;1Hyy");
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(hovered()).toBe("src/a.ts:3");
    });

    it("with the view scrolled part-way the hover and the click land on the link's viewport row", async () => {
        await setup(`f0\r\nf1\r\nf2\r\nsrc/a.ts:9\r\n${"filler\r\n".repeat(8)}`);
        surface.scrollLines(-6);
        const viewportY = session.buffer!.viewportY;
        expect(viewportY).toBeGreaterThan(0);
        const row = 3 - viewportY;
        surface.sendMouse(mouse(2, row));
        await vi.waitFor(() => {
            expect(hovered()).toBe("src/a.ts:9");
        });
        expect(underlined(row)).toBe("__________");
        expect(underlined(3)).toBe("");
        click(2, row);
        await vi.waitFor(() => {
            expect(opened.map((link) => link.text)).toEqual(["src/a.ts:9"]);
        });
    });

    it("text the program already underlined stays underlined", async () => {
        await setup("\x1b[4mx\x1b[0m src/a.ts");
        surface.sendMouse(mouse(3, 0));
        await vi.waitFor(() => {
            expect(hovered()).toBeDefined();
        });
        expect(underlined(0)).toBe("_ ________");
    });

    function click(col: number, row: number, options: Partial<TerminalMouseEventData> = {}): void {
        surface.sendMouse(mouse(col, row, { action: "down", button: "left", ...options }));
        surface.sendMouse(mouse(col, row, { action: "up", button: "left", ...options }));
    }

    it("Ctrl+click opens the link on release and doesn't reach the emulator; a plain click does", async () => {
        await setup("src/a.ts:3:2");
        const forwarded = vi.spyOn(session, "sendMouse");
        surface.sendMouse(mouse(3, 0, { action: "down", button: "left" }));
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(opened).toEqual([]);
        // Moves after the release don't supersede the activation lookup.
        surface.sendMouse(mouse(5, 0, { action: "up", button: "left" }));
        surface.sendMouse(mouse(20, 0));
        await vi.waitFor(() => {
            expect(opened.map((link) => link.text)).toEqual(["src/a.ts:3:2"]);
        });
        expect(forwarded).toHaveBeenCalledTimes(1);

        forwarded.mockClear();
        click(3, 0, { ctrl: false });
        surface.sendMouse(mouse(3, 0, { action: "down", button: "right" }));
        click(20, 0);
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(forwarded).toHaveBeenCalledTimes(3);
        expect(opened).toHaveLength(1);
    });

    it("a drag within the link opens it on the left button's release only", async () => {
        await setup("src/a.ts:3:2");
        surface.sendMouse(mouse(3, 0, { action: "down", button: "left" }));
        surface.sendMouse(mouse(5, 0, { action: "move", button: "left" }));
        surface.sendMouse(mouse(5, 0, { action: "up", button: "right" }));
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(opened).toEqual([]);
        surface.sendMouse(mouse(6, 0, { action: "up", button: "left" }));
        await vi.waitFor(() => {
            expect(opened).toHaveLength(1);
        });
    });

    it("Ctrl+press on a link and release off it opens nothing", async () => {
        await setup("src/a.ts:3:2 ./b.ts");
        surface.sendMouse(mouse(3, 0, { action: "down", button: "left" }));
        surface.sendMouse(mouse(15, 0, { action: "up", button: "left" }));
        surface.sendMouse(mouse(3, 0, { action: "down", button: "left" }));
        surface.sendMouse(mouse(3, 1, { action: "up", button: "left" }));
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(opened).toEqual([]);
    });

    it("Ctrl+click on plain text, with a link elsewhere on the row, opens nothing", async () => {
        await setup("echo src/a.ts:3:2");
        surface.sendMouse(mouse(1, 0, { action: "down", button: "left" }));
        surface.sendMouse(mouse(1, 0, { action: "up", button: "left" }));
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(opened).toEqual([]);
    });

    it("an opener failure is reported, not thrown into the input path", async () => {
        await setup("src/a.ts");
        const failing = new TerminalLinkSurface(session, fakeLinkProvider({ disk: DISK }), () =>
            Promise.reject(new Error("boom")),
        );
        const errors = await import("../../../../../base/common/errors.ts");
        const reported = vi.spyOn(errors, "onUnexpectedError").mockImplementation(() => undefined);
        failing.sendMouse(mouse(1, 0, { action: "down", button: "left" }));
        failing.sendMouse(mouse(1, 0, { action: "up", button: "left" }));
        await vi.waitFor(() => {
            expect(reported).toHaveBeenCalled();
        });
        reported.mockRestore();
    });

    it("a program with mouse tracking owns the mouse: no underline, Ctrl+click goes to the program", async () => {
        await setup("src/a.ts\x1b[?1000h");
        expect(surface.mouseEventsActive).toBe(true);
        const forwarded = vi.spyOn(session, "sendMouse");
        surface.sendMouse(mouse(1, 0));
        surface.setModifier(true);
        surface.sendMouse(mouse(1, 0, { action: "down", button: "left" }));
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(hovered()).toBeUndefined();
        expect(opened).toEqual([]);
        expect(forwarded).toHaveBeenCalledTimes(2);
    });

    it("a program turning mouse tracking on takes the hover away, Ctrl doesn't bring it back", async () => {
        await setup("src/a.ts");
        surface.sendMouse(mouse(2, 0));
        await vi.waitFor(() => {
            expect(hovered()).toBe("src/a.ts");
        });
        await feed(session, "\x1b[?1000h");
        surface.sendMouse(mouse(3, 0));
        expect(hovered()).toBeUndefined();
        surface.setModifier(true);
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(hovered()).toBeUndefined();
    });

    it("before the emulator has a buffer: no hover, Ctrl+click opens nothing", async () => {
        await setup("");
        const bare = new TerminalLinkSurface(new FakeTerminalSurface(), fakeLinkProvider({ disk: DISK }), (link) => {
            opened.push(link);
            return Promise.resolve();
        });
        bare.sendMouse(mouse(1, 0));
        bare.sendMouse(mouse(1, 0, { action: "down", button: "left" }));
        bare.sendMouse(mouse(1, 0, { action: "up", button: "left" }));
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(bare.hoveredLink).toBeUndefined();
        expect(opened).toEqual([]);
    });

    it("a wrapped link is underlined on both rows", async () => {
        await setup("xx src/a.ts:3", 10);
        surface.sendMouse(mouse(1, 1));
        await vi.waitFor(() => {
            expect(hovered()).toBe("src/a.ts:3");
        });
        expect(underlined(0, 10)).toBe("   _______");
        expect(underlined(1, 10)).toBe("___");
    });

    it("links work in the scrolled-up history; new output re-checks the hover", async () => {
        await setup(`src/a.ts:9\r\n${"filler\r\n".repeat(10)}`);
        surface.scrollLines(-100);
        expect(surface.scrollOffset).toBeGreaterThan(0);
        surface.sendMouse(mouse(2, 0));
        await vi.waitFor(() => {
            expect(hovered()).toBe("src/a.ts:9");
        });
        expect(underlined(0)).toBe("__________");

        // Output returns the viewport to the bottom: the pointer is now over another row.
        await feed(session, "more\r\n");
        await vi.waitFor(() => {
            expect(hovered()).toBeUndefined();
        });
    });

    it("a lookup failure is reported and leaves the hover as it was", async () => {
        await setup("src/a.ts");
        const failing = new TerminalLinkSurface(
            session,
            { provideLinks: () => Promise.reject(new Error("disk")) },
            () => Promise.resolve(),
        );
        const errors = await import("../../../../../base/common/errors.ts");
        const reported = vi.spyOn(errors, "onUnexpectedError").mockImplementation(() => undefined);
        failing.sendMouse(mouse(1, 0));
        await vi.waitFor(() => {
            expect(reported).toHaveBeenCalled();
        });
        expect(failing.hoveredLink).toBeUndefined();
        reported.mockRestore();
    });

    it("delegates the rest of the surface to the session", async () => {
        await setup("ab");
        const write = vi.spyOn(session, "write");
        const resize = vi.spyOn(session, "resize");
        surface.write("x");
        surface.resize(30, 4);
        expect(write).toHaveBeenCalledWith("x");
        expect(resize).toHaveBeenCalledWith(30, 4);
        expect(surface.getCursor()).toEqual(session.getCursor());
        expect(surface.isExited).toBe(false);
        expect(styleAt(0, 0)).toBe(0);
        expect(styleAt(-1, 99)).toBeUndefined();
        const exits: number[] = [];
        surface.onExit((code) => exits.push(code));
        session.exit(3);
        // The exit waits until the output before it is parsed.
        await vi.waitFor(() => {
            expect(exits).toEqual([3]);
        });
        expect(surface.isExited).toBe(true);
    });

    it("application cursor keys follow the session", async () => {
        await setup("ab");
        expect(surface.applicationCursorKeys).toBe(false);
        await setup("ab\x1b[?1h");
        expect(surface.applicationCursorKeys).toBe(true);
    });

    it("kitty keyboard flags follow the session", async () => {
        await setup("ab");
        expect(surface.kittyKeyboardFlags).toBe(0);
        await setup("ab\x1b[>5u");
        expect(surface.kittyKeyboardFlags).toBe(5);
    });
});
