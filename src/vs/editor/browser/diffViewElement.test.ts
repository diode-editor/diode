import { describe, expect, it } from "vitest";

import { packRgb } from "../../../../tuidom/common/colorUtils.ts";
import { Point, Size } from "../../../../tuidom/common/geometryPromitives.ts";
import { TUIKeyboardEvent } from "../../../../tuidom/dom/events/tuiKeyboardEvent.ts";
import { TUIMouseEvent } from "../../../../tuidom/dom/events/tuiMouseEvent.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { DefaultLinesDiffComputer } from "../common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.ts";
import { DiffInnerRanges } from "../common/diff/diffInnerRanges.ts";
import { DiffViewModel } from "../common/diff/diffViewModel.ts";
import type { IDiffViewSides } from "../common/diff/diffViewText.ts";
import { createDiffViewState } from "../common/diff/diffViewText.ts";
import { buildSideBySideRows, createSideBySideViewStates } from "../common/diff/sideBySideRows.ts";
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

/** Источник без токенов — подсветка проверяется отдельным тестом. */
function plainSource(): IDiffRowSource {
    return {
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
    return buildElement(model.rows, original, modified, options.source ?? plainSource());
}

/** Полный вход `setDiff` из строк вью и текстов сторон — общий для тестов диффа. */
function diffInput(rows: DiffViewElement["rows"], sides: IDiffViewSides, source: IDiffRowSource) {
    const sideRows = buildSideBySideRows(rows);
    return {
        rows,
        sideRows,
        source,
        inlineViewState: createDiffViewState(rows, sides, 4),
        sideViewStates: createSideBySideViewStates(sideRows, sides, 4),
        labels: { original: "HEAD", modified: "file" },
        innerRanges: new DiffInnerRanges([]),
    };
}

/** Элемент со своим набором строк вью и синтетическим документом под ним. */
function buildElement(
    rows: DiffViewElement["rows"],
    original: string[],
    modified: string[],
    source: IDiffRowSource,
): DiffViewElement {
    const element = new DiffViewElement();
    element.setStyleVars(STYLE_VARS);
    element.style = { fg: FG, bg: BG };
    element.setDiff(diffInput(rows, { original, modified }, source));
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
        const element = buildElement(model.rows, original, modified, plainSource());

        expect(screenLines(render(element))).toContain("  ⋯ ⋯    ⋯ 1 unchanged line");
    });
});

describe("DiffViewElement — подсветка синтаксиса", () => {
    it("токены красятся резолвером стилей", () => {
        const original = ["const a = 1;"];
        const modified = ["const a = 2;"];
        const source: IDiffRowSource = {
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

    it("горизонтальное колесо прокрутку не трогает", () => {
        const { element } = mounted();

        wheel(element, "left");

        expect(element.scrollTop).toBe(0);
    });

    it("клавиши элемент не обрабатывает — навигация идёт командами", () => {
        // Каретка и скролл живут на командах курсора (`when: textViewFocus`),
        // а не на собственном обработчике: иначе клавиша сработала бы дважды —
        // диспетчер выполняет команду и съедает keypress (swallowNextKeyPress).
        const { element } = mounted(30, 5);

        for (const name of ["ArrowDown", "PageDown", "End", "Home", "a"]) {
            key(element, name);
        }

        expect(element.scrollTop).toBe(0);
        expect(element.viewState.selections[0].active).toEqual({ line: 0, character: 0 });
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
    it("scrollLeft сдвигает содержимое, гуттер остаётся на месте", () => {
        const line = "abcdefghijklmnopqrstuvwxyz";
        const element = makeElement([line], [line]);
        const app = render(element, new Size(20, 3));

        expect(app.backend.getTextAt(new Point(9, 0), 5)).toBe("abcde");

        element.viewState.scrollLeft = 4;
        app.render();

        expect(element.scrollLeft).toBe(4);
        expect(app.backend.getTextAt(new Point(9, 0), 5)).toBe("efghi");
        // Номер строки не уехал вместе с текстом.
        expect(app.backend.getTextAt(new Point(2, 0), 1)).toBe("1");
    });

    it("contentWidth считает самую длинную строку вместе с гуттером", () => {
        const element = makeElement(["short", "x".repeat(120)], ["short", "x".repeat(120)]);

        expect(element.contentWidth).toBe(element.gutterWidth + 120);
    });

    it("новый снимок пересчитывает contentWidth, а не берёт его от прошлого", () => {
        const element = makeElement(["x".repeat(120)], ["x".repeat(120)]);
        expect(element.contentWidth).toBe(element.gutterWidth + 120);

        const short = ["ab"];
        element.setDiff(
            diffInput(
                [{ kind: "unchanged", originalLine: 0, modifiedLine: 0 }],
                { original: short, modified: short },
                plainSource(),
            ),
        );

        expect(element.contentWidth).toBe(element.gutterWidth + 2);
    });
});

describe("DiffViewElement — токены без покрытия строки", () => {
    it("символы вне известных токенов рисуются базовым цветом", () => {
        const original = ["abc"];
        const modified = ["abd"];
        const source: IDiffRowSource = {
            // Пустой список токенов: подсветке нечего сказать про эту строку.
            getLineTokens: () => createLineTokens([]),
            resolveTokenStyle: () => ({ ...EMPTY_RESOLVED_TOKEN_STYLE, fg: KEYWORD }),
        };
        const app = render(makeElement(original, modified, { source }));

        expect(app.backend.getFgAt(new Point(9, 0))).toBe(FG);
    });
});
