import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../src/TestUtils/TestApp.ts";
import { DisplayLine } from "../../common/displayLine.ts";
import { Size } from "../../common/geometryPromitives.ts";

import { TextLabelElement } from "./textLabelElement.ts";

// Репро-тесты диагностики тормозов окна поиска (docs/TODO/SearchPerformance.md).
//
// TextLabelElement строит DisplayLine (полный проход Intl.Segmenter + слот на
// графему) ДВАЖДЫ за кадр — в performLayout (getMaxIntrinsicWidth) и в render
// (drawText) — без stopAfter и без кэша между кадрами. Замеры стоимости одного
// построения — docs/TODO/LongLinePerformance.md: 10k символов ≈ 4.9 мс,
// 200k ≈ 72 мс. Для строки результата поиска с необрезанным хвостом это
// главный множитель тормозов.
//
// Тесты пиннят текущее поведение; фикс (stopAfter/кэш в лейбле) обязан их поменять.

describe("TextLabelElement — стоимость сегментации текста", () => {
    it("текст сегментируется дважды за кадр (layout + render) и заново на каждом кадре — кэша нет", () => {
        const longText = "const needle = 42; " + "x".repeat(10_000);
        const label = new TextLabelElement(longText);
        const app = TestApp.createWithContent(label, new Size(30, 2));

        const spy = vi.spyOn(Intl.Segmenter.prototype, "segment");
        const countOurs = (): number => spy.mock.calls.filter((call) => call[0] === longText).length;

        app.render();
        // Видимых колонок 30, но обе сегментации прошли всю 10k-строку.
        expect(countOurs()).toBe(2);

        app.render();
        expect(countOurs()).toBe(4);
        spy.mockRestore();
    });

    it("DisplayLine по умолчанию разбирает строку целиком — stopAfter не задан у не-редакторных вызовов", () => {
        const line = new DisplayLine("a".repeat(50_000));

        expect(line.slots.length).toBe(50_000);
        expect(line.isTruncated).toBe(false);
    });
});
