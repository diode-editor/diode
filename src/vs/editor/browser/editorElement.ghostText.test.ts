import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import type { IGhostText } from "../common/model/iGhostText.ts";
import { ghostTextEquals } from "../common/model/iGhostText.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

/**
 * Призрачные подсказки (ghost text): хвост первой строки — на строке каретки,
 * остальные строки — view zones под ней; всё серым цветом
 * `editorGhostText.foreground`, документа не трогает.
 */

const GHOST_FG = packRgb(0x6a, 0x6a, 0x6a);
const EDITOR_FG = packRgb(0xd4, 0xd4, 0xd4);
const BG = packRgb(0x1e, 0x1e, 0x1e);

const STYLE_VARS = {
    "editor.background": BG,
    "editor.foreground": EDITOR_FG,
    "editorGhostText.foreground": GHOST_FG,
};

/** Стиль как у EditorComponent.applyEditorStyle — фон/цвет редактора настоящие. */
function styleEditor(editor: EditorElement): void {
    editor.setStyleVars(STYLE_VARS);
    editor.style = { fg: "editor.foreground", bg: "editor.background" };
}

function createEditor(
    text: string,
    ghost: IGhostText | null,
    size = new Size(24, 6),
): { app: TestApp; editor: EditorElement } {
    const viewState = new EditorViewState(new TextDocument(text));
    const editor = new EditorElement(viewState);
    styleEditor(editor);
    editor.setGhostText(ghost);
    const app = TestApp.createWithContent(editor, size);
    app.render();
    return { app, editor };
}

describe("EditorElement — ghost text", () => {
    it("хвост первой строки рисуется серым после конца текста, документ не тронут", () => {
        const { app, editor } = createEditor("const x = 1", {
            line: 0,
            character: 11,
            lines: [" + 2;"],
        });

        const gutterW = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gutterW, 0), 16)).toBe("const x = 1 + 2;");
        expect(app.backend.getFgAt(new Point(gutterW + 12, 0))).toBe(GHOST_FG);
        // Настоящий текст остался в цвете редактора, а не в призрачном.
        expect(app.backend.getFgAt(new Point(gutterW, 0))).not.toBe(GHOST_FG);
        expect(editor.viewState.document.getText()).toBe("const x = 1");
    });

    it("многострочная подсказка: строки-зоны под кареткой, документные строки съезжают вниз", () => {
        const { app, editor } = createEditor("alpha\nbravo", {
            line: 0,
            character: 5,
            lines: [" one", "two()", "three"],
        });

        const gutterW = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gutterW, 0), 9)).toBe("alpha one");
        expect(app.backend.getTextAt(new Point(gutterW, 1), 5)).toBe("two()");
        expect(app.backend.getFgAt(new Point(gutterW, 1))).toBe(GHOST_FG);
        expect(app.backend.getTextAt(new Point(gutterW, 2), 5)).toBe("three");
        // Гуттер зоны пуст — номер строки не тратится.
        expect(app.backend.getTextAt(new Point(0, 1), gutterW)).toBe(" ".repeat(gutterW));
        // Хвост zone-строки за текстом залит фоном редактора (не мусором грида).
        const contentCols = 24 - gutterW;
        expect(app.backend.getTextAt(new Point(gutterW + 5, 1), contentCols - 5)).toBe(" ".repeat(contentCols - 5));
        expect(app.backend.getBgAt(new Point(gutterW + 10, 1))).toBe(BG);
        expect(app.backend.getBgAt(new Point(gutterW + contentCols - 1, 2))).toBe(BG);
        // bravo уехал под зону — и хвост подсказки НЕ дорисован на его строке.
        expect(app.backend.getTextAt(new Point(gutterW, 3), 9)).toBe("bravo    ");
    });

    it("соседние строки документа фантом не красит", () => {
        // Фантом адресован строке каретки: на других строках их собственный
        // текст в тех же колонках обязан остаться текстом редактора.
        const { app, editor } = createEditor("alpha\nbravo-charlie", {
            line: 0,
            character: 5,
            lines: ["-ghost"],
        });

        const gutterW = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gutterW, 0), 11)).toBe("alpha-ghost");
        expect(app.backend.getTextAt(new Point(gutterW, 1), 13)).toBe("bravo-charlie");
        expect(app.backend.getFgAt(new Point(gutterW + 5, 1))).toBe(EDITOR_FG);
        expect(app.backend.getFgAt(new Point(gutterW + 8, 1))).toBe(EDITOR_FG);
    });

    it("строки-зоны: таб, широкие символы и обрезка по правому краю", () => {
        const contentCols = 24 - 6; // gutterWidth однозначной нумерации = 6
        const { app, editor } = createEditor("alpha", {
            line: 0,
            character: 5,
            lines: [
                "-",
                "x\t你ok", // таб добивает до границы tabSize, широкий символ — свои 2 колонки
                "a".repeat(contentCols - 1) + "你", // широкий символ не влезает у края
                "b".repeat(contentCols + 5), // длиннее контентной области — обрезка
            ],
        });

        const gutterW = editor.gutterWidth;
        expect(gutterW).toBe(6);
        // Таб: «x» на колонке 0, дальше пробелы до колонки 4, затем «你ok».
        expect(app.backend.getTextAt(new Point(gutterW, 1), 8)).toBe("x   你ok");
        // Широкий символ у правого края целиком не влезает → пробел вместо него.
        const wideRow = app.backend.getTextAt(new Point(gutterW, 2), contentCols);
        expect(wideRow).toBe("a".repeat(contentCols - 1) + " ");
        // Обрезка: ровно contentCols колонок, ничего не вылезло за край.
        expect(app.backend.getTextAt(new Point(gutterW, 3), contentCols)).toBe("b".repeat(contentCols));
    });

    it("чужие зоны переживают однострочную подсказку (свои зоны не трогаются)", () => {
        const viewState = new EditorViewState(new TextDocument("alpha\nbravo"));
        viewState.setViewZones([{ afterLine: 1, size: 1 }]); // зона владельца вью
        const editor = new EditorElement(viewState);
        editor.setStyleVars(STYLE_VARS);

        editor.setGhostText({ line: 0, character: 5, lines: ["-tail"] });
        expect(viewState.viewZones).toEqual([{ afterLine: 1, size: 1 }]);

        editor.setGhostText(null);
        expect(viewState.viewZones).toEqual([{ afterLine: 1, size: 1 }]);
    });

    it("колонка подсказки за концом строки — защитный кламп в конец (устаревший ghost)", () => {
        // Строка успела укоротиться под показанной подсказкой: колонки 5 в ней
        // уже нет. Фантом встаёт в конец строки, а не в воздух.
        const { app, editor } = createEditor("ab", { line: 0, character: 5, lines: ["ZZ"] });

        const gutterW = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gutterW, 0), 6)).toBe("abZZ  ");
        // Именно фантомные колонки, а не текст цветом редактора.
        expect(app.backend.getFgAt(new Point(gutterW + 2, 0))).toBe(GHOST_FG);
    });

    it("строки подсказки в документе нет — кадр рисуется без неё и без падения", () => {
        // Строка исчезла под показанной подсказкой (или её поставили мимо):
        // адресовать фантом не к чему — кадр просто рисует документ. Строка
        // ровно за последней (номер == lineCount) — тоже мимо: нумерация с нуля.
        for (const line of [-1, 1, 5]) {
            const { app, editor } = createEditor("ab", { line, character: 0, lines: ["ZZ"] });
            expect(app.backend.getTextAt(new Point(editor.gutterWidth, 0), 4)).toBe("ab  ");
        }
    });

    it("каретка в середине строки — хвост строки уезжает вправо (см. ghostTextMidLine)", () => {
        const { app, editor } = createEditor("ab", { line: 0, character: 1, lines: ["ZZ"] });

        const gutterW = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gutterW, 0), 4)).toBe("aZZb");
    });

    it("word wrap: хвост подсказки рисуется на последнем фрагменте с учётом его начала", () => {
        const text = "a".repeat(15); // шире контентной области → перенос
        const viewState = new EditorViewState(new TextDocument(text));
        viewState.wordWrap = "on";
        const editor = new EditorElement(viewState);
        styleEditor(editor);
        editor.setGhostText({ line: 0, character: 15, lines: ["GH"] });
        const app = TestApp.createWithContent(editor, new Size(16, 4));
        app.render();

        const gutterW = editor.gutterWidth; // 6 → contentCols = 10
        // 15 «a» → фрагменты [0..10) и [10..15); хвост на втором ряду с
        // колонки 15 - fragStartCol(10) = 5 — старт фрагмента учтён.
        expect(app.backend.getTextAt(new Point(gutterW, 0), 10)).toBe("a".repeat(10));
        expect(app.backend.getTextAt(new Point(gutterW, 1), 8)).toBe("aaaaaGH ");
        expect(app.backend.getFgAt(new Point(gutterW + 5, 1))).toBe(GHOST_FG);
    });

    it("снятие подсказки убирает и хвост, и зоны", () => {
        const { app, editor } = createEditor("alpha\nbravo", {
            line: 0,
            character: 5,
            lines: [" one", "two()"],
        });
        editor.setGhostText(null);
        app.render();

        const gutterW = editor.gutterWidth;
        expect(app.backend.getTextAt(new Point(gutterW, 0), 9)).toBe("alpha    ");
        expect(app.backend.getTextAt(new Point(gutterW, 1), 5)).toBe("bravo");
        expect(editor.viewState.viewZones).toEqual([]);
    });

    it("однострочная подсказка зон не заводит и не сбрасывает чужие настройки зон", () => {
        const viewState = new EditorViewState(new TextDocument("alpha"));
        let viewChanges = 0;
        viewState.onDidChangeView(() => {
            viewChanges++;
        });
        const editor = new EditorElement(viewState);
        editor.setStyleVars(STYLE_VARS);

        editor.setGhostText({ line: 0, character: 5, lines: ["-tail"] });
        expect(viewState.viewZones).toEqual([]);
        expect(viewChanges).toBe(0);

        editor.setGhostText(null);
        expect(viewChanges).toBe(0);
    });

    it("повторная установка равной подсказки — no-op", () => {
        const { editor } = createEditor("alpha", null);
        const ghost: IGhostText = { line: 0, character: 5, lines: ["-x", "y"] };
        editor.setGhostText(ghost);

        let viewChanges = 0;
        editor.viewState.onDidChangeView(() => {
            viewChanges++;
        });
        editor.setGhostText({ line: 0, character: 5, lines: ["-x", "y"] });
        expect(viewChanges).toBe(0);
        expect(editor.ghostText).toBe(ghost);
    });

    it("хвост клипается по правому краю контентной области", () => {
        const { app, editor } = createEditor("ab", {
            line: 0,
            character: 2,
            lines: ["-очень-длинный-призрачный-хвост"],
        });

        const gutterW = editor.gutterWidth;
        const contentCols = 24 - gutterW;
        const row = app.backend.getTextAt(new Point(gutterW, 0), contentCols);
        // Полное равенство до последней колонки: обрезка не превращает
        // обычные символы в пробелы (это судьба только широких у края).
        expect(row).toBe("ab-очень-длинный-призрачный-хвост".slice(0, contentCols));
        // Ничего не вылезло за границу элемента (ширина приложения = 24).
        expect(row.length).toBe(contentCols);
    });

    it("широкие символы и табы в подсказке занимают свои колонки", () => {
        const { app, editor } = createEditor("x", {
            line: 0,
            character: 1,
            lines: ["你\tok"],
        });

        const gutterW = editor.gutterWidth;
        // «你» — 2 колонки, таб добит пробелами до своей ширины, дальше "ok".
        // Ширина таба считается по ЭКРАННОЙ колонке: фантом вклеен в строку, и
        // DisplayLine строится от композитного текста «x你\tok».
        expect(app.backend.getTextAt(new Point(gutterW + 1, 0), 1)).toBe("你");
        const tabWidth = 4 - (3 % 4); // таб на колонке 3 строки → до границы 4
        // Ячейки таба — пробелы (не литеральный "\t").
        expect(app.backend.getTextAt(new Point(gutterW + 1 + 2, 0), tabWidth)).toBe(" ".repeat(tabWidth));
        expect(app.backend.getTextAt(new Point(gutterW + 1 + 2 + tabWidth, 0), 2)).toBe("ok");
        expect(app.backend.getFgAt(new Point(gutterW + 1 + 2 + tabWidth, 0))).toBe(GHOST_FG);
    });

    it("горизонтальный скролл: колонки подсказки левее вьюпорта пропускаются", () => {
        // Строка каретки длиннее вьюпорта; скролл вправо уводит начало
        // подсказки за левый край — видим только её хвост.
        const viewState = new EditorViewState(new TextDocument("0123456789abcdefghij"));
        const editor = new EditorElement(viewState);
        editor.setStyleVars(STYLE_VARS);
        editor.setGhostText({ line: 0, character: 20, lines: ["GHOST-TAIL"] });
        viewState.scrollLeft = 24; // старт подсказки (кол. 20) левее вьюпорта
        const app = TestApp.createWithContent(editor, new Size(16, 3));
        app.render();

        const gutterW = editor.gutterWidth;
        // Первые 4 колонки подсказки отрезаны скроллом: видно "T-TAIL".
        expect(app.backend.getTextAt(new Point(gutterW, 0), 6)).toBe("T-TAIL");
        expect(app.backend.getFgAt(new Point(gutterW, 0))).toBe(GHOST_FG);
    });

    it("широкий символ подсказки, не влезающий у правого края, рисуется пробелом", () => {
        const { app, editor } = createEditor("x", {
            line: 0,
            character: 1,
            lines: ["a".repeat(16) + "你hidden"],
        });

        const gutterW = editor.gutterWidth; // 6 → contentCols = 18
        const contentCols = 24 - gutterW;
        // «你» ложится на последнюю колонку (screenX 17): целиком не влезает → пробел.
        const row = app.backend.getTextAt(new Point(gutterW, 0), contentCols);
        expect(row.includes("你")).toBe(false);
        expect(row.startsWith("x" + "a".repeat(16))).toBe(true);
    });

    it("inspectState отдаёт подсказку для e2e-ассертов", () => {
        const { editor } = createEditor("alpha", { line: 0, character: 5, lines: ["-x", "y"] });
        expect(editor.inspectState().ghostText).toEqual({ line: 0, character: 5, lines: ["-x", "y"] });

        editor.setGhostText(null);
        expect(editor.inspectState().ghostText).toBeNull();
    });
});

describe("ghostTextEquals", () => {
    it("сравнивает по значению, null — только с null", () => {
        const a: IGhostText = { line: 1, character: 2, lines: ["x", "y"] };
        expect(ghostTextEquals(a, { line: 1, character: 2, lines: ["x", "y"] })).toBe(true);
        expect(ghostTextEquals(a, { line: 1, character: 2, lines: ["x"] })).toBe(false);
        // И в обратную сторону: b длиннее при общем префиксе — every() этого
        // не увидит, разницу обязана ловить проверка длин.
        expect(ghostTextEquals({ line: 1, character: 2, lines: ["x"] }, a)).toBe(false);
        expect(ghostTextEquals(a, { line: 1, character: 2, lines: ["x", "z"] })).toBe(false);
        expect(ghostTextEquals(a, { line: 1, character: 3, lines: ["x", "y"] })).toBe(false);
        expect(ghostTextEquals(a, { line: 2, character: 2, lines: ["x", "y"] })).toBe(false);
        expect(ghostTextEquals(a, null)).toBe(false);
        expect(ghostTextEquals(null, a)).toBe(false);
        expect(ghostTextEquals(null, null)).toBe(true);
    });
});
