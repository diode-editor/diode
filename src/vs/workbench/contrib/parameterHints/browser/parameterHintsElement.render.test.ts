import { BoxConstraints, Offset, Point, Rect, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { ROOT_STYLE_CONTEXT } from "@tuidom/core/dom/styles/tuiStyle";
import { RenderContext } from "@tuidom/core/dom/tuiElement";
import { TerminalScreen } from "@tuidom/core/rendering/terminalScreen";
import { describe, expect, it } from "vitest";

import { expectScreen, screen } from "../../../../../TestUtils/expectScreen.ts";
import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { computeThemeVars } from "../../../../platform/theme/browser/themeStyleVars.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";

import { ParameterHintsElement, type IParameterHint } from "./parameterHintsElement.ts";

const vars = computeThemeVars(WorkbenchTheme.fromThemeFile(darkPlusTheme));

function hint(patch: Partial<IParameterHint> = {}): IParameterHint {
    return {
        label: "greet(name: string): void",
        activeSpan: [6, 18],
        counter: null,
        documentation: [],
        ...patch,
    };
}

function render(element: ParameterHintsElement) {
    const width = element.getMinIntrinsicWidth(0);
    const height = element.getMinIntrinsicHeight(width);
    return renderElement(element, width, height, { themeVars: true });
}

/**
 * Ручной рендер в `TerminalScreen` — единственный путь к флагам стиля ячейки:
 * `MockTerminalBackend` из `renderElement` хранит только текст и цвета (сам
 * `renderElement` про этот случай и пишет «для доступа к TerminalScreen —
 * ручной сетап»).
 */
function renderToScreen(element: ParameterHintsElement): TerminalScreen {
    const size = new Size(element.getMinIntrinsicWidth(0), element.getMinIntrinsicHeight(0));
    const termScreen = new TerminalScreen(size);
    element.localPosition = new Offset(0, 0);
    element.layout(BoxConstraints.tight(size));
    element.setStyleVars(vars);
    element.performStyleResolution(ROOT_STYLE_CONTEXT);
    element.render(new RenderContext(termScreen, new Offset(0, 0), new Rect(new Point(0, 0), size)));
    return termScreen;
}

describe("ParameterHintsElement — раскладка", () => {
    it("рамка + сигнатура: ширина по метке, минимум 20", () => {
        const element = new ParameterHintsElement();
        element.setHint(hint());

        // Max-интринсики совпадают с min: попап не тянется (их читает overlay-слой).
        expect(element.getMaxIntrinsicWidth(0)).toBe(element.getMinIntrinsicWidth(0));
        expect(element.getMaxIntrinsicHeight(0)).toBe(element.getMinIntrinsicHeight(0));
        expectScreen(
            render(element),
            screen`
                ╭───────────────────────────╮
                │ greet(name: string): void │
                ╰───────────────────────────╯
            `,
        );
    });

    it("счётчик перегрузок — слева, перенос метки идёт под ним", () => {
        const element = new ParameterHintsElement();
        element.maxWidth = 26;
        element.setHint(hint({ label: "greet(name: string, age: number): void", counter: "1/2" }));

        expectScreen(
            render(element),
            screen`
                ╭────────────────────────╮
                │ 1/2 greet(name:        │
                │     string, age:       │
                │     number): void      │
                ╰────────────────────────╯
            `,
        );
    });

    it("описания идут под разделителем, по разделителю на блок", () => {
        const element = new ParameterHintsElement();
        element.setHint(hint({ documentation: ["name: кого приветствуем", "Здоровается с человеком."] }));

        expectScreen(
            render(element),
            screen`
                ╭───────────────────────────╮
                │ greet(name: string): void │
                │ ───────────────────────── │
                │ name: кого приветствуем   │
                │ ───────────────────────── │
                │ Здоровается с человеком.  │
                ╰───────────────────────────╯
            `,
        );
    });

    it("пустой блок описания не рисует разделитель в пустоту", () => {
        const element = new ParameterHintsElement();
        element.setHint(hint({ documentation: ["", "   "] }));

        expect(element.linesFor(30)).toEqual(["greet(name: string): void"]);
    });

    it("высота клампится: длинное описание обрезается", () => {
        const element = new ParameterHintsElement();
        element.maxHeight = 5;
        element.setHint(hint({ documentation: ["раз два три четыре пять шесть семь восемь девять десять"] }));

        expect(element.getMinIntrinsicHeight(0)).toBe(5);
        // Строк контента больше, чем влезает: внутрь рамки попали первые три.
        expect(element.linesFor(30).length).toBeGreaterThan(3);
        const backend = render(element);
        const bottom = backend.getTextAt(new Point(0, 4), element.getMinIntrinsicWidth(0));
        expect(bottom).toMatch(/^╰─+╯$/u);
    });

    it("без подсказки элемент не занимает места и не падает при рендере", () => {
        const element = new ParameterHintsElement();
        element.setHint(null);

        expect(element.isEmpty).toBe(true);
        expect(element.getMinIntrinsicWidth(0)).toBe(0);
        expect(element.getMinIntrinsicHeight(0)).toBe(0);
        expect(element.linesFor(30)).toEqual([]);
        expect(() => renderElement(element, 4, 4, { themeVars: true })).not.toThrow();
    });

    it("фокус не забирает — попап живёт при активном редакторе", () => {
        expect(new ParameterHintsElement().focusable).toBe(false);
    });
});

describe("ParameterHintsElement — цвета", () => {
    it("рамка, фон и текст — токены editorHoverWidget.*", () => {
        const element = new ParameterHintsElement();
        element.setHint(hint());
        const backend = render(element);

        expect(backend.getFgAt(new Point(0, 0))).toBe(vars["editorHoverWidget.border"]);
        expect(backend.getBgAt(new Point(2, 1))).toBe(vars["editorHoverWidget.background"]);
        // «g» из greet — обычный текст, не активный параметр.
        expect(backend.getFgAt(new Point(2, 1))).toBe(vars["editorHoverWidget.foreground"]);
    });

    it("активный параметр — highlightForeground и жирный, соседи не тронуты", () => {
        const element = new ParameterHintsElement();
        // greet(name: string): void
        //       ^ 6              ^ 18 (конец эксклюзивный)
        element.setHint(hint({ activeSpan: [6, 18] }));
        const backend = render(element);
        const width = element.getMinIntrinsicWidth(0);
        const nameX = backend.getTextAt(new Point(0, 1), width).indexOf("name");

        expect(backend.getFgAt(new Point(nameX, 1))).toBe(vars["editorHoverWidget.highlightForeground"]);
        expect(renderToScreen(element).getCell(new Point(nameX, 1)).style & StyleFlags.Bold).toBe(StyleFlags.Bold);
        // Скобка перед параметром — вне диапазона.
        expect(backend.getFgAt(new Point(nameX - 1, 1))).toBe(vars["editorHoverWidget.foreground"]);
        // Символ сразу за диапазоном (`)` в `string)`) — тоже.
        expect(backend.getFgAt(new Point(nameX + 12, 1))).toBe(vars["editorHoverWidget.foreground"]);
    });

    it("подсветка едет на перенесённую строку, а счётчик и отступ не подсвечиваются", () => {
        const element = new ParameterHintsElement();
        element.maxWidth = 26;
        const label = "greet(name: string, age: number): void";
        element.setHint(hint({ label, counter: "1/2", activeSpan: [20, 31] }));
        const backend = render(element);

        // Вторая строка метки: «    string, age:» — подсвечен только «age:».
        const second = backend.getTextAt(new Point(0, 2), element.getMinIntrinsicWidth(0));
        const ageX = second.indexOf("age");
        expect(backend.getFgAt(new Point(ageX, 2))).toBe(vars["editorHoverWidget.highlightForeground"]);
        // Отступ под счётчиком — обычный фон, без подсветки.
        expect(backend.getFgAt(new Point(2, 2))).toBe(vars["editorHoverWidget.foreground"]);
        // Счётчик первой строки — тоже обычным цветом.
        expect(backend.getFgAt(new Point(2, 1))).toBe(vars["editorHoverWidget.foreground"]);
    });

    it("пустой диапазон не подсвечивает ничего", () => {
        const element = new ParameterHintsElement();
        element.setHint(hint({ activeSpan: [0, 0] }));
        const backend = render(element);

        expect(backend.getFgAt(new Point(2, 1))).toBe(vars["editorHoverWidget.foreground"]);
        expect(renderToScreen(element).getCell(new Point(2, 1)).style & StyleFlags.Bold).toBe(0);
    });
});
