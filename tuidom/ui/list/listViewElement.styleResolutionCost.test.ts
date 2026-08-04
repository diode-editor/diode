import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../src/TestUtils/TestApp.ts";
import { packRgb } from "../../common/colorUtils.ts";
import { Point, Size } from "../../common/geometryPromitives.ts";
import { TUIKeyboardEvent } from "../../dom/events/tuiKeyboardEvent.ts";
import { TUIElement } from "../../dom/tuiElement.ts";
import { TextLabelElement } from "../text/textLabelElement.ts";

import { ListViewElement } from "./listViewElement.ts";

// Регресс-тесты диагностики тормозов окна поиска (docs/TODO/SearchPerformance.md,
// случай 5): стилевой проход ListViewElement виртуализирован, как
// layout/render/hitTest — резолвится только видимое окно строк, O(вьюпорта)
// вместо O(N) на кадр. Офскрин-строки остаются style-dirty и дорезолвливаются
// при въезде в окно (performLayout поднимает markSubtreeStyleDirty).

const N = 500;
const VIEWPORT = 10;
const ACTIVE_BG = packRgb(10, 20, 30);
const INACTIVE_BG = packRgb(40, 50, 60);
const INACTIVE_BG_2 = packRgb(70, 80, 90);

function createList(): { list: ListViewElement; app: TestApp } {
    const list = new ListViewElement({ typeahead: false });
    list.setStyleVars({
        "list.activeSelectionBackground": ACTIVE_BG,
        "list.inactiveSelectionBackground": INACTIVE_BG,
    });
    for (let i = 0; i < N; i++) {
        const row = new TextLabelElement(`row ${i}`);
        row.id = `r${i}`;
        list.appendRow(row);
    }
    const app = TestApp.createWithContent(list, new Size(30, VIEWPORT));
    return { list, app };
}

/** PageDown-прыжки без рендера между ними — кадр снимает вызывающий. */
function pageDown(list: ListViewElement, times: number): void {
    for (let i = 0; i < times; i++) {
        list.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "PageDown" }));
    }
}

/** Вьюпорт-строка текущего курсора списка (по inspectState). */
function cursorY(list: ListViewElement): number {
    const state = list.inspectState();
    const index = Number(String(state.cursorId).slice(1));
    return index - Number(state.scrollTop);
}

describe("ListViewElement — стоимость стилевого прохода", () => {
    it("движение курсора резолвит O(вьюпорта) элементов, а не все N строк", () => {
        const { list, app } = createList();
        list.focus();
        app.render();

        const spy = vi.spyOn(TUIElement.prototype, "performStyleResolution");
        app.sendKey("ArrowDown");

        // Кадр keypress: путь от корня + список + окно хостов с лейблами.
        expect(spy.mock.calls.length).toBeGreaterThan(0);
        expect(spy.mock.calls.length).toBeLessThan(6 * VIEWPORT);
        spy.mockRestore();
    });

    it("получение фокуса — один markStyleDirty вершины и одна прогулка markDirty до корня", () => {
        const { list, app } = createList();
        app.render();

        const styleSpy = vi.spyOn(TUIElement.prototype, "markStyleDirty");
        const dirtySpy = vi.spyOn(TUIElement.prototype, "markDirty");
        list.focus();

        // Каскад флагов по поддереву — внутренний (markStyleSubtree); раньше
        // рекурсия шла через markStyleDirty и гоняла markDirty до корня из
        // каждого из 2N потомков — O(N×глубина) на переключение фокуса.
        expect(styleSpy.mock.calls.length).toBe(1);
        expect(dirtySpy.mock.calls.length).toBeLessThan(10);
        styleSpy.mockRestore();
        dirtySpy.mockRestore();
    });

    it("смена палитры за кадром: въехавшая по скроллу строка несёт новые цвета, не стейл", () => {
        const { list, app } = createList();
        app.render();
        // Выделенная строка окна отрисована старой палитрой.
        expect(app.backend.getBgAt(new Point(3, 0))).toBe(INACTIVE_BG);

        // Смена палитры метит style-dirty ВСЕ строки, но кадр резолвит только окно.
        list.setStyleVars({
            "list.activeSelectionBackground": ACTIVE_BG,
            "list.inactiveSelectionBackground": INACTIVE_BG_2,
        });
        app.render();
        expect(app.backend.getBgAt(new Point(3, 0))).toBe(INACTIVE_BG_2);

        // Строки глубоко за окном были офскрин при смене палитры и остались
        // style-dirty; при въезде в окно обязаны дорезолвиться новой палитрой.
        pageDown(list, 5);
        app.render();
        expect(app.backend.getBgAt(new Point(3, cursorY(list)))).toBe(INACTIVE_BG_2);
    });

    it("фокус-флип + прыжок курсора одним кадром: въехавшая строка видит in:focus предка", () => {
        const { list, app } = createList();
        app.render();

        // Фокус метит style-dirty весь список, прыжок сдвигает окно — оба
        // изменения потребляются одним кадром, и въехавшая выделенная строка
        // обязана резолвиться СВЕЖИМ контекстом (с focus в ancestorStates),
        // а не контекстом прошлого кадра.
        list.focus();
        pageDown(list, 9);
        app.render();

        expect(app.backend.getBgAt(new Point(3, cursorY(list)))).toBe(ACTIVE_BG);
    });
});
