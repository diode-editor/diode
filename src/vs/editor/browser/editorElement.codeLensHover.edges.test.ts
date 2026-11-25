import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
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
function zone(line: number): ICodeLensZone {
    return {
        line,
        text: "refs | run",
        actions: [
            { start: 0, end: 4, command: { id: "refs", title: "refs" } },
            { start: 7, end: 10, command: { id: "run", title: "run" } },
        ],
    };
}

function setup(text: string, zones: ICodeLensZone[], size = new Size(40, 8)) {
    const viewState = new EditorViewState(new TextDocument(text));
    const editor = new EditorElement(viewState);
    editor.occurrenceHighlightEnabled = false;
    editor.setStyleVars({ "editorCodeLens.foreground": LENS_FG, "editorLink.activeForeground": ACTIVE_FG });
    editor.setCodeLensZones(zones);
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
    /** Cells of row `y` painted in the link color. */
    const activeCells = (y: number): number[] => {
        app.render();
        const cells: number[] = [];
        for (let x = 0; x < size.width; x++) if (app.backend.getFgAt(new Point(x, y)) === ACTIVE_FG) cells.push(x);
        return cells;
    };
    const litAnywhere = (): number[] => Array.from({ length: size.height }, (_, y) => activeCells(y)).flat();
    return { app, editor, viewState, gw, mouse, activeCells, litAnywhere };
}

describe("EditorElement — code lens hover, edges", () => {
    it("a tab-indented line: the lit cells are the cells a click runs", () => {
        const { app, editor, gw, mouse, activeCells } = setup("alpha\n\t\tbravo", [zone(1)]);
        const clicks = vi.fn();
        editor.onDidClickCodeLens(clicks);
        // Two tabs of 4: "refs" at gw+8..gw+11.
        mouse("move", gw + 9, 1);
        expect(activeCells(1)).toEqual([gw + 8, gw + 9, gw + 10, gw + 11]);
        expect(app.backend.pointerShape).toBe("pointer");
        mouse("press", gw + 8, 1, "left");
        mouse("release", gw + 8, 1, "left");
        expect(clicks).toHaveBeenCalledWith({ id: "refs", title: "refs" });
        // A cell of the tab indent is not the command.
        mouse("move", gw + 7, 1);
        expect(activeCells(1)).toEqual([]);
        expect(app.backend.pointerShape).toBe("default");
    });

    it("the lenses go away under a still pointer: no color and no hand left", () => {
        const { app, editor, gw, mouse, litAnywhere } = setup("alpha\nbravo\ncharlie", [zone(1)]);
        mouse("move", gw + 1, 1);
        expect(app.backend.pointerShape).toBe("pointer");
        editor.setCodeLensZones([]);
        app.render();
        expect(litAnywhere()).toEqual([]);
        expect(editor.pointerShape).toBeNull();
    });

    it("the lens moves one line down under a still pointer (edit above): the moved lens is not lit", () => {
        const { app, editor, gw, mouse, litAnywhere } = setup("alpha\nbravo\ncharlie", [zone(1)]);
        mouse("move", gw + 1, 1);
        editor.setCodeLensZones([zone(2)]);
        app.render();
        // Rows: alpha, bravo, <lens>, charlie — row 1 is text now.
        expect(litAnywhere()).toEqual([]);
        expect(editor.pointerShape).toBeNull();
    });

    it("a keyboard scroll under a still pointer does not keep the color on a lens the pointer left", () => {
        const lines = Array.from({ length: 30 }, (_, i) => `l${String(i)}`).join("\n");
        const { app, editor, viewState, gw, mouse, activeCells } = setup(lines, [zone(1)]);
        // Rows: l0 <lens> l1 ...
        mouse("move", gw + 1, 1);
        expect(activeCells(1)).toEqual([gw, gw + 1, gw + 2, gw + 3]);
        // Scrolled by one line without the mouse: row 0 is the lens, row 1 (under the pointer) is l1.
        viewState.scrollTop = 1;
        app.render();
        expect(activeCells(0)).toEqual([]);
        expect(editor.pointerShape).not.toBe("pointer");
    });

    it("after hovering one command, a click on the other runs the other", () => {
        const { editor, gw, mouse } = setup("alpha\nbravo", [zone(1)]);
        const clicks = vi.fn();
        editor.onDidClickCodeLens(clicks);
        mouse("move", gw + 1, 1);
        mouse("move", gw + 8, 1);
        mouse("press", gw + 8, 1, "left");
        mouse("release", gw + 8, 1, "left");
        expect(clicks).toHaveBeenCalledTimes(1);
        expect(clicks).toHaveBeenCalledWith({ id: "run", title: "run" });
    });
});
