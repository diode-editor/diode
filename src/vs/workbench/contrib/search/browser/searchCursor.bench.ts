import { bench, describe } from "vitest";

import { packRgb } from "@tuidom/all/common/colorUtils";
import { Size } from "@tuidom/all/common/geometryPromitives";
import { ListViewElement } from "@tuidom/all/ui/list/listViewElement";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import type { ITextMatch } from "../../../services/search/common/textSearch.ts";

import { buildFileRow, buildMatchRow, type ISearchRowStyles } from "./searchResultRows.ts";

// Сквозной репро тормозов курсора в дереве результатов поиска
// (docs/TODO/SearchPerformance.md). Запуск: `npm run test:perf`.
//
// Одна итерация = ArrowDown + ArrowUp через настоящий парсер ввода, то есть
// 4 полных синхронных кадра (keydown + keypress на каждое нажатие). Три
// фикстуры разделяют вклад двух главных стоимостей:
//   - длина строки: 2× сегментация DisplayLine на каждый видимый ряд за кадр;
//   - число строк: O(N) стилевой обход всех дочерних строк на движение курсора.
//
// NB: фикстуры на верхнем уровне модуля — в режиме `vitest bench` тяжёлый
// beforeAll отрабатывает некорректно (бенч не набирает сэмплов).

const STYLES: ISearchRowStyles = {
    dimFg: packRgb(128, 128, 128),
    matchFg: packRgb(0, 0, 0),
    matchBg: packRgb(234, 92, 0),
};

function makeSearchApp(rowCount: number, afterLength: number): TestApp {
    const list = new ListViewElement({ typeahead: false });
    const after = " = 42;" + "x".repeat(afterLength);
    let added = 0;
    for (let f = 0; added < rowCount; f++) {
        const fileId = `f${f}`;
        list.appendRow(buildFileRow(fileId, `src/dir${f}/file${f}.ts`, 9, STYLES));
        for (let m = 0; m < 9 && added < rowCount; m++, added++) {
            const match: ITextMatch = {
                lineNumber: 100 + m,
                startColumn: 6,
                endColumn: 12,
                preview: { before: "const ", inside: "needle", after },
            };
            list.appendRow(buildMatchRow(`m${added}`, match, STYLES), { parentId: fileId });
        }
    }
    const app = TestApp.createWithContent(list, new Size(45, 35));
    // Меряем движок, а не харнес: assertValidTree (DFS по всем строкам после
    // каждого кадра, в проде выключен) на 10k-фикстуре давал ~9 мс/кадр и
    // хоронил измеряемую стоимость.
    app.app.validateTreeAfterRender = false;
    list.focus();
    app.render();
    return app;
}

const shortRows = makeSearchApp(200, 0);
const longRows = makeSearchApp(200, 10_000);
const manyRows = makeSearchApp(10_000, 0);

describe("Search — курсор по дереву результатов (4 кадра за итерацию)", () => {
    bench("200 строк, короткий after — базовая стоимость", () => {
        shortRows.sendKey("ArrowDown");
        shortRows.sendKey("ArrowUp");
    });

    bench("200 строк, after 10k символов — цена пересегментации видимых рядов", () => {
        longRows.sendKey("ArrowDown");
        longRows.sendKey("ArrowUp");
    });

    bench("10k строк, короткий after — цена O(N) стилевого обхода", () => {
        manyRows.sendKey("ArrowDown");
        manyRows.sendKey("ArrowUp");
    });
});
