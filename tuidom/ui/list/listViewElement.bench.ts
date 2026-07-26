import { bench, describe } from "vitest";

import { TestApp } from "../../../src/TestUtils/TestApp.ts";
import { Point, Size } from "../../common/geometryPromitives.ts";
import { TextLabelElement } from "../text/textLabelElement.ts";

import { ListViewElement } from "./listViewElement.ts";

// Бенчмарки виртуализирующего списка. Запуск: `npm run test:perf`.
//
// Ключевое свойство: стоимость кадра не зависит от числа строк (layout/render
// трогают только видимое окно), а мутации (append/collapse) платят одной
// ленивой пересборкой проекции O(N) на кадр.
//
// NB: фикстуры строятся на верхнем уровне модуля (top-level await), а не в
// beforeAll — в режиме `vitest bench` тяжёлая инициализация в beforeAll
// отрабатывает некорректно (бенч не набирает сэмплов).

function makeRow(id: string): TextLabelElement {
    const row = new TextLabelElement(id);
    row.id = id;
    return row;
}

// ─── 100k строк: стоимость кадра ─────────────────────────────────────────────

const bigList = new ListViewElement();
for (let g = 0; g < 10_000; g++) {
    const groupId = `g${g}`;
    bigList.appendRow(makeRow(groupId), { label: groupId });
    for (let c = 0; c < 9; c++) {
        bigList.appendRow(makeRow(`${groupId}/c${c}`), { parentId: groupId });
    }
}
const bigApp = TestApp.createWithContent(bigList, new Size(60, 40));

describe("ListViewElement — 100k rows", () => {
    bench("render frame (40 rows) on scroll", () => {
        bigList.scrollBy(0, 1);
        bigList.scrollBy(0, -1);
        bigApp.render();
    });

    bench("hit-test at a deep position", () => {
        bigList.elementFromPoint(new Point(10, 20));
    });

    bench("toggleCollapsed of one group (projection rebuild)", () => {
        bigList.toggleCollapsed("g5000");
        bigList.toggleCollapsed("g5000");
        bigApp.render();
    });
});

// ─── Стриминговый append ─────────────────────────────────────────────────────

describe("ListViewElement — streaming append", () => {
    let generation = 0;

    bench("append 10k rows + one projection rebuild", () => {
        const list = new ListViewElement();
        TestApp.createWithContent(list, new Size(60, 40));
        const prefix = `gen${generation++}`;
        for (let i = 0; i < 10_000; i++) {
            list.appendRow(makeRow(`${prefix}-r${i}`));
        }
        // Чтение contentHeight материализует проекцию — ровно одна пересборка.
        void list.contentHeight;
    });
});
