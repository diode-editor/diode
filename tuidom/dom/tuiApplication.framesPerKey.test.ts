import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../src/TestUtils/TestApp.ts";
import { Size } from "../common/geometryPromitives.ts";
import { ListViewElement } from "../ui/list/listViewElement.ts";
import { TextLabelElement } from "../ui/text/textLabelElement.ts";

// Репро-тесты диагностики тормозов окна поиска (docs/TODO/SearchPerformance.md).
//
// Они ПИННЯТ текущее патологическое поведение: парсер на каждый физический
// keydown синтезирует парный keypress, а handleInput завершается безусловным
// синхронным renderFrame() на КАЖДОЕ событие — коалесер scheduleRender() на
// пути ввода не участвует. Итог: 2 полных кадра на нажатие (3 под Kitty, где
// добавляется keyup) и по кадру на каждое событие автоповтора без склейки.
//
// Фикс (коалесинг кадров ввода / dirty-гейт) обязан поменять эти ассерты.

function createFocusedList(rowCount: number): { list: ListViewElement; app: TestApp } {
    const list = new ListViewElement({ typeahead: false });
    for (let i = 0; i < rowCount; i++) {
        const row = new TextLabelElement(`row ${i}`);
        row.id = `r${i}`;
        list.appendRow(row);
    }
    const app = TestApp.createWithContent(list, new Size(30, 10));
    list.focus();
    return { list, app };
}

describe("TuiApplication — сколько кадров стоит один ввод", () => {
    it("одно нажатие стрелки рендерит два полных кадра (keydown + синтезированный keypress)", () => {
        const { list, app } = createFocusedList(5);
        const before = app.app.frameCount;

        app.sendKey("ArrowDown");

        expect(list.inspectState().cursorId).toBe("r1");
        expect(app.app.frameCount - before).toBe(2);
    });

    it("автоповтор: пачка из 8 стрелок в одном stdin-чанке — 16 синхронных кадров, без склейки", () => {
        const { list, app } = createFocusedList(20);
        const before = app.app.frameCount;

        app.backend.sendRaw("\x1b[B".repeat(8));

        expect(list.inspectState().cursorId).toBe("r8");
        expect(app.app.frameCount - before).toBe(16);
    });

    it("клавиша, которую никто не обработал, всё равно рендерит два полных кадра", () => {
        const { app } = createFocusedList(3);
        const before = app.app.frameCount;

        app.sendKey("F9");

        expect(app.app.frameCount - before).toBe(2);
    });

    it("кадр не гейтится dirty-флагом: не изменившийся лейбл перелейаучивается на каждом кадре", () => {
        const label = new TextLabelElement("hello");
        const app = TestApp.createWithContent(label, new Size(20, 3));
        const spy = vi.spyOn(label, "getMaxIntrinsicWidth");

        app.sendKey("x");

        // Два кадра (keydown + keypress) — и в каждом полный layout лейбла,
        // хотя ввод его никак не касался.
        expect(spy).toHaveBeenCalledTimes(2);
    });
});
