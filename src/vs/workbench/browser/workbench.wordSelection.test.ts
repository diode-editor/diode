import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import type { EditorElement } from "../../editor/browser/editorElement.ts";

describe("Workbench word selection (Ctrl+Shift+Arrow/Home/End)", () => {
    let ws: ITempWorkspace;

    function createTestContext(content: string): { h: IAppHarness; editor: EditorElement } {
        const filePath = ws.writeFile("test.ts", content);

        const h = createAppTestHarness({ openFile: filePath });
        h.workbench.focusEditor();

        const editor = h.testApp.querySelector("EditorElement") as EditorElement;
        return { h, editor };
    }

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-word-sel-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    // ─── Ctrl+Shift+ArrowRight ──────────────────────────────

    it("Ctrl+Shift+ArrowRight selects first word from start", () => {
        const { h, editor } = createTestContext("hello world");

        h.testApp.sendKey("Ctrl+Shift+ArrowRight");

        expect(editor.viewState.selections[0].anchor).toEqual({ line: 0, character: 0 });
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 6 });
    });

    it("Ctrl+Shift+ArrowRight twice selects both words", () => {
        const { h, editor } = createTestContext("hello world");

        h.testApp.sendKey("Ctrl+Shift+ArrowRight");
        h.testApp.sendKey("Ctrl+Shift+ArrowRight");

        expect(editor.viewState.selections[0].anchor).toEqual({ line: 0, character: 0 });
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 11 });
    });

    // ─── Ctrl+Shift+ArrowLeft ───────────────────────────────

    it("Ctrl+Shift+ArrowLeft selects last word from end", () => {
        const { h, editor } = createTestContext("hello world");

        h.testApp.sendKey("End");
        h.testApp.sendKey("Ctrl+Shift+ArrowLeft");

        expect(editor.viewState.selections[0].anchor).toEqual({ line: 0, character: 11 });
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 6 });
    });

    it("Ctrl+Shift+ArrowLeft twice selects both words from end", () => {
        const { h, editor } = createTestContext("hello world");

        h.testApp.sendKey("End");
        h.testApp.sendKey("Ctrl+Shift+ArrowLeft");
        h.testApp.sendKey("Ctrl+Shift+ArrowLeft");

        expect(editor.viewState.selections[0].anchor).toEqual({ line: 0, character: 11 });
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    // ─── Ctrl+Shift+Home ────────────────────────────────────

    it("Ctrl+Shift+Home selects from cursor to document start", () => {
        const { h, editor } = createTestContext("hello\nworld");

        h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("End");
        h.testApp.sendKey("Ctrl+Shift+Home");

        expect(editor.viewState.selections[0].anchor).toEqual({ line: 1, character: 5 });
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    // ─── Ctrl+Shift+End ─────────────────────────────────────

    it("Ctrl+Shift+End selects from cursor to document end", () => {
        const { h, editor } = createTestContext("hello\nworld");

        h.testApp.sendKey("Ctrl+Shift+End");

        expect(editor.viewState.selections[0].anchor).toEqual({ line: 0, character: 0 });
        expect(editor.viewState.selections[0].active).toEqual({ line: 1, character: 5 });
    });
});
