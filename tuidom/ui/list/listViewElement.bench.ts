import { bench, describe } from "vitest";

import { TestApp } from "../../testing/TestApp.ts";
import { Point, Size } from "../../common/geometryPromitives.ts";
import { TextLabelElement } from "../text/textLabelElement.ts";

import { ListViewElement } from "./listViewElement.ts";

// Бенчмарки виртуализирующего списка. Запуск: `npm run test:perf`.
//
// Ключевое свойство: стоимость кадра не зависит от числа строк (layout/render
// трогают только видимое окно); append-в-хвост дополняет живую проекцию
// инкрементально, и только collapse/hidden/вставка-в-середину платят ленивой
// пересборкой проекции O(N) на кадр.
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

// ─── Кадр между порциями стрима (SearchPerformance.md, случай 6) ─────────────
//
// Репро стрима результатов поиска: список уже большой, каждая порция appendRow
// завершается кадром. Рост списка между сэмплами — сигнал, а не помеха: при
// полной пересборке проекции стоимость итерации растёт с N, при инкрементальном
// дополнении остаётся плоской O(окно + порция).

const streamedList = new ListViewElement();
for (let i = 0; i < 10_000; i++) {
    streamedList.appendRow(makeRow(`s${i}`));
}
const streamedApp = TestApp.createWithContent(streamedList, new Size(60, 40));
// Валидация дерева O(N) на кадр — оверхед тест-харнеса, в проде её нет; она
// хоронит измеряемую стоимость кадра (как в searchCursor.bench.ts).
streamedApp.app.validateTreeAfterRender = false;
streamedApp.render();
let streamSeq = 10_000;

const groupedList = new ListViewElement();
let groupedGroups = 0;
let groupedSeq = 0;
for (let g = 0; g < 1_000; g++) {
    const groupId = `sg${groupedGroups++}`;
    groupedList.appendRow(makeRow(groupId), { label: groupId });
    for (let c = 0; c < 9; c++) {
        groupedList.appendRow(makeRow(`m${groupedSeq++}`), { parentId: groupId });
    }
}
const groupedApp = TestApp.createWithContent(groupedList, new Size(60, 40));
groupedApp.app.validateTreeAfterRender = false;
groupedApp.render();

describe("ListViewElement — frame between streamed batches", () => {
    bench("append 100 top-level rows + frame (10k list)", () => {
        for (let i = 0; i < 100; i++) {
            streamedList.appendRow(makeRow(`s${streamSeq++}`));
        }
        streamedApp.render();
    });

    // Паттерн поиска: матчи дописываются в последнюю (раскрытую) группу файла,
    // время от времени появляется новая группа.
    bench("append group + 99 children into tail group + frame (10k list)", () => {
        const groupId = `sg${groupedGroups++}`;
        groupedList.appendRow(makeRow(groupId), { label: groupId });
        for (let i = 0; i < 99; i++) {
            groupedList.appendRow(makeRow(`m${groupedSeq++}`), { parentId: groupId });
        }
        groupedApp.render();
    });
});
