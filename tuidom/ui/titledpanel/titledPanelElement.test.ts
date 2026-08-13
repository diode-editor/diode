import { describe, expect, it } from "vitest";

import { renderElement } from "../../testing/renderElement.ts";
import type { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";
import { packRgb } from "../../common/colorUtils.ts";
import { Offset, Point, Size } from "../../common/geometryPromitives.ts";
import { STYLE_TOKEN_DEFAULTS } from "../../dom/styles/styleTokens.ts";
import { BoxElement } from "../layout/boxElement.ts";

import { TitledPanelElement } from "./titledPanelElement.ts";

function renderPanel(
    panel: TitledPanelElement,
    width: number,
    height: number,
): { backend: MockTerminalBackend; text: (x: number, y: number, len: number) => string } {
    const backend = renderElement(panel, width, height, { resolveStyles: true });
    return {
        backend,
        text: (x: number, y: number, len: number) => backend.getTextAt(new Point(x, y), len),
    };
}

describe("TitledPanelElement", () => {
    describe("title accessors", () => {
        it("exposes the title via getTitle()", () => {
            const panel = new TitledPanelElement("Explorer", new BoxElement());
            expect(panel.getTitle()).toBe("Explorer");
        });

        it("updates the title via setTitle() and renders the new value", () => {
            const panel = new TitledPanelElement("Old", new BoxElement());
            panel.setTitle("New");
            expect(panel.getTitle()).toBe("New");

            // Default titlePaddingLeft = 1, so the title starts at column 1.
            const { text } = renderPanel(panel, 10, 3);
            expect(text(1, 0, 3)).toBe("New");
        });
    });

    describe("rendering", () => {
        it("draws the title on row 0 with the configured left padding", () => {
            const panel = new TitledPanelElement("Hi", new BoxElement(), { titlePaddingLeft: 2 });
            const { text } = renderPanel(panel, 10, 3);

            // Two leading padding spaces, then the title.
            expect(text(0, 0, 4)).toBe("  Hi");
        });

        it("lays out and renders the child one row below the title", () => {
            const child = new BoxElement();
            const panel = new TitledPanelElement("Files", child);

            const { text } = renderPanel(panel, 6, 4);

            // Child occupies rows 1..3 (full width, height = container - 1 = 3).
            expect(child.localPosition).toEqual(new Offset(0, 1));
            expect(child.globalPosition).toEqual(new Point(0, 1));
            expect(child.layoutSize).toEqual(new Size(6, 3));

            // BoxElement draws a border box starting on the child's first row.
            expect(text(0, 1, 6)).toBe("+----+");
            expect(text(0, 3, 6)).toBe("+----+");
        });

        it("цвет заголовка переопределяется токеном titledPanel.titleForeground", () => {
            const titleFg = packRgb(10, 200, 30);
            const panel = new TitledPanelElement("Hi", new BoxElement());
            panel.setStyleVars({ "titledPanel.titleForeground": titleFg });

            const { backend } = renderPanel(panel, 10, 3);

            // Default titlePaddingLeft = 1, so 'H' is at column 1.
            expect(backend.getFgAt(new Point(1, 0))).toBe(titleFg);
        });

        it("без переопределения заголовок красится дефолтом токена", () => {
            const panel = new TitledPanelElement("Hi", new BoxElement());

            const { backend } = renderPanel(panel, 10, 3);

            expect(backend.getFgAt(new Point(1, 0))).toBe(STYLE_TOKEN_DEFAULTS["titledPanel.titleForeground"]);
        });
    });
});
