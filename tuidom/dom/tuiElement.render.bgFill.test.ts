import { describe, expect, it } from "vitest";

import { DEFAULT_COLOR, packRgb } from "../common/colorUtils.ts";
import { BoxConstraints, Offset, Point, Rect, Size } from "../common/geometryPromitives.ts";
import { TerminalScreen } from "../rendering/terminalScreen.ts";

import { INHERITED_FG, ROOT_STYLE_CONTEXT } from "./styles/tuiStyle.ts";
import { RenderContext, TUIElement } from "./tuiElement.ts";

class ContainerElement extends TUIElement {
    public addChild(child: TUIElement): void {
        this.appendChild(child);
    }
}

function renderToScreen(root: TUIElement, width = 20, height = 6): TerminalScreen {
    const size = new Size(width, height);
    const screen = new TerminalScreen(size);
    root.layout(BoxConstraints.tight(size));
    root.performStyleResolution(ROOT_STYLE_CONTEXT);
    root.render(new RenderContext(screen, new Offset(0, 0), new Rect(new Point(0, 0), size)));
    return screen;
}

describe("TUIElement.render — заливка собственного фона", () => {
    it("собственный bg заливает весь прямоугольник элемента", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        const bg = packRgb(30, 30, 30);
        root.style = { bg };

        const screen = renderToScreen(root);
        expect(screen.getCell(new Point(0, 0)).bg).toBe(bg);
        expect(screen.getCell(new Point(19, 5)).bg).toBe(bg);
        expect(root.hasOwnBackground).toBe(true);
    });

    it("без собственного bg элемент прозрачен (канва не тронута)", () => {
        const root = new ContainerElement();
        root.setAsRoot();

        const screen = renderToScreen(root);
        expect(screen.getCell(new Point(0, 0)).bg).toBe(DEFAULT_COLOR);
        expect(root.hasOwnBackground).toBe(false);
        // Унаследованный (не собственный) bg тоже не заливает
        const parent = new ContainerElement();
        parent.setAsRoot();
        parent.style = { bg: packRgb(9, 9, 9) };
        const child = new TUIElement();
        parent.addChild(child);
        expect(child.hasOwnBackground).toBe(false);
    });

    it("bg из when-варианта заливается при активном состоянии", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        const hoverBg = packRgb(60, 60, 60);
        root.style = { when: [{ states: ["hover"], bg: hoverBg }] };

        let screen = renderToScreen(root);
        expect(root.hasOwnBackground).toBe(false);
        expect(screen.getCell(new Point(5, 3)).bg).toBe(DEFAULT_COLOR);

        root.setStyleState("hover", true);
        screen = renderToScreen(root);
        expect(root.hasOwnBackground).toBe(true);
        expect(screen.getCell(new Point(5, 3)).bg).toBe(hoverBg);
    });

    it("bg: INHERITED_FG — легальная инверсия (заливка цветом текста родителя)", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        const fg = packRgb(200, 200, 200);
        root.style = { fg };
        const child = new ContainerElement();
        child.style = { bg: INHERITED_FG };
        root.addChild(child);
        child.localPosition = new Offset(2, 1);

        const screen = new TerminalScreen(new Size(20, 6));
        root.layout(BoxConstraints.tight(new Size(20, 6)));
        child.layout(BoxConstraints.tight(new Size(5, 2)));
        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        root.render(new RenderContext(screen, new Offset(0, 0), new Rect(new Point(0, 0), new Size(20, 6))));

        expect(child.hasOwnBackground).toBe(true);
        expect(screen.getCell(new Point(2, 1)).bg).toBe(fg);
    });

    it("заливка не выходит за клип ребёнка", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        const child = new ContainerElement();
        const bg = packRgb(80, 0, 0);
        child.style = { bg };
        root.addChild(child);
        child.localPosition = new Offset(3, 2);

        const screen = new TerminalScreen(new Size(20, 6));
        root.layout(BoxConstraints.tight(new Size(20, 6)));
        child.layout(BoxConstraints.tight(new Size(4, 2)));
        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        root.render(new RenderContext(screen, new Offset(0, 0), new Rect(new Point(0, 0), new Size(20, 6))));

        expect(screen.getCell(new Point(3, 2)).bg).toBe(bg);
        expect(screen.getCell(new Point(6, 3)).bg).toBe(bg);
        expect(screen.getCell(new Point(7, 3)).bg).toBe(DEFAULT_COLOR);
        expect(screen.getCell(new Point(2, 2)).bg).toBe(DEFAULT_COLOR);
    });

    it("appliedStyle отдаёт сырые цвета (токен до резолва)", () => {
        const root = new ContainerElement();
        root.setAsRoot();
        root.style = { bg: "list.activeSelectionBackground" };
        root.performStyleResolution(ROOT_STYLE_CONTEXT);
        expect(root.appliedStyle).toEqual({ fg: undefined, bg: "list.activeSelectionBackground" });
    });
});
