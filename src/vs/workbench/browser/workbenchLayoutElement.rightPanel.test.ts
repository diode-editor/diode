import { BoxConstraints, Offset, Point, Rect, Size } from "@tuidom/core/common/geometryPromitives";
import { RenderContext, TUIElement } from "@tuidom/core/dom/tuiElement";
import { TerminalScreen } from "@tuidom/core/rendering/terminalScreen";
import { SashElement } from "@tuidom/elements/sash/sashElement";
import { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { describe, expect, it, vi } from "vitest";

import { WorkbenchLayoutElement } from "./workbenchLayoutElement.ts";

class FillPanel extends TUIElement {
    public constructor(private readonly marker: string) {
        super();
    }

    public override render(context: RenderContext): void {
        for (let y = 0; y < this.layoutSize.height; y++) {
            for (let x = 0; x < this.layoutSize.width; x++) {
                context.setCell(x, y, { char: this.marker, fg: 0, bg: 0 });
            }
        }
    }
}

interface Options {
    readonly width?: number;
    readonly left?: boolean;
    readonly leftWidth?: number;
    readonly rightWidth?: number | null;
    readonly bottom?: boolean;
}

function build(options: Options = {}): WorkbenchLayoutElement {
    const layout = new WorkbenchLayoutElement();
    if (options.left !== false) {
        layout.setLeftPanel(new FillPanel("L"));
        layout.setLeftPanelWidth(options.leftWidth ?? 20);
    }
    layout.setCenterContent(new FillPanel("C"));
    layout.setRightPanel(new FillPanel("R"));
    layout.setRightPanelVisible(true);
    if (options.rightWidth !== undefined) layout.setRightPanelWidth(options.rightWidth);
    if (options.bottom === true) {
        layout.setBottomPanel(new FillPanel("B"));
        layout.setBottomPanelVisible(true);
        layout.setBottomPanelHeight(4);
    }
    layout.localPosition = new Offset(0, 0);
    layout.layout(BoxConstraints.tight(new Size(options.width ?? 100, 10)));
    return layout;
}

function frameRow(layout: WorkbenchLayoutElement, row = 0): string {
    const size = layout.layoutSize;
    const backend = new MockTerminalBackend(size);
    const screen = new TerminalScreen(size);
    layout.render(new RenderContext(screen, new Offset(0, 0), new Rect(new Point(0, 0), size)));
    screen.flush(backend);
    return backend.getTextAt(new Point(0, row), size.width);
}

function rightSash(layout: WorkbenchLayoutElement): SashElement {
    // Sash order: left, right, bottom.
    return layout.getChildren().filter((c) => c instanceof SashElement)[1];
}

describe("WorkbenchLayoutElement: правая панель (вторичная боковая)", () => {
    it("скрыта по умолчанию: редактор во всю оставшуюся ширину, панель в дереве с hidden", () => {
        const layout = new WorkbenchLayoutElement();
        const right = new FillPanel("R");
        layout.setCenterContent(new FillPanel("C"));
        layout.setRightPanel(right);
        layout.localPosition = new Offset(0, 0);
        layout.layout(BoxConstraints.tight(new Size(40, 3)));

        expect(layout.getRightPanelVisible()).toBe(false);
        expect(layout.getChildren()).toContain(right);
        expect(right.hidden).toBe(true);
        expect(rightSash(layout).hidden).toBe(true);
        expect(frameRow(layout)).toBe("C".repeat(40));
    });

    it("видимая — справа во всю высоту, ширина по умолчанию 30 на широком окне", () => {
        const layout = build({ width: 140 });
        expect(frameRow(layout)).toBe("L".repeat(20) + "C".repeat(90) + "R".repeat(30));
        expect(frameRow(layout, 9)).toBe("L".repeat(20) + "C".repeat(90) + "R".repeat(30));
    });

    it("дефолтная ширина не шире четверти окна (эталонное min(300, w/4))", () => {
        expect(frameRow(build({ width: 100 }))).toBe("L".repeat(20) + "C".repeat(55) + "R".repeat(25));
        expect(build({ width: 100 }).getRightPanelWidth()).toBeNull();
    });

    it("дефолт не уже минимума даже в окне уже 48 колонок", () => {
        const layout = build({ width: 44, left: false });
        expect(frameRow(layout)).toBe("C".repeat(32) + "R".repeat(12));
    });

    it("нижняя панель — только под редактором (выравнивание center): боковые во всю высоту", () => {
        const layout = build({ width: 100, bottom: true });
        expect(frameRow(layout, 9)).toBe("L".repeat(20) + "B".repeat(55) + "R".repeat(25));
        expect(frameRow(layout, 5)).toBe("L".repeat(20) + "C".repeat(55) + "R".repeat(25));
    });

    it("заданная ширина держится, пока хватает места", () => {
        const layout = build({ width: 120, rightWidth: 40 });
        expect(frameRow(layout)).toBe("L".repeat(20) + "C".repeat(60) + "R".repeat(40));
        expect(layout.getRightPanelWidth()).toBe(40);
    });

    it("сеттер держит нижнюю границу и округляет; null возвращает динамический дефолт", () => {
        const layout = new WorkbenchLayoutElement();
        layout.setRightPanelWidth(3);
        expect(layout.getRightPanelWidth()).toBe(12);
        layout.setRightPanelWidth(33.6);
        expect(layout.getRightPanelWidth()).toBe(34);
        layout.setRightPanelWidth(null);
        expect(layout.getRightPanelWidth()).toBeNull();
    });

    describe("узкое окно: первой уступает правая панель, редактору — 20 колонок", () => {
        it("80 колонок, 30 + 40: правая ужимается до остатка", () => {
            const layout = build({ width: 80, leftWidth: 30, rightWidth: 40 });
            expect(frameRow(layout)).toBe("L".repeat(30) + "C".repeat(20) + "R".repeat(30));
        });

        it("правая на минимуме — дальше ужимается левая", () => {
            const layout = build({ width: 50, leftWidth: 30, rightWidth: 40 });
            expect(frameRow(layout)).toBe("L".repeat(18) + "C".repeat(20) + "R".repeat(12));
        });

        it("не хватает и минимумов — панели не вылезают за окно, редактор отдаёт своё", () => {
            const layout = build({ width: 30, leftWidth: 30, rightWidth: 40 });
            expect(frameRow(layout)).toBe("L".repeat(12) + "C".repeat(6) + "R".repeat(12));
        });

        it("совсем вырожденное окно — правая уступает целиком", () => {
            const layout = build({ width: 14, leftWidth: 30, rightWidth: 40 });
            expect(frameRow(layout)).toBe("L".repeat(12) + "R".repeat(2));
            // The frame is clipped by the window; the width is visible only through the box.
            expect(layout.getRightPanel()!.layoutSize.width).toBe(2);
        });

        it("кламп только на экране: сохранённые ширины переживают узкий терминал", () => {
            const layout = build({ width: 50, leftWidth: 30, rightWidth: 40 });
            expect(layout.getRightPanelWidth()).toBe(40);
            expect(layout.getLeftPanelWidth()).toBe(30);
            layout.layout(BoxConstraints.tight(new Size(140, 10)));
            expect(frameRow(layout)).toBe("L".repeat(30) + "C".repeat(70) + "R".repeat(40));
        });

        it("скрытая левая не отнимает места у правой", () => {
            const layout = build({ width: 80, left: false, rightWidth: 70 });
            expect(frameRow(layout)).toBe("C".repeat(20) + "R".repeat(60));
        });
    });

    describe("ресайз мышью", () => {
        it("саш стоит на первой колонке панели во всю высоту", () => {
            const layout = build({ width: 100 });
            const sash = rightSash(layout);
            expect(sash.hidden).toBe(false);
            expect(sash.globalPosition).toEqual(new Point(75, 0));
            expect(sash.layoutSize).toEqual(new Size(1, 10));
        });

        it("drag саша: колонка границы становится первой колонкой панели", () => {
            const layout = build({ width: 100 });
            const onChange = vi.fn();
            layout.onDidChangeLayout = onChange;
            rightSash(layout).onDrag?.(60);
            expect(layout.getRightPanelWidth()).toBe(40);
            expect(onChange).toHaveBeenCalledTimes(1);
            layout.layout(BoxConstraints.tight(new Size(100, 10)));
            expect(frameRow(layout)).toBe("L".repeat(20) + "C".repeat(40) + "R".repeat(40));
        });

        it("drag не теснит показанную левую: максимум — до минимума редактора", () => {
            const layout = build({ width: 100 });
            rightSash(layout).onDrag?.(0);
            expect(layout.getRightPanelWidth()).toBe(60);
        });

        it("drag не уже минимума", () => {
            const layout = build({ width: 100 });
            rightSash(layout).onDrag?.(99);
            expect(layout.getRightPanelWidth()).toBe(12);
        });

        it("учитывает смещение раскладки по экрану", () => {
            const layout = build({ width: 100 });
            layout.localPosition = new Offset(5, 0);
            layout.layout(BoxConstraints.tight(new Size(100, 10)));
            rightSash(layout).onDrag?.(75);
            expect(layout.getRightPanelWidth()).toBe(30);
        });
    });

    describe("ресайз с клавиатуры (nudge)", () => {
        it("шаг от динамического дефолта, если ширина не задана", () => {
            const layout = build({ width: 100 });
            layout.nudgeRightPanelWidth(3);
            expect(layout.getRightPanelWidth()).toBe(28);
        });

        it("шаг от заданной ширины и кламп с обеих сторон", () => {
            const layout = build({ width: 100, rightWidth: 30 });
            layout.nudgeRightPanelWidth(-3);
            expect(layout.getRightPanelWidth()).toBe(27);
            layout.nudgeRightPanelWidth(-100);
            expect(layout.getRightPanelWidth()).toBe(12);
            layout.nudgeRightPanelWidth(1000);
            expect(layout.getRightPanelWidth()).toBe(60);
        });

        it("извещает подписчика", () => {
            const layout = build({ width: 100 });
            const onChange = vi.fn();
            layout.onDidChangeLayout = onChange;
            layout.nudgeRightPanelWidth(1);
            expect(onChange).toHaveBeenCalledTimes(1);
        });
    });

    describe("левая панель при показанной правой", () => {
        it("drag левого саша оставляет правой её минимум", () => {
            const layout = build({ width: 100 });
            const leftSash = layout.getChildren().find((c) => c instanceof SashElement)!;
            leftSash.onDrag?.(99);
            // 100 - 20 (editor) - 12 (right minimum) = 68.
            expect(layout.getLeftPanelWidth()).toBe(68);
            layout.layout(BoxConstraints.tight(new Size(100, 10)));
            expect(frameRow(layout)).toBe("L".repeat(68) + "C".repeat(20) + "R".repeat(12));
        });

        it("без правой левая растёт до минимума редактора, как раньше", () => {
            const layout = build({ width: 100 });
            layout.setRightPanelVisible(false);
            layout.nudgeLeftPanelWidth(1000);
            expect(layout.getLeftPanelWidth()).toBe(80);
        });
    });

    it("видимость: тумблер извещает подписчика и прячет саш вместе с панелью", () => {
        const layout = build({ width: 100 });
        const onChange = vi.fn();
        layout.onDidChangeLayout = onChange;
        layout.setRightPanelVisible(false);
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(layout.getRightPanel()?.hidden).toBe(true);
        expect(rightSash(layout).hidden).toBe(true);
        layout.layout(BoxConstraints.tight(new Size(100, 10)));
        expect(frameRow(layout)).toBe("L".repeat(20) + "C".repeat(80));
    });

    it("видимая без элемента — не ломает раскладку и саш остаётся скрытым", () => {
        const layout = new WorkbenchLayoutElement();
        layout.setCenterContent(new FillPanel("C"));
        layout.setRightPanelVisible(true);
        layout.localPosition = new Offset(0, 0);
        layout.layout(BoxConstraints.tight(new Size(40, 3)));
        expect(frameRow(layout)).toBe("C".repeat(40));
        expect(rightSash(layout).hidden).toBe(true);
    });

    it("замена элемента правой панели отцепляет прежний", () => {
        const layout = new WorkbenchLayoutElement();
        const first = new FillPanel("1");
        const second = new FillPanel("2");
        layout.setRightPanel(first);
        layout.setRightPanel(second);
        expect(first.getParent()).toBeNull();
        expect(layout.getRightPanel()).toBe(second);
    });

    it("nudge высоты нижней панели: шаг и кламп", () => {
        const layout = build({ width: 100, bottom: true });
        layout.nudgeBottomPanelHeight(2);
        expect(layout.getBottomPanelHeight()).toBe(6);
        layout.nudgeBottomPanelHeight(-100);
        expect(layout.getBottomPanelHeight()).toBe(3);
        layout.nudgeBottomPanelHeight(100);
        expect(layout.getBottomPanelHeight()).toBe(7);
    });
});
