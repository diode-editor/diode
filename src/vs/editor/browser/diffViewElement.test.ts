import { describe, expect, it } from "vitest";

import { packRgb } from "../../../../tuidom/common/colorUtils.ts";
import { Point, Size } from "../../../../tuidom/common/geometryPromitives.ts";
import { TUIKeyboardEvent } from "../../../../tuidom/dom/events/tuiKeyboardEvent.ts";
import { TUIMouseEvent } from "../../../../tuidom/dom/events/tuiMouseEvent.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { DefaultLinesDiffComputer } from "../common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.ts";
import { DiffViewModel } from "../common/diff/diffViewModel.ts";
import { createLineTokens, createToken } from "../common/languages/iLineTokens.ts";
import { EMPTY_RESOLVED_TOKEN_STYLE } from "../common/languages/iTokenStyleResolver.ts";

import type { IDiffRowSource } from "./diffViewElement.ts";
import { DiffViewElement } from "./diffViewElement.ts";

const ADDED_BG = packRgb(0x37, 0x3d, 0x29);
const REMOVED_BG = packRgb(0x4b, 0x18, 0x18);
const BG = packRgb(0x1e, 0x1e, 0x1e);
const FG = packRgb(0xcc, 0xcc, 0xcc);
const LINE_NO = packRgb(0x85, 0x85, 0x85);
const COLLAPSED_FG = packRgb(0x8c, 0x8c, 0x8c);
const KEYWORD = packRgb(0x56, 0x9c, 0xd6);

const STYLE_VARS = {
    "editorGutter.background": BG,
    "editorLineNumber.foreground": LINE_NO,
    "diffEditor.insertedLineBackground": ADDED_BG,
    "diffEditor.removedLineBackground": REMOVED_BG,
    "diffEditor.unchangedRegionForeground": COLLAPSED_FG,
};

/** Источник строк без токенов — подсветка проверяется отдельным тестом. */
function plainSource(original: string[], modified: string[]): IDiffRowSource {
    return {
        getLine: (side, line) => (side === "original" ? original : modified)[line] ?? "",
        getLineTokens: () => undefined,
        resolveTokenStyle: () => EMPTY_RESOLVED_TOKEN_STYLE,
    };
}

function makeElement(
    original: string[],
    modified: string[],
    options: { collapsed?: boolean; source?: IDiffRowSource } = {},
): DiffViewElement {
    const diff = new DefaultLinesDiffComputer().computeDiff(original, modified, {
        ignoreTrimWhitespace: false,
        maxComputationTimeMs: Number.MAX_SAFE_INTEGER,
        computeMoves: false,
    });
    const model = new DiffViewModel(diff.changes, original.length, modified.length, {
        hideUnchangedRegions: options.collapsed === true,
    });
    const element = new DiffViewElement();
    element.setStyleVars(STYLE_VARS);
    element.style = { fg: FG, bg: BG };
    element.setRows(model.rows, options.source ?? plainSource(original, modified));
    return element;
}

function render(element: DiffViewElement, size = new Size(46, 8)): TestApp {
    const app = TestApp.createWithContent(element, size);
    app.render();
    return app;
}

/** Строки экрана без хвостовых пробелов — так проще читать ассерты. */
function screenLines(app: TestApp): string[] {
    return app.backend
        .screenToString()
        .split("\n")
        .map((l) => l.replace(/\s+$/, ""));
}

describe("DiffViewElement — гуттер и маркеры", () => {
    it("рисует номера обеих сторон и маркеры правки", () => {
        const app = render(makeElement(["a", "b", "c"], ["a", "B", "c"]));

        expect(screenLines(app).slice(0, 4)).toEqual([
            "  1 1    a", //
            "  2   -  b",
            "    2 +  B",
            "  3 3    c",
        ]);
    });

    it("вставка занимает только колонку изменённого файла", () => {
        const app = render(makeElement(["a", "c"], ["a", "b", "c"]));

        expect(screenLines(app).slice(0, 3)).toEqual([
            "  1 1    a", //
            "    2 +  b",
            "  2 3    c",
        ]);
    });

    it("удаление занимает только колонку оригинала", () => {
        const app = render(makeElement(["a", "b", "c"], ["a", "c"]));

        expect(screenLines(app).slice(0, 3)).toEqual([
            "  1 1    a", //
            "  2   -  b",
            "  3 2    c",
        ]);
    });

    it("ширина колонок номеров растёт под самый большой номер", () => {
        const lines = Array.from({ length: 12 }, (_, i) => `l${String(i)}`);
        const app = render(makeElement(lines, lines), new Size(46, 14));

        // Двузначные номера — колонка шириной 2, текст сдвинут вправо.
        expect(screenLines(app)[11]).toBe("  12 12    l11");
    });
});

describe("DiffViewElement — цвета", () => {
    /** Фон строки экрана (берём колонку внутри текста). */
    const bgAt = (app: TestApp, y: number) => app.backend.getBgAt(new Point(0, y));

    it("добавленные и удалённые строки красятся фоном из темы", () => {
        const app = render(makeElement(["a", "b", "c"], ["a", "B", "c"]));

        expect(bgAt(app, 0)).toBe(BG);
        expect(bgAt(app, 1)).toBe(REMOVED_BG);
        expect(bgAt(app, 2)).toBe(ADDED_BG);
        expect(bgAt(app, 3)).toBe(BG);
    });

    it("фон тянется на всю ширину, а не по длине текста", () => {
        const app = render(makeElement(["a", "b", "c"], ["a", "B", "c"]));

        expect(app.backend.getBgAt(new Point(40, 1))).toBe(REMOVED_BG);
    });

    it("номера строк красятся своим цветом", () => {
        const app = render(makeElement(["a"], ["a"]));

        expect(app.backend.getFgAt(new Point(2, 0))).toBe(LINE_NO);
    });
});

describe("DiffViewElement — свёрнутые куски", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `line${String(i)}`);

    it("плейсхолдер показывает число скрытых строк и красится своим цветом", () => {
        const original = many(20);
        const modified = [...many(20).slice(0, 9), "CHANGED", ...many(20).slice(10)];
        const app = render(makeElement(original, modified, { collapsed: true }), new Size(46, 10));

        const lines = screenLines(app);
        expect(lines[0]).toBe("   ⋯  ⋯    ⋯ 6 unchanged lines");
        // Гуттер при двузначных номерах — 11 колонок; текст плейсхолдера сразу за ним.
        expect(app.backend.getFgAt(new Point(11, 0))).toBe(COLLAPSED_FG);
    });

    it("единственная скрытая строка склоняется в единственном числе", () => {
        // Граница: minimumHiddenLineCount = 1, чтобы получить кусок ровно в строку.
        const original = ["a", "x", "b"];
        const modified = ["A", "x", "B"];
        const diff = new DefaultLinesDiffComputer().computeDiff(original, modified, {
            ignoreTrimWhitespace: false,
            maxComputationTimeMs: Number.MAX_SAFE_INTEGER,
            computeMoves: false,
        });
        const model = new DiffViewModel(diff.changes, 3, 3, {
            hideUnchangedRegions: true,
            contextLineCount: 0,
            minimumHiddenLineCount: 1,
        });
        const element = new DiffViewElement();
        element.setStyleVars(STYLE_VARS);
        element.style = { fg: FG, bg: BG };
        element.setRows(model.rows, plainSource(original, modified));

        expect(screenLines(render(element))).toContain("  ⋯ ⋯    ⋯ 1 unchanged line");
    });
});

describe("DiffViewElement — подсветка синтаксиса", () => {
    it("токены красятся резолвером стилей", () => {
        const original = ["const a = 1;"];
        const modified = ["const a = 2;"];
        const source: IDiffRowSource = {
            getLine: (side, line) => (side === "original" ? original : modified)[line] ?? "",
            // Первые пять символов — ключевое слово.
            getLineTokens: () => createLineTokens([createToken(0, ["keyword"]), createToken(5, ["text"])]),
            resolveTokenStyle: (scopes) =>
                scopes.includes("keyword")
                    ? { ...EMPTY_RESOLVED_TOKEN_STYLE, fg: KEYWORD, bold: true }
                    : EMPTY_RESOLVED_TOKEN_STYLE,
        };
        const app = render(makeElement(original, modified, { source }));

        // Строка 0 — удалённая; текст начинается сразу за гуттером (ширина 6).
        expect(app.backend.getTextAt(new Point(9, 0), 5)).toBe("const");
        expect(app.backend.getFgAt(new Point(9, 0))).toBe(KEYWORD);
        // Символ за ключевым словом уже без подсветки.
        expect(app.backend.getFgAt(new Point(15, 0))).toBe(FG);
    });
});

describe("DiffViewElement — скролл", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `line${String(i)}`);

    it("прокрутка сдвигает содержимое", () => {
        const element = makeElement(many(30), many(30));
        const app = render(element, new Size(46, 5));
        expect(screenLines(app)[0]).toBe("   1  1    line0");

        element.scrollBy(4);
        app.render();

        expect(screenLines(app)[0]).toBe("   5  5    line4");
        expect(element.scrollTop).toBe(4);
    });

    it("прокрутка ограничена концом содержимого", () => {
        const element = makeElement(many(10), many(10));
        render(element, new Size(46, 5));

        element.scrollBy(1000);

        expect(element.scrollTop).toBe(5);
    });

    it("прокрутка вверх не уходит в минус", () => {
        const element = makeElement(many(10), many(10));
        render(element, new Size(46, 5));

        element.scrollBy(-1000);

        expect(element.scrollTop).toBe(0);
    });

    it("contentHeight равен числу строк вью", () => {
        const element = makeElement(many(10), many(10));

        expect(element.contentHeight).toBe(10);
    });
});

describe("DiffViewElement — события", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `line${String(i)}`);

    function mounted(rowCount = 30, height = 5) {
        const element = makeElement(many(rowCount), many(rowCount));
        const app = render(element, new Size(46, height));
        return { element, app };
    }

    const wheel = (element: DiffViewElement, direction: "up" | "down" | "left") =>
        element.dispatchEvent(
            new TUIMouseEvent("wheel", {
                button: "left",
                screenX: 0,
                screenY: 0,
                localX: 0,
                localY: 0,
                wheelDirection: direction,
            }),
        );

    const key = (element: DiffViewElement, name: string) =>
        element.dispatchEvent(new TUIKeyboardEvent("keypress", { key: name }));

    it("колесо вниз и вверх прокручивает", () => {
        const { element } = mounted();

        wheel(element, "down");
        expect(element.scrollTop).toBe(3);

        wheel(element, "up");
        expect(element.scrollTop).toBe(0);
    });

    it("горизонтальное колесо игнорируется", () => {
        const { element } = mounted();

        wheel(element, "left");

        expect(element.scrollTop).toBe(0);
    });

    it("стрелки листают по строке", () => {
        const { element } = mounted();

        key(element, "ArrowDown");
        expect(element.scrollTop).toBe(1);

        key(element, "ArrowUp");
        expect(element.scrollTop).toBe(0);
    });

    it("PageDown/PageUp листают на экран без одной строки", () => {
        const { element } = mounted(30, 5);

        key(element, "PageDown");
        expect(element.scrollTop).toBe(4);

        key(element, "PageUp");
        expect(element.scrollTop).toBe(0);
    });

    it("Home и End прыгают к краям", () => {
        const { element } = mounted(30, 5);

        key(element, "End");
        expect(element.scrollTop).toBe(25);

        key(element, "Home");
        expect(element.scrollTop).toBe(0);
    });

    it("прочие клавиши не трогают прокрутку", () => {
        const { element } = mounted();

        key(element, "a");

        expect(element.scrollTop).toBe(0);
    });
});

describe("DiffViewElement — размеры и сложные символы", () => {
    it("intrinsic-размеры отражают гуттер и число строк", () => {
        const element = makeElement(["a", "b"], ["a", "B"]);

        expect(element.getMinIntrinsicWidth()).toBe(element.gutterWidth);
        expect(element.getMaxIntrinsicWidth()).toBe(Number.MAX_SAFE_INTEGER);
        expect(element.getMinIntrinsicHeight()).toBe(1);
        expect(element.getMaxIntrinsicHeight()).toBe(element.rows.length);
    });

    it("пустой набор строк даёт минимальные размеры", () => {
        const element = makeElement([""], [""]);

        expect(element.getMaxIntrinsicHeight()).toBe(1);
        expect(element.contentHeight).toBe(1);
    });

    it("табы разворачиваются в пробелы", () => {
        const app = render(makeElement(["\tx"], ["\ty"]), new Size(46, 4));

        // Гуттер 9 колонок, дальше таб на 4 позиции, затем символ.
        expect(app.backend.getTextAt(new Point(9, 0), 4)).toBe("    ");
        expect(app.backend.getTextAt(new Point(13, 0), 1)).toBe("x");
    });

    it("широкие символы занимают две колонки", () => {
        const app = render(makeElement(["日本"], ["日本語"]), new Size(46, 4));

        expect(app.backend.getTextAt(new Point(9, 0), 2)).toBe("日");
        expect(app.backend.getTextAt(new Point(11, 0), 2)).toBe("本");
    });

    it("широкий символ у правого края заменяется пробелом, а не рвётся", () => {
        // Ширина подобрана так, что вторая половина символа не помещается.
        const app = render(makeElement(["日本"], ["日本"]), new Size(12, 3));

        expect(app.backend.getTextAt(new Point(9, 0), 2)).toBe("日");
        expect(app.backend.getTextAt(new Point(11, 0), 1)).toBe(" ");
    });
});

describe("DiffViewElement — горизонтальная прокрутка", () => {
    it("пока не реализована: scrollLeft всегда 0, длинные строки обрезаются", () => {
        const long = "x".repeat(200);
        const element = makeElement([long], [long]);
        const app = render(element, new Size(20, 3));

        expect(element.scrollLeft).toBe(0);
        // Виден только влезающий кусок — обрезка по правому краю, без переноса.
        expect(app.backend.getTextAt(new Point(9, 0), 11)).toBe("x".repeat(11));
    });
});

describe("DiffViewElement — токены без покрытия строки", () => {
    it("символы вне известных токенов рисуются базовым цветом", () => {
        const original = ["abc"];
        const modified = ["abd"];
        const source: IDiffRowSource = {
            getLine: (side, line) => (side === "original" ? original : modified)[line] ?? "",
            // Пустой список токенов: подсветке нечего сказать про эту строку.
            getLineTokens: () => createLineTokens([]),
            resolveTokenStyle: () => ({ ...EMPTY_RESOLVED_TOKEN_STYLE, fg: KEYWORD }),
        };
        const app = render(makeElement(original, modified, { source }));

        expect(app.backend.getFgAt(new Point(9, 0))).toBe(FG);
    });
});
