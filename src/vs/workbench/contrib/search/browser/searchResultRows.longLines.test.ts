import { describe, expect, it } from "vitest";

import { packRgb } from "../../../../../../tuidom/common/colorUtils.ts";
import { buildRgArgs, type ITextMatch } from "../../../services/search/common/textSearch.ts";

import { buildMatchRow, type ISearchRowStyles } from "./searchResultRows.ts";

// Репро-тесты диагностики тормозов окна поиска (docs/TODO/SearchPerformance.md).
//
// Контекст СЛЕВА от матча обрезается (trimBefore, 24 символа), а хвост СПРАВА
// (preview.after) попадает в текст ряда целиком — и ripgrep запускается без
// --max-columns, так что длину строки не ограничивает никто. Один матч в
// минифицированном файле или lockfile кладёт в TextLabelElement строку на
// сотни килобайт, которую рендер пересегментирует дважды на каждом кадре
// (см. textLabelElement.segmentationCost.test.ts).
//
// Тесты пиннят текущее поведение; фикс (кап after и/или --max-columns) обязан
// их поменять.

const STYLES: ISearchRowStyles = {
    dimFg: packRgb(128, 128, 128),
    matchFg: packRgb(0, 0, 0),
    matchBg: packRgb(234, 92, 0),
};

describe("searchResultRows — необрезанный хвост длинной строки", () => {
    it("100k-символьный preview.after попадает в текст ряда целиком", () => {
        const match: ITextMatch = {
            lineNumber: 1,
            startColumn: 6,
            endColumn: 12,
            preview: { before: "const ", inside: "needle", after: " = 42;" + "x".repeat(100_000) },
        };

        const row = buildMatchRow("m", match, STYLES);

        expect(row.getText().length).toBeGreaterThan(100_000);
    });

    it("аргументы ripgrep не содержат --max-columns — источник длину строки не ограничивает", () => {
        const args = buildRgArgs(
            {
                pattern: "needle",
                isRegExp: false,
                isCaseSensitive: false,
                isWholeWord: false,
                includes: [],
                excludes: [],
            },
            "/repo",
        );

        expect(args).not.toBeNull();
        expect(args).not.toContain("--max-columns");
    });
});
