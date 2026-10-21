import { packRgb } from "@tuidom/core/common/colorUtils";
import { BoxConstraints, Offset, Point, Rect, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { ROOT_STYLE_CONTEXT } from "@tuidom/core/dom/styles/tuiStyle";
import { RenderContext, TUIElement } from "@tuidom/core/dom/tuiElement";
import { TerminalScreen } from "@tuidom/core/rendering/terminalScreen";
import { describe, expect, it } from "vitest";

import { PanelContainerElement } from "./panelContainerElement.ts";

// Screen LARGER than the panel: a write past its edge shows up as a changed cell instead of being clipped.
const SCREEN = new Size(30, 8);
const ORIGIN = new Offset(2, 1);

const BG = packRgb(7, 8, 9);
const TITLE_FG = packRgb(44, 55, 66);
const BORDER = packRgb(70, 80, 90);
const CLOSE_FG = packRgb(101, 102, 103);
const HOVER_BG = packRgb(10, 20, 30);

const VARS = {
    "panel.background": BG,
    "panel.border": BORDER,
    "panelTitle.inactiveForeground": TITLE_FG,
    descriptionForeground: CLOSE_FG,
    "toolbar.hoverBackground": HOVER_BG,
};

class MarkerContent extends TUIElement {
    public constructor(private readonly marker: string) {
        super();
    }

    public override render(context: RenderContext): void {
        context.setCell(0, 0, { char: this.marker });
    }
}

function themed(): PanelContainerElement {
    const panel = new PanelContainerElement();
    panel.setStyleVars(VARS);
    return panel;
}

function paint(panel: PanelContainerElement, size: Size): TerminalScreen {
    const screen = new TerminalScreen(SCREEN);
    panel.localPosition = ORIGIN;
    panel.layout(BoxConstraints.tight(size));
    panel.performStyleResolution(ROOT_STYLE_CONTEXT);
    panel.render(new RenderContext(screen, ORIGIN, new Rect(new Point(0, 0), SCREEN)));
    return screen;
}

function at(screen: TerminalScreen, x: number, y: number) {
    return screen.getCell(new Point(ORIGIN.dx + x, ORIGIN.dy + y));
}

function row(screen: TerminalScreen, y: number, from: number, length: number): string {
    return Array.from({ length }, (_, i) => at(screen, from + i, y).char).join("");
}

// Fixture: "PROBLEMS" (8) → segment [1, 11), glyphs 2..9; "OUT" (3) → [11, 16),
// glyphs 12..14. Tab row tail is 16; at width 20 the `×` button is columns 17..19.
function twoTabs(): PanelContainerElement {
    const panel = themed();
    panel.addView({ id: "a", title: "PROBLEMS", content: null });
    panel.addView({ id: "b", title: "OUT", content: null });
    return panel;
}

describe("PanelContainerElement: rendering", () => {
    it("fills exactly its own rectangle with the background, not a column more", () => {
        const screen = paint(twoTabs(), new Size(20, 5));

        expect(at(screen, 0, 4).bg).toBe(BG);
        expect(at(screen, 19, 4).bg).toBe(BG);
        expect(at(screen, 19, 0).bg).toBe(BG);
        // A space on the panel background, not "nothing".
        expect(at(screen, 5, 3).char).toBe(" ");
        expect(at(screen, 5, 3).bg).toBe(BG);
        expect(at(screen, 20, 0).bg).not.toBe(BG);
        expect(at(screen, 0, 5).bg).not.toBe(BG);
    });

    it("draws the top border strip across the full width and only on row zero", () => {
        const screen = paint(twoTabs(), new Size(20, 5));

        expect(row(screen, 0, 0, 20)).toBe("─".repeat(20));
        expect(at(screen, 0, 0).fg).toBe(BORDER);
        expect(at(screen, 19, 0).fg).toBe(BORDER);
        expect(at(screen, 20, 0).char).not.toBe("─");
        expect(at(screen, 0, 1).char).not.toBe("─");
    });

    it("pads tab names with exactly one space on each side", () => {
        const screen = paint(twoTabs(), new Size(20, 5));

        expect(row(screen, 1, 0, 16)).toBe("  PROBLEMS  OUT ");
        expect(at(screen, 1, 1).char).toBe(" ");
        expect(at(screen, 10, 1).char).toBe(" ");
        expect(at(screen, 2, 1).fg).toBe(TITLE_FG);
    });

    it("does not paint the tab row past the last tab", () => {
        const screen = paint(twoTabs(), new Size(20, 5));

        // Column 16 is right after the tab row tail: fill color, NOT the label color.
        expect(at(screen, 16, 1).fg).not.toBe(TITLE_FG);
        expect(at(screen, 16, 1).fg).toBe(at(screen, 5, 3).fg);
    });

    it("clips the tab row at the right panel edge without overflowing it", () => {
        const screen = paint(twoTabs(), new Size(8, 4));

        expect(row(screen, 1, 0, 8)).toBe("  PRO × ");
        expect(at(screen, 8, 1).fg).not.toBe(TITLE_FG);
        expect(at(screen, 8, 1).bg).not.toBe(BG);
    });

    it("underlines the active tab — only under the name glyphs", () => {
        const panel = twoTabs();
        const screen = paint(panel, new Size(20, 5));

        expect(at(screen, 2, 1).style).toBe(StyleFlags.Underline);
        expect(at(screen, 9, 1).style).toBe(StyleFlags.Underline);
        expect(at(screen, 1, 1).style).toBe(StyleFlags.None); // leading padding
        expect(at(screen, 10, 1).style).toBe(StyleFlags.None); // trailing padding
        expect(at(screen, 12, 1).style).toBe(StyleFlags.None); // glyph of the INACTIVE tab

        panel.setActiveView("b");
        const after = paint(panel, new Size(20, 5));
        expect(at(after, 2, 1).style).toBe(StyleFlags.None);
        expect(at(after, 12, 1).style).toBe(StyleFlags.Underline);
        expect(at(after, 11, 1).style).toBe(StyleFlags.None);
    });

    it("draws the placeholder below the tab name and clips it at the panel edge", () => {
        const panel = themed();
        panel.addView({ id: "a", title: "P", content: null, placeholder: "0123456789ABCDEF" });
        const screen = paint(panel, new Size(10, 5));

        // The tail does not spill past the panel.
        expect(row(screen, 2, 0, 10)).toBe("  01234567");
        expect(at(screen, 10, 2).char).not.toBe("8");
        expect(at(screen, 10, 2).bg).not.toBe(BG);
    });

    it("ends the placeholder at its last character instead of painting the rest of the row", () => {
        const panel = themed();
        panel.addView({ id: "a", title: "P", content: null, placeholder: "No problems." });
        const screen = paint(panel, new Size(20, 5));

        expect(row(screen, 2, 0, 14)).toBe("  No problems.");
        expect(at(screen, 14, 2).fg).not.toBe(TITLE_FG);
        expect(at(screen, 14, 2).fg).toBe(at(screen, 5, 3).fg);
    });

    it("the placeholder is not shown for a tab that has content", () => {
        // With content the welcome state must stay silent, even if the text is set.
        const panel = themed();
        panel.addView({ id: "a", title: "P", content: new MarkerContent("X"), placeholder: "hidden" });
        const screen = paint(panel, new Size(20, 5));

        expect(at(screen, 2, 2).char).toBe("X");
        expect(row(screen, 2, 0, 10)).toBe("  X       ");
    });

    it("does not draw the placeholder when there is no content row at all", () => {
        // No room for content; a write to a nonexistent row is visible only on a screen larger than the panel.
        const panel = themed();
        panel.addView({ id: "a", title: "P", content: null, placeholder: "hidden" });
        const screen = paint(panel, new Size(20, 2));

        expect(row(screen, 1, 0, 4)).toBe("  P ");
        expect(at(screen, 2, 2).char).not.toBe("h");
        expect(at(screen, 2, 2).bg).not.toBe(BG);
    });

    it("a tab with content and no placeholder renders and lays out", () => {
        const panel = themed();
        const content = new MarkerContent("X");
        panel.addView({ id: "a", title: "P", content });
        const screen = paint(panel, new Size(20, 5));

        expect(at(screen, 2, 2).char).toBe("X");
        expect(content.layoutSize).toEqual(new Size(18, 3));
    });

    it("a panel with no tabs at all lays out and renders", () => {
        // Reading the active tab must be optional, otherwise the frame crashes.
        const panel = themed();

        expect(() => paint(panel, new Size(20, 5))).not.toThrow();
        const screen = paint(panel, new Size(20, 5));
        expect(row(screen, 1, 0, 20)).toBe(`${" ".repeat(17)} × `);
    });
});
