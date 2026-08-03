import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../src/TestUtils/TestApp.ts";
import { DisplayLine } from "../../common/displayLine.ts";
import { Size } from "../../common/geometryPromitives.ts";

import { TextLabelElement } from "./textLabelElement.ts";

// Регресс-тесты диагностики тормозов окна поиска (docs/TODO/SearchPerformance.md,
// случай 2): раньше TextLabelElement строил DisplayLine (полный
// Intl.Segmenter-проход, слот на графему) дважды за КАЖДЫЙ кадр — в
// performLayout и в drawText. Теперь DisplayLine кэшируется в лейбле до
// setText и передаётся в drawText готовым (options.displayLine).

describe("TextLabelElement — стоимость сегментации текста", () => {
    it("текст сегментируется один раз на setText, а не на каждом кадре", () => {
        const longText = "const needle = 42; " + "x".repeat(10_000);
        // Шпион — ДО создания приложения: initial render строит кэш.
        const spy = vi.spyOn(Intl.Segmenter.prototype, "segment");
        const countOurs = (): number => spy.mock.calls.filter((call) => call[0] === longText).length;

        const label = new TextLabelElement(longText);
        const app = TestApp.createWithContent(label, new Size(30, 2));
        // Первый кадр (layout + render) построил DisplayLine ровно один раз.
        expect(countOurs()).toBe(1);

        app.render();
        app.render();
        expect(countOurs()).toBe(1);

        label.setText(longText + "!");
        app.render();
        expect(spy.mock.calls.filter((call) => call[0] === longText + "!").length).toBe(1);
        expect(countOurs()).toBe(1);
        spy.mockRestore();
    });

    it("DisplayLine по умолчанию разбирает строку целиком — кап живёт у потребителей", () => {
        // stopAfter в лейбл осознанно не добавлен: поиск капает хвост у истока
        // (splitPreviewByBytes), а tuidom остаётся generic. Этот пин фиксирует
        // дефолт конструктора.
        const line = new DisplayLine("a".repeat(50_000));

        expect(line.slots.length).toBe(50_000);
        expect(line.isTruncated).toBe(false);
    });
});
