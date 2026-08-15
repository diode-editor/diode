import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

/**
 * Два редактора на один документ (сплит-вью): создаём вторую пару поверх той же
 * модели руками — тем же путём, каким это сделает split (реестр + ссылка), — и
 * проверяем контракт общего документа: правки видны везде, undo один на
 * документ, dirty/save общие, чужие каретки не прыгают.
 */
describe("EditorComponent: один документ в двух вью", () => {
    let ws: ITempWorkspace;
    let undoRedo: UndoRedoService;
    let registry: TextFileModelRegistry;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-shared-doc-" });
        undoRedo = new UndoRedoService();
        registry = new TextFileModelRegistry((uri) => {
            const model = new TextFileModel(NULL_LANGUAGE_SERVICE, undoRedo);
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

    /** Печать в конкретной вью тем же путём, что и клавиатура: мутатор + push в общий движок. */
    function typeIn(pane: TextEditorPane, text: string): void {
        pane.pushUndo(pane.viewState.type(text));
    }

    it("US-26: правка в A видна в B немедленно, каретка B не прыгает", () => {
        const { a, b } = openTwice("shared.txt", "alpha\nbeta\ngamma");
        b.viewState.selections = [createCursorSelection(2, 3)];

        a.viewState.selections = [createCursorSelection(0, 5)];
        typeIn(a, "\ninserted");

        // Оба показывают один документ с правкой.
        expect(a.getText()).toBe("alpha\ninserted\nbeta\ngamma");
        expect(b.getText()).toBe("alpha\ninserted\nbeta\ngamma");
        // Каретка B сдвинулась вместе со своей строкой (была gamma:3 → строка съехала на 1).
        expect(b.viewState.selections[0].active).toEqual({ line: 3, character: 3 });
        // Каретка A — своя, в конце вставки.
        expect(a.viewState.selections[0].active).toEqual({ line: 1, character: 8 });
    });

    it("US-27: undo из другой вью откатывает правку, обе вью видят откат", () => {
        const { a, b } = openTwice("shared.txt", "hello");
        a.viewState.selections = [createCursorSelection(0, 5)];
        typeIn(a, " world");
        expect(b.getText()).toBe("hello world");

        b.undo();

        expect(a.getText()).toBe("hello");
        expect(b.getText()).toBe("hello");
        // Снимок выделений шага восстановлен в действующую вью — B.
        expect(b.viewState.selections[0].active).toEqual({ line: 0, character: 5 });
    });

    it("история одна на документ: правка в A, правка в B, undo, undo (LIFO)", () => {
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

        // И redo идёт тем же общим стеком.
        a.redo();
        a.redo();
        expect(b.getText()).toBe("xAB");
    });

    it("US-28: маркер изменённости и сохранение общие", async () => {
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

    it("US-31: перечитка с диска пересобирает обе вью и сохраняет их скролл", () => {
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

    it("закрытие одной вью не убивает документ; последняя — убивает", () => {
        const { a, b } = openTwice("shared.txt", "text");
        const model = a.model;
        typeIn(a, "!");

        a.dispose();
        // Модель жива: вторая вью продолжает работать с правками.
        expect(b.getText()).toBe("!text");
        expect(b.isModified).toBe(true);

        const context = model.undoContext;
        expect(undoRedo.peekUndo(context)).toBeDefined();
        b.dispose();
        // Штатный dispose модели: undo-бакет очищен.
        expect(undoRedo.peekUndo(context)).toBeUndefined();
    });

    it("фолды второй вью сдвигаются под правку первой", () => {
        const { a, b } = openTwice(
            "folds.txt",
            ["top", "if {", "  in1", "  in2", "}", "tail"].join("\n"),
        );
        b.viewState.setFoldingRegions([{ startLine: 1, endLine: 4, isCollapsed: true }]);

        // A вставляет строку выше региона.
        a.viewState.selections = [createCursorSelection(0, 3)];
        typeIn(a, "\nadded");

        const region = b.viewState.foldedRegions[0];
        expect(region.startLine).toBe(2);
        expect(region.endLine).toBe(5);
        expect(region.isCollapsed).toBe(true);
    });
});
