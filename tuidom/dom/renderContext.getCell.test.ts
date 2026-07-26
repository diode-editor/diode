import { describe, expect, it } from "vitest";

import { packRgb } from "../common/colorUtils.ts";
import { Offset, Point, Rect, Size } from "../common/geometryPromitives.ts";
import { TerminalScreen } from "../rendering/terminalScreen.ts";

import { RenderContext } from "./tuiElement.ts";

describe("RenderContext.getCell", () => {
    it("reads back a cell written through setCell", () => {
        const FG = packRgb(10, 20, 30);
        const BG = packRgb(40, 50, 60);
        const screen = new TerminalScreen(new Size(10, 4));
        const ctx = new RenderContext(screen);
        ctx.setCell(3, 1, { char: "x", fg: FG, bg: BG });

        const cell = ctx.getCell(3, 1);
        expect(cell).not.toBeNull();
        expect(cell?.char).toBe("x");
        expect(cell?.fg).toBe(FG);
        expect(cell?.bg).toBe(BG);
    });

    it("translates local coordinates by the context offset", () => {
        const screen = new TerminalScreen(new Size(10, 4));
        const base = new RenderContext(screen);
        base.setCell(5, 2, { char: "y" });

        const shifted = base.withOffset(new Offset(5, 2));
        expect(shifted.getCell(0, 0)?.char).toBe("y");
    });

    it("returns null outside the clip rect", () => {
        const screen = new TerminalScreen(new Size(10, 4));
        const ctx = new RenderContext(screen).withClip(new Rect(new Point(0, 0), new Size(2, 2)));

        expect(ctx.getCell(1, 1)).not.toBeNull();
        expect(ctx.getCell(2, 1)).toBeNull();
        expect(ctx.getCell(1, 2)).toBeNull();
    });

    it("returns null outside the screen even with an infinite clip", () => {
        const screen = new TerminalScreen(new Size(10, 4));
        const ctx = new RenderContext(screen);

        expect(ctx.getCell(-1, 0)).toBeNull();
        expect(ctx.getCell(0, -1)).toBeNull();
        expect(ctx.getCell(10, 0)).toBeNull();
        expect(ctx.getCell(0, 4)).toBeNull();
    });

    it("TerminalScreen.getCell delegates to the grid", () => {
        const screen = new TerminalScreen(new Size(4, 2));
        screen.setCell(new Point(1, 1), { char: "z" });
        expect(screen.getCell(new Point(1, 1)).char).toBe("z");
    });
});
