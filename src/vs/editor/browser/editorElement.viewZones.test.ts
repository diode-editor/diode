import { describe, expect, it } from "vitest";

import { Point, Size } from "@tuidom/all/common/geometryPromitives";
import { TUIMouseEvent } from "@tuidom/all/dom/events/tuiMouseEvent";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";
import { createFoldingRegion } from "../contrib/folding/iFoldingRegion.ts";
import type { IViewZone } from "../common/viewModel/iViewZone.ts";

import { EditorElement } from "./editorElement.ts";

/**
 * Рендер и hit-test view zones (docs/TODO/DiffEditable.md, PR-2): виртуальная
 * строка рисуется пустой (пустой гуттер без номера, пустой контент), клики по
 * ней падают на ближайшую документную строку, скролл и высота контента зоны
 * учитывают.
 */

function createEditor(
    text: string,
    zones: IViewZone[],
    width = 20,
    height = 8,
): { app: TestApp; editor: EditorElement } {
    const doc = new TextDocument(text);
    const viewState = new EditorViewState(doc);
    viewState.setViewZones(zones);
    const editor = new EditorElement(viewState);
    const app = TestApp.createWithContent(editor, new Size(width, height));
    return { app, editor };
}

function screenLines(app: TestApp): string[] {
    return app.backend
        .screenToString()
        .split("\n")
        .map((l) => l.replace(/\s+$/, ""));
}

function fireMouseDown(editor: EditorElement, localX: number, localY: number): void {
    editor.dispatchEvent(
        new TUIMouseEvent("mousedown", { button: "left", screenX: localX, screenY: localY, localX, localY }),
    );
}

describe("EditorElement view zones — рендер", () => {
    it("зона рисуется пустой строкой с пустым гуттером, номера строк не сдвигаются", () => {
        const { app } = createEditor("alpha\nbravo\ncharlie", [{ afterLine: 0, size: 2 }]);
        app.render();

        expect(screenLines(app).slice(0, 5)).toEqual([
            "  1   alpha", //
            "",
            "",
            "  2   bravo",
            "  3   charlie",
        ]);
    });

    it("зона перед первой строкой файла", () => {
        const { app } = createEditor("alpha\nbravo", [{ afterLine: -1, size: 1 }]);
        app.render();

        expect(screenLines(app).slice(0, 3)).toEqual([
            "", //
            "  1   alpha",
            "  2   bravo",
        ]);
    });

    it("contentHeight учитывает зоны — скролл доезжает до конца", () => {
        const { app, editor } = createEditor("a\nb\nc\nd", [{ afterLine: 1, size: 5 }]);
        app.render();

        expect(editor.contentHeight).toBe(9);
        editor.viewState.scrollTop = 5;
        app.render();
        // Вью: a b ····· c d; scrollTop 5 — экран начинается с хвоста зоны.
        const lines = screenLines(app);
        expect(lines[0]).toBe("");
        expect(lines[1]).toBe("");
        expect(lines[2]).toBe("  3   c");
        expect(lines[3]).toBe("  4   d");
    });

    it("зона и свёрнутый регион сосуществуют: пустая строка после заголовка", () => {
        const doc = new TextDocument("head\nbody1\nbody2\ntail");
        const viewState = new EditorViewState(doc);
        viewState.setFoldingRegions([createFoldingRegion(0, 2, true)]);
        viewState.setViewZones([{ afterLine: 1, size: 1 }]);
        const editor = new EditorElement(viewState);
        const app = TestApp.createWithContent(editor, new Size(20, 6));
        app.render();

        const lines = screenLines(app);
        expect(lines[0]).toContain("head");
        expect(lines[1]).toBe("");
        expect(lines[2]).toContain("tail");
    });

    it("indent guides не ломаются на зоне внутри региона", () => {
        const doc = new TextDocument("function f() {\n    a;\n    b;\n}");
        const viewState = new EditorViewState(doc);
        viewState.setFoldingRegions([createFoldingRegion(0, 3, false)]);
        viewState.setViewZones([{ afterLine: 1, size: 1 }]);
        const editor = new EditorElement(viewState);
        const app = TestApp.createWithContent(editor, new Size(24, 8));
        app.render();

        // Гайд рисуется на строках тела, строка-зона остаётся пустой.
        const lines = screenLines(app);
        expect(lines[2]).toBe("");
        expect(lines[1]).toContain("a;");
        expect(lines[3]).toContain("b;");
    });

    it("inspectState отдаёт зоны", () => {
        const { app, editor } = createEditor("a\nb", [{ afterLine: 0, size: 2 }]);
        app.render();

        expect(editor.inspectState().viewZones).toEqual([{ afterLine: 0, size: 2 }]);
    });
});

describe("EditorElement view zones — мышь", () => {
    it("клик по зоне ставит каретку на ближайшую документную строку", () => {
        const { app, editor } = createEditor("alpha\nbravo\ncharlie", [{ afterLine: 0, size: 2 }]);
        app.render();

        fireMouseDown(editor, editor.gutterWidth + 2, 1); // первая строка зоны
        expect(editor.viewState.selections[0].active.line).toBe(0);

        fireMouseDown(editor, editor.gutterWidth + 2, 3); // строка bravo
        expect(editor.viewState.selections[0].active.line).toBe(1);
    });

    it("протяжка через зону выделяет по документным строкам без разрывов", () => {
        const { app, editor } = createEditor("alpha\nbravo\ncharlie", [{ afterLine: 0, size: 2 }]);
        app.render();

        fireMouseDown(editor, editor.gutterWidth, 0);
        editor.dispatchEvent(
            new TUIMouseEvent("mousemove", {
                button: "left",
                screenX: editor.gutterWidth + 3,
                screenY: 3,
                localX: editor.gutterWidth + 3,
                localY: 3,
            }),
        );

        const selection = editor.viewState.selections[0];
        expect(selection.anchor).toEqual({ line: 0, character: 0 });
        expect(selection.active.line).toBe(1);
        expect(editor.viewState.getSelectedText()).toBe("alpha\nbra");
    });

    it("каретка после клика под зоной рисуется на своей строке вью", () => {
        const { app, editor } = createEditor("alpha\nbravo", [{ afterLine: 0, size: 1 }], 20, 6);
        app.render();
        editor.focus();

        fireMouseDown(editor, editor.gutterWidth, 2); // bravo (view 2)
        app.render();

        expect(app.backend.cursorPosition).toEqual(new Point(editor.gutterWidth, 2));
    });
});
