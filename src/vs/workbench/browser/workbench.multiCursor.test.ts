import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import type { EditorElement } from "../../editor/browser/editorElement.ts";

/** `editorCursor.foreground` из Dark+ — фон блочной каретки в кадре. */
const CARET_BG = packRgb(0xae, 0xaf, 0xad);

describe("Workbench — мультикурсор с настоящей клавиатуры", () => {
    let ws: ITempWorkspace;

    function createTestContext(content: string): { h: IAppHarness; editor: EditorElement } {
        const filePath = ws.writeFile("test.ts", content);
        const h = createAppTestHarness({ openFile: filePath });
        h.workbench.focusEditor();
        const editor = h.testApp.querySelector("EditorElement") as EditorElement;
        return { h, editor };
    }

    function actives(editor: EditorElement): number[][] {
        return editor.viewState.selections.map((sel) => [sel.active.line, sel.active.character]);
    }

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-multi-cursor-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    it("Ctrl+Alt+ArrowDown добавляет каретку строкой ниже", () => {
        const { h, editor } = createTestContext("alpha\nbeta\ngamma");

        h.testApp.sendKey("Ctrl+Alt+ArrowDown");

        expect(actives(editor)).toEqual([
            [0, 0],
            [1, 0],
        ]);
    });

    it("Shift+Alt+ArrowDown — тот же результат (запасной бинд для legacy-терминалов)", () => {
        const { h, editor } = createTestContext("alpha\nbeta\ngamma");

        h.testApp.sendKey("Shift+Alt+ArrowDown");

        expect(editor.viewState.selections).toHaveLength(2);
    });

    it("Ctrl+Alt+ArrowUp с нижней каретки достраивает пачку вверх", () => {
        const { h, editor } = createTestContext("alpha\nbeta\ngamma");
        editor.viewState.goToPosition(2, 0);

        h.testApp.sendKey("Ctrl+Alt+ArrowUp");

        expect(actives(editor).map((pair) => pair[0])).toEqual([1, 2]);
    });

    it("печать вставляет символ во все каретки", () => {
        const { h, editor } = createTestContext("alpha\nbeta");

        h.testApp.sendKey("Ctrl+Alt+ArrowDown");
        h.testApp.sendKey("X");

        expect(editor.viewState.document.getText()).toBe("Xalpha\nXbeta");
    });

    it("Backspace удаляет во всех каретках", () => {
        const { h, editor } = createTestContext("alpha\nbeta");
        editor.viewState.goToPosition(0, 1);

        h.testApp.sendKey("Ctrl+Alt+ArrowDown");
        h.testApp.sendKey("Backspace");

        expect(editor.viewState.document.getText()).toBe("lpha\neta");
    });

    it("Escape снимает вторичные каретки", () => {
        const { h, editor } = createTestContext("alpha\nbeta");

        h.testApp.sendKey("Ctrl+Alt+ArrowDown");
        expect(editor.viewState.selections).toHaveLength(2);

        h.testApp.sendKey("Escape");
        expect(editor.viewState.selections).toHaveLength(1);
    });

    it("вторая каретка доходит до кадра, а не только до модели", () => {
        const { h, editor } = createTestContext("alpha\nbeta");

        h.testApp.sendKey("Ctrl+Alt+ArrowDown");
        h.testApp.render();

        const gw = editor.gutterWidth;
        const origin = editor.globalPosition;
        expect(h.testApp.backend.getBgAt(new Point(origin.x + gw, origin.y + 1))).toBe(CARET_BG);
    });

    it("статус-бар показывает счётчик выделений", () => {
        const { h } = createTestContext("alpha\nbeta");

        h.testApp.sendKey("Ctrl+Alt+ArrowDown");
        h.testApp.render();

        expect(h.testApp.backend.screenToString()).toContain("(2 selections)");
    });
});
