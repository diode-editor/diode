import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import type { ICodeLensZone } from "../common/languages/iCodeLensSource.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

const LENS_FG = packRgb(1, 2, 3);
const ACTIVE_FG = packRgb(9, 8, 7);

/** "refs" and "run" are commands, " | " between them is not. */
function zone(line: number, text = "refs | run"): ICodeLensZone {
    return {
        line,
        text,
        actions: [
            { start: 0, end: 4, command: { id: "refs", title: "refs" } },
            { start: 7, end: 10, command: { id: "run", title: "run" } },
        ],
    };
}

function setup(text = "alpha\n  bravo\ncharlie", size = new Size(40, 6)) {
    const viewState = new EditorViewState(new TextDocument(text));
    const editor = new EditorElement(viewState);
    editor.occurrenceHighlightEnabled = false;
    editor.setStyleVars({ "editorCodeLens.foreground": LENS_FG, "editorLink.activeForeground": ACTIVE_FG });
    editor.setCodeLensZones([zone(1)]);
    const app = TestApp.createWithContent(editor, size);
    app.render();
    const gw = editor.gutterWidth;
    /** Mouse at an element cell (0-based; the token is 1-based). */
    const mouse = (action: MouseToken["action"], x: number, y: number, button: MouseToken["button"] = "none") => {
        app.backend.simulateMouse({
            kind: "mouse",
            button,
            action,
            x: x + 1,
            y: y + 1,
            shiftKey: false,
            altKey: false,
            ctrlKey: false,
            raw: "",
        });
    };
    const fgAt = (x: number, y: number): number | undefined => {
        app.render();
        return app.backend.getFgAt(new Point(x, y));
    };
    /** The cells of row `y` from `x0` (inclusive) to `x1` (exclusive) painted in the link color. */
    const activeCells = (y: number, x0 = gw, x1 = size.width): number[] => {
        app.render();
        const cells: number[] = [];
        for (let x = x0; x < x1; x++) if (app.backend.getFgAt(new Point(x, y)) === ACTIVE_FG) cells.push(x);
        return cells;
    };
    const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, i) => from + i);
    return { app, editor, viewState, gw, mouse, fgAt, activeCells, range };
}

describe("EditorElement — code lens hover", () => {
    it("the command under the pointer takes the link color and the hand; the other one does not", () => {
        // Row 1: "  refs | run" — refs at gw+2..gw+5, run at gw+9..gw+11.
        const { app, gw, mouse, fgAt, activeCells, range } = setup();
        expect(activeCells(1)).toEqual([]);
        expect(fgAt(gw + 2, 1)).toBe(LENS_FG);

        mouse("move", gw + 3, 1);
        expect(activeCells(1)).toEqual(range(gw + 2, gw + 6));
        expect(app.backend.pointerShape).toBe("pointer");

        mouse("move", gw + 11, 1);
        expect(activeCells(1)).toEqual(range(gw + 9, gw + 12));
        expect(app.backend.pointerShape).toBe("pointer");
    });

    it.each([
        { where: "the separator", dx: 7, y: 1 },
        { where: "the indent of the row", dx: 1, y: 1 },
        { where: "the empty part of the row", dx: 15, y: 1 },
        { where: "the line below", dx: 3, y: 2 },
        { where: "the line above", dx: 0, y: 0 },
    ])("$where: no color and the default pointer", ({ dx, y }) => {
        const { app, gw, mouse, activeCells } = setup();
        mouse("move", gw + 3, 1);
        mouse("move", gw + dx, y);
        expect(activeCells(1)).toEqual([]);
        expect(app.backend.pointerShape).toBe("default");
    });

    it("the gutter of the lens row is not a command, nor is the text scrolled under it", () => {
        const { app, viewState, gw, mouse, activeCells } = setup(`alpha\n  ${"x".repeat(100)}`);
        // Scrolled by 3, column 2 ("r" of refs) would sit under the last gutter cell.
        viewState.scrollLeft = 3;
        mouse("move", gw, 1);
        mouse("move", gw - 1, 1);
        expect(activeCells(1, 0)).toEqual([]);
        expect(app.backend.pointerShape).toBe("default");
    });

    it("leaving the element drops the color and the hand", () => {
        const { app, editor, gw, mouse, activeCells } = setup();
        mouse("move", gw + 3, 1);
        editor.dispatchEvent(
            new TUIMouseEvent("mouseleave", { button: "none", screenX: 0, screenY: 0, localX: 0, localY: 0 }),
        );
        expect(activeCells(1)).toEqual([]);
        expect(editor.pointerShape).toBeNull();
        expect(app.backend.pointerShape).toBe("pointer");
    });

    it("a wheel scroll under a still pointer finds what is under it now", () => {
        const lines = Array.from({ length: 30 }, (_, i) => `l${String(i)}`).join("\n");
        const { app, editor, gw, mouse, activeCells } = setup(lines);
        editor.setCodeLensZones([zone(1), zone(4)]);
        app.render();
        // Rows: l0 <lens> l1 l2 l3 <lens>.
        mouse("move", gw + 1, 1);
        expect(activeCells(1)).toEqual([gw, gw + 1, gw + 2, gw + 3]);
        // The other lens row has the same command at the same columns and stays unlit.
        expect(activeCells(5)).toEqual([]);

        // Down by 3: l2 l3 <lens> l4 ...: row 1 is l3.
        mouse("scroll-down", gw + 1, 1);
        expect(activeCells(1)).toEqual([]);
        expect(app.backend.pointerShape).toBe("default");

        // Up again: the lens is back under the pointer.
        mouse("scroll-up", gw + 1, 1);
        expect(activeCells(1)).toEqual([gw, gw + 1, gw + 2, gw + 3]);
        expect(app.backend.pointerShape).toBe("pointer");
    });

    it("new zones drop the hover of the old ones until the next move", () => {
        const { app, editor, gw, mouse, activeCells } = setup();
        mouse("move", gw + 3, 1);
        editor.setCodeLensZones([zone(1, "other | run")]);
        expect(activeCells(1)).toEqual([]);
        mouse("move", gw + 3, 1);
        expect(activeCells(1)).toEqual([gw + 2, gw + 3, gw + 4, gw + 5]);
        expect(app.backend.pointerShape).toBe("pointer");
    });

    it("folding the lens away drops the hover", () => {
        const { app, editor, viewState, gw, mouse, activeCells } = setup("a\n  b\n  c\nd");
        viewState.setFoldingRegions([{ startLine: 1, endLine: 2, isCollapsed: false }]);
        editor.setCodeLensZones([zone(2)]);
        app.render();
        // Rows: a, b, <lens>, c, d.
        mouse("move", gw + 3, 2);
        expect(activeCells(2)).toEqual([gw + 2, gw + 3, gw + 4, gw + 5]);
        viewState.toggleFold(1);
        app.render();
        // Rows: a, b, d — no lens row anywhere.
        expect([0, 1, 2, 3].flatMap((y) => activeCells(y))).toEqual([]);
        expect(editor.pointerShape).toBeNull();
    });

    it("horizontal scroll: the color lies on the cells a click runs", () => {
        const { app, editor, viewState, gw, mouse, activeCells } = setup(`alpha\n  ${"x".repeat(100)}`);
        const clicks = vi.fn();
        editor.onDidClickCodeLens(clicks);
        viewState.scrollLeft = 3;
        app.render();
        // "  refs | run" from column 3: "efs | run" — refs at gw..gw+2, run at gw+6..gw+8.
        mouse("move", gw, 1);
        expect(activeCells(1, 0)).toEqual([gw, gw + 1, gw + 2]);
        mouse("move", gw + 8, 1);
        expect(activeCells(1)).toEqual([gw + 6, gw + 7, gw + 8]);
        mouse("press", gw + 8, 1, "left");
        mouse("release", gw + 8, 1, "left");
        expect(clicks).toHaveBeenCalledWith({ id: "run", title: "run" });
    });

    it("a command cut by the right edge lights only its visible cells", () => {
        // Gutter 6 + 10 text columns: "  refs | r" is visible, "un" is cut.
        const { app, editor, gw, mouse, activeCells } = setup(`alpha\n  ${"x".repeat(100)}`, new Size(16, 6));
        expect(gw).toBe(6);
        expect(editor.viewState.viewportWidth).toBe(10);
        mouse("move", gw + 9, 1);
        expect(activeCells(1, 0, 16)).toEqual([gw + 9]);
        expect(app.backend.pointerShape).toBe("pointer");
    });

    it("wide characters in the title: the color covers both cells of each", () => {
        const { app, editor, gw, mouse, activeCells } = setup("alpha\nbravo");
        editor.setCodeLensZones([
            {
                line: 1,
                text: "你好 | ok",
                actions: [
                    { start: 0, end: 2, command: { id: "a", title: "你好" } },
                    { start: 5, end: 7, command: { id: "b", title: "ok" } },
                ],
            },
        ]);
        app.render();
        // "你好" takes 4 cells, " | " 3 more: ok at gw+7, gw+8.
        mouse("move", gw + 8, 1);
        expect(activeCells(1)).toEqual([gw + 7, gw + 8]);
        mouse("move", gw + 3, 1);
        expect(activeCells(1)).toEqual([gw, gw + 1, gw + 2, gw + 3]);
        expect(app.backend.pointerShape).toBe("pointer");
    });
});
