import { describe, expect, it, vi } from "vitest";

import { DEFAULT_COLOR, packRgb } from "../common/colorUtils.ts";
import { BoxConstraints, Offset, Point, Rect, Size } from "../common/geometryPromitives.ts";
import { TerminalScreen } from "../rendering/terminalScreen.ts";

import { ROOT_STYLE_CONTEXT } from "./styles/tuiStyle.ts";
import { RenderContext, TUIElement } from "./tuiElement.ts";

/** Контейнер с двумя детьми 5×2: A в (0,0), B в (10,0). */
class TwoPanesElement extends TUIElement {
    public readonly paneA = new TUIElement();
    public readonly paneB = new TUIElement();

    public constructor() {
        super();
        this.appendChild(this.paneA);
        this.appendChild(this.paneB);
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const pane = BoxConstraints.tight(new Size(5, 2));
        this.layoutChild(this.paneA, 0, 0, pane);
        this.layoutChild(this.paneB, 10, 0, pane);
        return size;
    }
}

const BG_A = packRgb(10, 20, 30);
const BG_B = packRgb(40, 50, 60);

function createTree(): { root: TwoPanesElement; screen: TerminalScreen } {
    const root = new TwoPanesElement();
    root.setAsRoot();
    root.paneA.style = { bg: BG_A };
    root.paneB.style = { bg: BG_B };
    const size = new Size(20, 6);
    const screen = new TerminalScreen(size);
    root.layout(BoxConstraints.tight(size));
    root.performStyleResolution(ROOT_STYLE_CONTEXT);
    return { root, screen };
}

describe("renderChildren — прунинг детей вне клипа", () => {
    it("ребёнок вне клипа не рендерится вовсе, внутри — рисуется", () => {
        const { root, screen } = createTree();
        const spyA = vi.spyOn(root.paneA, "render");
        const spyB = vi.spyOn(root.paneB, "render");

        // Клип накрывает только панель A.
        root.render(new RenderContext(screen, new Offset(0, 0), new Rect(new Point(0, 0), new Size(5, 2))));

        expect(spyA).toHaveBeenCalledTimes(1);
        expect(spyB).not.toHaveBeenCalled();
        expect(screen.getCell(new Point(0, 0)).bg).toBe(BG_A);
        // Область B канвой не тронута.
        expect(screen.getCell(new Point(10, 0)).bg).toBe(DEFAULT_COLOR);
    });

    it("частичное пересечение с клипом — ребёнок рендерится, запись клипуется", () => {
        const { root, screen } = createTree();
        const spyB = vi.spyOn(root.paneB, "render");

        // Клип задевает только первую колонку панели B (x=10).
        root.render(new RenderContext(screen, new Offset(0, 0), new Rect(new Point(3, 0), new Size(8, 2))));

        expect(spyB).toHaveBeenCalledTimes(1);
        expect(screen.getCell(new Point(10, 0)).bg).toBe(BG_B);
        expect(screen.getCell(new Point(11, 0)).bg).toBe(DEFAULT_COLOR);
    });

    it("полный клип — оба ребёнка рендерятся (поведение не изменилось)", () => {
        const { root, screen } = createTree();
        const spyA = vi.spyOn(root.paneA, "render");
        const spyB = vi.spyOn(root.paneB, "render");

        root.render(new RenderContext(screen, new Offset(0, 0), new Rect(new Point(0, 0), new Size(20, 6))));

        expect(spyA).toHaveBeenCalledTimes(1);
        expect(spyB).toHaveBeenCalledTimes(1);
        expect(screen.getCell(new Point(0, 0)).bg).toBe(BG_A);
        expect(screen.getCell(new Point(10, 0)).bg).toBe(BG_B);
    });
});
