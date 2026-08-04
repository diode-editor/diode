import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../src/TestUtils/TestApp.ts";
import { Size } from "../common/geometryPromitives.ts";
import { ListViewElement } from "../ui/list/listViewElement.ts";
import { TextLabelElement } from "../ui/text/textLabelElement.ts";

// Регресс-тесты диагностики тормозов окна поиска (docs/TODO/SearchPerformance.md,
// случай 3): одно физическое нажатие приходит 2–3 событиями (keydown +
// синтезированный keypress, под Kitty ещё keyup), и раньше каждое рендерило
// полный синхронный кадр. Теперь кадр после события ввода рисуется только
// если обработчики что-то пометили грязным (dirty-гейт renderAfterInput):
// одно нажатие — один кадр, пустые события — ноль.

function createFocusedList(rowCount: number): { list: ListViewElement; app: TestApp } {
    const list = new ListViewElement({ typeahead: false });
    for (let i = 0; i < rowCount; i++) {
        const row = new TextLabelElement(`row ${i}`);
        row.id = `r${i}`;
        list.appendRow(row);
    }
    const app = TestApp.createWithContent(list, new Size(30, 10));
    list.focus();
    // Устаканить кадр после смены фокуса — иначе первое событие ввода рендерит
    // легитимно отложенную фокус-перерисовку и портит счёт кадров.
    app.render();
    return { list, app };
}

describe("TuiApplication — сколько кадров стоит один ввод", () => {
    it("одно нажатие стрелки рендерит ровно один кадр (пустой keydown-кадр пропущен)", () => {
        const { list, app } = createFocusedList(5);
        const before = app.app.frameCount;

        app.sendKey("ArrowDown");

        expect(list.inspectState().cursorId).toBe("r1");
        expect(app.app.frameCount - before).toBe(1);
    });

    it("автоповтор: пачка из 8 стрелок в одном stdin-чанке — 8 кадров, по одному на движение", () => {
        const { list, app } = createFocusedList(20);
        const before = app.app.frameCount;

        app.backend.sendRaw("\x1b[B".repeat(8));

        expect(list.inspectState().cursorId).toBe("r8");
        expect(app.app.frameCount - before).toBe(8);
    });

    it("клавиша, которую никто не обработал, не рендерит ни одного кадра", () => {
        const { app } = createFocusedList(3);
        const before = app.app.frameCount;

        app.sendKey("F9");

        expect(app.app.frameCount - before).toBe(0);
    });

    it("не изменившийся лейбл не перелейаучивается на пустом вводе — кадр не рисуется вовсе", () => {
        const label = new TextLabelElement("hello");
        const app = TestApp.createWithContent(label, new Size(20, 3));
        const spy = vi.spyOn(label, "getMaxIntrinsicWidth");

        app.sendKey("x");

        expect(spy).not.toHaveBeenCalled();
        expect(app.app.frameCount).toBe(1);
    });
});
