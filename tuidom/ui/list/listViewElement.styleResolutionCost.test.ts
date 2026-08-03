import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../src/TestUtils/TestApp.ts";
import { Size } from "../../common/geometryPromitives.ts";
import { TUIElement } from "../../dom/tuiElement.ts";
import { TextLabelElement } from "../text/textLabelElement.ts";

import { ListViewElement } from "./listViewElement.ts";

// Репро-тесты диагностики тормозов окна поиска (docs/TODO/SearchPerformance.md).
//
// ListViewElement виртуализирует layout/render/hitTest, но НЕ стилевой проход:
// каждая строка — настоящий дочерний TUIElement, а performStyleResolution не
// переопределён. Движение курсора флипает `selected` на двух строках, список
// получает subtreeStyleDirty — и базовый цикл обходит ВСЕ N детей, хотя
// изменились две. Фокус ещё дороже: markStyleDirty рекурсивно помечает всё
// поддерево (N хостов + N лейблов), и каждый зовёт markDirty() до корня.
//
// Тесты пиннят текущее O(N)-поведение; фикс (виртуализация стилевого прохода)
// обязан поменять ассерты на O(видимого).

const N = 500;

function createList(): { list: ListViewElement; app: TestApp } {
    const list = new ListViewElement({ typeahead: false });
    for (let i = 0; i < N; i++) {
        const row = new TextLabelElement(`row ${i}`);
        row.id = `r${i}`;
        list.appendRow(row);
    }
    const app = TestApp.createWithContent(list, new Size(30, 10));
    return { list, app };
}

describe("ListViewElement — стоимость стилевого прохода", () => {
    it("движение курсора запускает стилевой обход всех N строк, хотя изменились две", () => {
        const { list, app } = createList();
        list.focus();
        // Устаканить стили после фокуса — следующий кадр начинается чистым.
        app.render();

        const spy = vi.spyOn(TUIElement.prototype, "performStyleResolution");
        app.sendKey("ArrowDown");

        // Кадр keypress: layout флипнул `selected` на двух хостах → список
        // subtreeStyleDirty → цикл прошёлся по всем N дочерним строкам.
        expect(spy.mock.calls.length).toBeGreaterThan(N);
        spy.mockRestore();
    });

    it("получение фокуса каскадно инвалидирует стили всего поддерева — все N строк с лейблами", () => {
        const { list, app } = createList();
        app.render();

        const spy = vi.spyOn(TUIElement.prototype, "markStyleDirty");
        list.focus();

        // setStyleState("focus") на списке рекурсивно помечает style-dirty
        // каждый хост и каждый лейбл: ≥ 2N вызовов на одно переключение фокуса.
        expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2 * N);
        spy.mockRestore();
    });
});
