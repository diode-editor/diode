import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { createCursorSelection } from "../../editor/common/core/iSelection.ts";

/**
 * Перечитка файла с диска меняет текст в том же документе: редактор на экране
 * тот же — с фокусом, read-only и кареткой, — а не собран заново.
 */
describe("Workbench — перечитка с диска на месте", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-reload-in-place-", files: { "a.txt": "one\ntwo\nthree\n" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(100, 20) });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("фокус, read-only и каретка переживают перечитку; на экране новый текст", () => {
        h.workbench.openFile(ws.path("a.txt"));
        h.workbench.focusEditor();
        const editor = h.activeEditor();
        editor.viewState.readOnly = true;
        editor.viewState.selections = [createCursorSelection(1, 2)];
        const focused = h.testApp.focusedElement;
        expect(focused).not.toBeNull();

        ws.writeFile("a.txt", "uno\ndos\ntres\ncuatro\n");
        editor.revertToDisk();
        h.testApp.render();

        expect(h.testApp.backend.screenToString()).toContain("cuatro");
        expect(h.testApp.focusedElement).toBe(focused);
        expect(editor.viewState.readOnly).toBe(true);
        expect(editor.viewState.selections).toEqual([createCursorSelection(1, 2)]);
    });

    it("отступ пере-детектится по новому содержимому", () => {
        h.workbench.openFile(ws.path("a.txt"));
        const editor = h.activeEditor();

        ws.writeFile("a.txt", "if {\n\tbody\n\tmore\n}\n");
        editor.revertToDisk();

        expect(editor.viewState.insertSpaces).toBe(false);
    });
});
