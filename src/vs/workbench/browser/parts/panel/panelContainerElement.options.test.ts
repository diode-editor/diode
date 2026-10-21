import { packRgb } from "@tuidom/core/common/colorUtils";
import { BoxConstraints, Offset, Point, Rect, Size } from "@tuidom/core/common/geometryPromitives";
import { MouseEventDispatcher } from "@tuidom/core/dom/events/mouseEventDispatcher";
import { ROOT_STYLE_CONTEXT } from "@tuidom/core/dom/styles/tuiStyle";
import { RenderContext, TUIElement } from "@tuidom/core/dom/tuiElement";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { TerminalScreen } from "@tuidom/core/rendering/terminalScreen";
import { describe, expect, it } from "vitest";

import type { IPanelContainerOptions } from "./panelContainerElement.ts";
import { PanelContainerElement } from "./panelContainerElement.ts";

// Экран больше панели, чтобы запись за край была видна.
const SCREEN = new Size(24, 8);
const ORIGIN = new Offset(1, 1);

const PANEL_BG = packRgb(7, 8, 9);
const SIDEBAR_BG = packRgb(17, 18, 19);
const SIDEBAR_FG = packRgb(27, 28, 29);
const BORDER = packRgb(70, 80, 90);
const DESCRIPTION_FG = packRgb(101, 102, 103);

const VARS = {
    "panel.background": PANEL_BG,
    "panel.border": BORDER,
    "sideBar.background": SIDEBAR_BG,
    "sideBar.foreground": SIDEBAR_FG,
    "panelTitle.inactiveForeground": packRgb(44, 55, 66),
    descriptionForeground: DESCRIPTION_FG,
    "toolbar.hoverBackground": packRgb(10, 20, 30),
};

const SIDE_BAR_OPTIONS: IPanelContainerOptions = {
    background: "sideBar.background",
    foreground: "sideBar.foreground",
    topBorder: false,
    contentLeft: 1,
};

class MarkerContent extends TUIElement {
    public constructor(private readonly marker: string) {
        super();
    }

    public override render(context: RenderContext): void {
        context.setCell(0, 0, { char: this.marker, fg: this.resolvedStyle.fg });
    }
}

class HostElement extends TUIElement {
    public host(child: TUIElement): void {
        this.appendChild(child);
    }
}

/** Нажатие левой кнопки в колонке/строке экрана (0-based; токен мыши — 1-based). */
function press(x: number, y: number): MouseToken {
    return {
        kind: "mouse",
        button: "left",
        action: "press",
        x: x + 1,
        y: y + 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    };
}

function paint(panel: PanelContainerElement, size = new Size(20, 6)): TerminalScreen {
    panel.setStyleVars(VARS);
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

function row(screen: TerminalScreen, y: number, width = 20): string {
    let text = "";
    for (let x = 0; x < width; x++) text += at(screen, x, y).char;
    return text;
}

describe("PanelContainerElement: опции вида части", () => {
    it("по умолчанию — нижняя панель: полоса границы, шапка на второй строке, контент с отступом 2", () => {
        const panel = new PanelContainerElement();
        panel.addView({ id: "a", title: "ONE", content: new MarkerContent("M") });
        const screen = paint(panel);
        expect(row(screen, 0)).toBe("─".repeat(20));
        expect(at(screen, 0, 0).fg).toBe(BORDER);
        expect(row(screen, 1).startsWith("  ONE")).toBe(true);
        expect(at(screen, 2, 2).char).toBe("M");
        expect(at(screen, 5, 4).bg).toBe(PANEL_BG);
    });

    it("вид сайдбара: фон и текст sideBar.*, без полосы, шапка на первой строке, контент с колонки 1", () => {
        const panel = new PanelContainerElement(SIDE_BAR_OPTIONS);
        panel.addView({ id: "a", title: "ONE", content: new MarkerContent("M") });
        const screen = paint(panel);
        expect(row(screen, 0).startsWith("  ONE")).toBe(true);
        expect(row(screen, 0)).not.toContain("─");
        const marker = at(screen, 1, 1);
        expect(marker.char).toBe("M");
        expect(marker.fg).toBe(SIDEBAR_FG);
        expect(at(screen, 5, 4).bg).toBe(SIDEBAR_BG);
    });

    it("вид сайдбара: контент занимает всё под шапкой, кроме колонки саша", () => {
        const panel = new PanelContainerElement(SIDE_BAR_OPTIONS);
        const content = new MarkerContent("M");
        panel.addView({ id: "a", title: "ONE", content });
        paint(panel, new Size(20, 6));
        expect(content.layoutSize).toEqual(new Size(19, 5));
    });

    describe("вид сайдбара: мышь работает на первой строке", () => {
        function scene(): { root: TUIElement; panel: PanelContainerElement; dispatcher: MouseEventDispatcher } {
            const root = new HostElement();
            root.setAsRoot();
            root.localPosition = new Offset(0, 0);
            root.layout(BoxConstraints.tight(new Size(20, 6)));
            const panel = new PanelContainerElement(SIDE_BAR_OPTIONS);
            panel.addView({ id: "a", title: "ONE", content: null });
            panel.addView({ id: "b", title: "TWO", content: null });
            panel.localPosition = new Offset(0, 0);
            panel.layout(BoxConstraints.tight(new Size(20, 6)));
            root.host(panel);
            return { root, panel, dispatcher: new MouseEventDispatcher() };
        }

        it("клик по табу на строке 0 переключает вкладку", () => {
            const { root, panel, dispatcher } = scene();
            const activated: string[] = [];
            panel.onActivateView = (id) => activated.push(id);
            // TWO: колонки 6..10 панели; токены мыши 1-based.
            dispatcher.handleMouseToken(press(8, 0), root);
            expect(panel.getActiveViewId()).toBe("b");
            expect(activated).toEqual(["b"]);
            expect((panel.inspectState() as { tabRow: number }).tabRow).toBe(0);
        });

        it("строка под шапкой — уже контент, клик табы не трогает", () => {
            const { root, panel, dispatcher } = scene();
            dispatcher.handleMouseToken(press(8, 1), root);
            expect(panel.getActiveViewId()).toBe("a");
        });

        it("кнопка закрытия — в правом конце строки 0", () => {
            const { root, panel, dispatcher } = scene();
            let closed = 0;
            panel.onClose = () => closed++;
            dispatcher.handleMouseToken(press(18, 0), root);
            expect(closed).toBe(1);
        });
    });

    it("placeholder вкладки — под шапкой с отступом контента", () => {
        const panel = new PanelContainerElement(SIDE_BAR_OPTIONS);
        panel.addView({ id: "a", title: "ONE", content: null, placeholder: "Empty" });
        const screen = paint(panel);
        expect(row(screen, 1)).toBe(" Empty".padEnd(20));
    });

    describe("сообщение пустой части", () => {
        it("без вкладок — подсказка с переносом по словам под пустой шапкой", () => {
            const panel = new PanelContainerElement({
                ...SIDE_BAR_OPTIONS,
                emptyMessage: "Move a view here to see it.",
            });
            const screen = paint(panel, new Size(14, 6));
            expect(row(screen, 0, 14).trim()).toBe("×");
            expect(row(screen, 1, 14)).toBe(" Move a view  ");
            expect(row(screen, 2, 14)).toBe(" here to see  ");
            expect(row(screen, 3, 14)).toBe(" it.          ");
            expect(at(screen, 1, 1).fg).toBe(DESCRIPTION_FG);
            expect(at(screen, 1, 1).bg).toBe(SIDEBAR_BG);
            expect(at(screen, 12, 1).fg).not.toBe(DESCRIPTION_FG);
        });

        it("не вылезает за нижний край части", () => {
            const panel = new PanelContainerElement({ ...SIDE_BAR_OPTIONS, emptyMessage: "one two three four" });
            const screen = paint(panel, new Size(6, 3));
            expect(row(screen, 1, 6)).toBe(" one  ");
            expect(row(screen, 2, 6)).toBe(" two  ");
            expect(at(screen, 1, 3).char).toBe(" ");
            expect(at(screen, 1, 3).bg).not.toBe(SIDEBAR_BG);
        });

        it("с вкладками подсказки нет", () => {
            const panel = new PanelContainerElement({ ...SIDE_BAR_OPTIONS, emptyMessage: "Nothing" });
            panel.addView({ id: "a", title: "ONE", content: null });
            const screen = paint(panel);
            expect(row(screen, 1)).toBe(" ".repeat(20));
        });

        it("без опции пустая часть пуста", () => {
            const panel = new PanelContainerElement(SIDE_BAR_OPTIONS);
            const screen = paint(panel);
            expect(row(screen, 1)).toBe(" ".repeat(20));
        });
    });
});
