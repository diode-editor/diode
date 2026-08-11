import { describe, expect, it } from "vitest";

import { packRgb } from "../../../../tuidom/common/colorUtils.ts";
import { Point, Size } from "../../../../tuidom/common/geometryPromitives.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { DiffInnerRanges } from "../common/diff/diffInnerRanges.ts";
import type { IDiffViewRow } from "../common/diff/diffViewModel.ts";
import { createDiffViewState } from "../common/diff/diffViewText.ts";
import { buildSideBySideRows, createSideBySideViewStates } from "../common/diff/sideBySideRows.ts";
import { EMPTY_RESOLVED_TOKEN_STYLE } from "../common/languages/iTokenStyleResolver.ts";

import type { IDiffRowSource } from "./diffViewElement.ts";
import { DiffViewElement } from "./diffViewElement.ts";
import { SELECTION_BG } from "./textViewRendering.ts";

const ADDED_BG = packRgb(0x37, 0x3d, 0x29);
const REMOVED_BG = packRgb(0x4b, 0x18, 0x18);
const BG = packRgb(0x1e, 0x1e, 0x1e);
const FG = packRgb(0xcc, 0xcc, 0xcc);

const STYLE_VARS = {
    "editorGutter.background": BG,
    "editorLineNumber.foreground": packRgb(0x85, 0x85, 0x85),
    "diffEditor.insertedLineBackground": ADDED_BG,
    "diffEditor.removedLineBackground": REMOVED_BG,
    "diffEditor.unchangedRegionForeground": packRgb(0x8c, 0x8c, 0x8c),
};

const NO_TOKENS: IDiffRowSource = {
    getLineTokens: () => undefined,
    resolveTokenStyle: () => EMPTY_RESOLVED_TOKEN_STYLE,
};

/**
 * Дифф из четырёх строк вью:
 *   0 unchanged  "keep"
 *   1 deleted    "old line"
 *   2 added      "new line"
 *   3 collapsed  «⋯ 9 unchanged lines»
 */
const ROWS: IDiffViewRow[] = [
    { kind: "unchanged", originalLine: 0, modifiedLine: 0 },
    { kind: "deleted", originalLine: 1 },
    { kind: "added", modifiedLine: 1 },
    { kind: "collapsed", hiddenLineCount: 9, regionIndex: 0 },
];
const SIDES = {
    original: ["keep", "old line"],
    modified: ["keep", "new line"],
};

function createElement(
    rows: IDiffViewRow[] = ROWS,
    sides = SIDES,
    size = new Size(40, 6),
): { element: DiffViewElement; app: TestApp } {
    const element = new DiffViewElement();
    element.setStyleVars(STYLE_VARS);
    element.style = { fg: FG, bg: BG };
    const sideRows = buildSideBySideRows(rows);
    element.setDiff({
        rows,
        sideRows,
        source: NO_TOKENS,
        inlineViewState: createDiffViewState(rows, sides, 4),
        sideViewStates: createSideBySideViewStates(sideRows, sides, 4),
        labels: { original: "HEAD", modified: "file" },
        innerRanges: new DiffInnerRanges([]),
        identical: false,
    });
    const app = TestApp.createWithContent(element, size);
    app.render();
    return { element, app };
}

/** Выделение от (line, character) до (line, character). */
function select(element: DiffViewElement, from: [number, number], to: [number, number]): void {
    element.viewState.selections = [
        {
            anchor: { line: from[0], character: from[1] },
            active: { line: to[0], character: to[1] },
        },
    ];
}

describe("DiffViewElement — каретка", () => {
    it("аппаратный курсор стоит там, где каретка, — но только под фокусом", () => {
        const { element, app } = createElement();
        select(element, [2, 4], [2, 4]);

        app.render();
        expect(app.backend.cursorPosition).toBeNull();

        element.focus();
        app.render();

        expect(app.backend.cursorPosition).toEqual(new Point(element.gutterWidth + 4, 2));
    });

    it("каретка за пределами вьюпорта курсор не ставит", () => {
        const { element, app } = createElement(ROWS, SIDES, new Size(40, 2));
        element.focus();
        select(element, [3, 0], [3, 0]);

        app.render();

        expect(app.backend.cursorPosition).toBeNull();
    });

    it("render проставляет размеры вьюпорта — иначе страницы считались бы по 80×24", () => {
        const { element } = createElement(ROWS, SIDES, new Size(40, 6));

        expect(element.viewState.viewportHeight).toBe(6);
        expect(element.viewState.viewportWidth).toBe(40 - element.gutterWidth);
    });
});

describe("DiffViewElement — подсветка выделения", () => {
    const bgAt = (app: TestApp, x: number, y: number) => app.backend.getBgAt(new Point(x, y));

    it("выделение перекрывает фон добавленной строки", () => {
        const { element, app } = createElement();
        const gw = element.gutterWidth;
        // Вся строка 2 ("new line") целиком.
        select(element, [2, 0], [2, 8]);
        app.render();

        expect(bgAt(app, gw, 2)).toBe(SELECTION_BG);
        // За концом выделения — снова фон добавленной строки.
        expect(bgAt(app, gw + 8, 2)).toBe(ADDED_BG);
        // Гуттер не красится: выделяется текст, а не номера строк.
        expect(bgAt(app, 0, 2)).toBe(ADDED_BG);
    });

    it("схлопнутое выделение (просто каретка) фон не красит", () => {
        const { element, app } = createElement();
        const gw = element.gutterWidth;
        select(element, [2, 3], [2, 3]);
        app.render();

        expect(bgAt(app, gw + 3, 2)).toBe(ADDED_BG);
    });

    it("глиф под выделением остаётся на месте", () => {
        const { element, app } = createElement();
        const gw = element.gutterWidth;
        select(element, [0, 0], [0, 4]);
        app.render();

        expect(app.backend.getTextAt(new Point(gw, 0), 4)).toBe("keep");
        expect(app.backend.getFgAt(new Point(gw, 0))).toBe(FG);
    });
});

describe("DiffViewElement — текст выделения", () => {
    it("без выделения отдаёт пустую строку", () => {
        const { element } = createElement();

        expect(element.getSelectedText()).toBe("");
    });

    it("кусок одной строки режется по колонкам", () => {
        const { element } = createElement();
        select(element, [2, 4], [2, 8]);

        expect(element.getSelectedText()).toBe("line");
    });

    it("выделение через границу -/+ отдаёт обе строки без гуттера", () => {
        const { element } = createElement();
        select(element, [1, 0], [2, 8]);

        // Ни номеров строк, ни маркеров `-`/`+` — они в гуттере, а не в тексте.
        expect(element.getSelectedText()).toBe("old line\nnew line");
    });

    it("строка-плейсхолдер выпадает целиком, без лишнего перевода строки", () => {
        const { element } = createElement();
        // Со строки 2 («new line») через плейсхолдер на строке 3 до его конца.
        select(element, [2, 0], [3, 19]);

        expect(element.getSelectedText()).toBe("new line");
    });

    it("выделение только по плейсхолдеру не даёт ничего", () => {
        const { element } = createElement();
        select(element, [3, 0], [3, 19]);

        expect(element.getSelectedText()).toBe("");
    });

    it("выделение снизу вверх нормализуется", () => {
        const { element } = createElement();
        select(element, [2, 8], [1, 0]);

        expect(element.getSelectedText()).toBe("old line\nnew line");
    });
});

describe("DiffViewElement — inspectState", () => {
    it("отдаёт read-only, размер, скролл и выделение", () => {
        const { element } = createElement();
        select(element, [1, 0], [2, 3]);

        expect(element.inspectState()).toEqual({
            readOnly: true,
            mode: "inline",
            activeSide: "modified",
            identical: false,
            rowCount: 4,
            sideRowCount: 3,
            scrollTop: 0,
            scrollLeft: 0,
            hasSelection: true,
            selections: [
                {
                    anchor: { line: 1, character: 0 },
                    active: { line: 2, character: 3 },
                    collapsed: false,
                },
            ],
        });
    });

    it("схлопнутая каретка — hasSelection false", () => {
        const { element } = createElement();

        expect(element.inspectState()).toMatchObject({ hasSelection: false });
    });
});
