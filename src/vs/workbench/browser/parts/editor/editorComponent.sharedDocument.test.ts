import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { TextFileModel } from "../../../services/textfile/common/textFileModel.ts";
import type { ITextFileModelReference } from "../../../services/textfile/common/textFileModelRegistry.ts";
import { TextFileModelRegistry } from "../../../services/textfile/common/textFileModelRegistry.ts";

import { EditorComponent } from "./editorComponent.ts";
import { TextEditorPane } from "./textEditorPane.ts";

/** A second pair over the same model, built the same way a split does it (registry + reference). */
describe("EditorComponent: one document in two views", () => {
    let ws: ITempWorkspace;
    let undoRedo: UndoRedoService;
    let registry: TextFileModelRegistry;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-shared-doc-" });
        undoRedo = new UndoRedoService();
        registry = new TextFileModelRegistry((uri) => {
            const model = new TextFileModel(NULL_LANGUAGE_SERVICE, undoRedo, diskFileService());
            model.openFile(uri);
            return model;
        });
    });

    afterEach(() => {
        ws.dispose();
    });

    function createPane(ref: ITextFileModelReference): TextEditorPane {
        const component = new EditorComponent(new TokenizationRegistry(), NULL_TOKEN_STYLE_RESOLVER, ref.model);
        return new TextEditorPane(ref.model, component, ref);
    }

    function openTwice(name: string, content: string): { a: TextEditorPane; b: TextEditorPane } {
        const uri = Uri.file(ws.writeFile(name, content));
        const a = createPane(registry.acquire(uri));
        const b = createPane(registry.acquire(uri));
        return { a, b };
    }

    /** Types into a specific view the same way the keyboard does: mutator + push into the shared undo engine. */
    function typeIn(pane: TextEditorPane, text: string): void {
        pane.pushUndo(pane.viewState.type(text));
    }

    it("US-26: an edit in A is visible in B immediately, B's cursor does not jump", () => {
        const { a, b } = openTwice("shared.txt", "alpha\nbeta\ngamma");
        b.viewState.selections = [createCursorSelection(2, 3)];

        a.viewState.selections = [createCursorSelection(0, 5)];
        typeIn(a, "\ninserted");

        expect(a.getText()).toBe("alpha\ninserted\nbeta\ngamma");
        expect(b.getText()).toBe("alpha\ninserted\nbeta\ngamma");
        // B's cursor moved with its line (it was at gamma:3 → the line shifted down by 1).
        expect(b.viewState.selections[0].active).toEqual({ line: 3, character: 3 });
        expect(a.viewState.selections[0].active).toEqual({ line: 1, character: 8 });
    });

    it("US-27: undo from the other view reverts the edit, both views see the revert", () => {
        const { a, b } = openTwice("shared.txt", "hello");
        a.viewState.selections = [createCursorSelection(0, 5)];
        typeIn(a, " world");
        expect(b.getText()).toBe("hello world");

        b.undo();

        expect(a.getText()).toBe("hello");
        expect(b.getText()).toBe("hello");
        // The step's selection snapshot is restored into the acting view — B.
        expect(b.viewState.selections[0].active).toEqual({ line: 0, character: 5 });
    });

    it("one history per document: edit in A, edit in B, undo, undo (LIFO)", () => {
        const { a, b } = openTwice("shared.txt", "x");
        a.viewState.selections = [createCursorSelection(0, 1)];
        typeIn(a, "A");
        b.viewState.selections = [createCursorSelection(0, 2)];
        typeIn(b, "B");
        expect(a.getText()).toBe("xAB");

        a.undo();
        expect(a.getText()).toBe("xA");
        a.undo();
        expect(a.getText()).toBe("x");

        a.redo();
        a.redo();
        expect(b.getText()).toBe("xAB");
    });

    it("US-28: dirty marker and save are shared", async () => {
        const { a, b } = openTwice("shared.txt", "clean");
        expect(a.isModified).toBe(false);
        expect(b.isModified).toBe(false);

        typeIn(a, "dirty ");
        expect(a.isModified).toBe(true);
        expect(b.isModified).toBe(true);

        await b.save();
        expect(a.isModified).toBe(false);
        expect(b.isModified).toBe(false);
    });

    it("US-31: reload from disk rebuilds both views and keeps their scroll", () => {
        const lines = Array.from({ length: 100 }, (_, i) => `line-${i}`).join("\n");
        const { a, b } = openTwice("long.txt", lines);
        a.viewState.scrollTop = 40;
        b.viewState.scrollTop = 70;

        ws.writeFile("long.txt", `${lines}\nappended`);
        expect(a.revertToDisk()).toBe(true);

        expect(a.getText()).toContain("appended");
        expect(b.getText()).toContain("appended");
        expect(a.viewState.scrollTop).toBe(40);
        expect(b.viewState.scrollTop).toBe(70);
    });

    it("closing one view does not dispose the document; closing the last one does", () => {
        const { a, b } = openTwice("shared.txt", "text");
        const model = a.model;
        typeIn(a, "!");

        a.dispose();
        expect(b.getText()).toBe("!text");
        expect(b.isModified).toBe(true);

        const context = model.undoContext;
        expect(undoRedo.peekUndo(context)).toBeDefined();
        b.dispose();
        expect(undoRedo.peekUndo(context)).toBeUndefined();
    });

    it("folds of the second view shift with an edit in the first", () => {
        const { a, b } = openTwice("folds.txt", ["top", "if {", "  in1", "  in2", "}", "tail"].join("\n"));
        b.viewState.setFoldingRegions([{ startLine: 1, endLine: 4, isCollapsed: true }]);

        a.viewState.selections = [createCursorSelection(0, 3)];
        typeIn(a, "\nadded");

        const region = b.viewState.foldedRegions[0];
        expect(region.startLine).toBe(2);
        expect(region.endLine).toBe(5);
        expect(region.isCollapsed).toBe(true);
    });

    it("a closed view unsubscribes its TM token cache from the document that lives on", () => {
        const { a, b } = openTwice("leak.txt", "one\ntwo\nthree");
        const store = a.viewState.tokenStore;
        store?.forceTokenization(2);
        expect(store?.hasAccurateTokensForLine(0)).toBe(true);
        a.dispose();
        // An edit from the live view: the disposed cache no longer sees it.
        typeIn(b, "x");
        expect(store?.hasAccurateTokensForLine(0)).toBe(true);
        expect(b.viewState.tokenStore?.hasAccurateTokensForLine(0)).toBe(false);
        b.dispose();
    });
});
