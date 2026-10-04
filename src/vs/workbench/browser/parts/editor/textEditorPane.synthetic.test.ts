import { describe, expect, it } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { DEFAULT_ENCODING } from "../../../../editor/common/model/encoding.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { SyntheticTextModel } from "../../../common/editor/syntheticTextModel.ts";

import { EditorComponent } from "./editorComponent.ts";
import { isTextEditorPane, TextEditorPane } from "./textEditorPane.ts";

/**
 * Вкладка над синтетикой (Output, виртуальный документ, снимок диффа): файла
 * у неё нет, и файловые операции фасада отвечают честно — без записи, без
 * перечитки, с кодировкой по умолчанию.
 */
describe("TextEditorPane над синтетической моделью", () => {
    function syntheticPane(): TextEditorPane<SyntheticTextModel> {
        const model = new SyntheticTextModel(
            NULL_LANGUAGE_SERVICE,
            new UndoRedoService(),
            Uri.parse("jdt://contents/lib.jar/Lib.java"),
            "java",
        );
        model.replaceContent("class Lib {}\n");
        const component = new EditorComponent(new TokenizationRegistry(), NULL_TOKEN_STYLE_RESOLVER, model);
        return new TextEditorPane(model, component);
    }

    it("файловых осей нет: имя, путь, конфликт, кодировка по умолчанию", () => {
        const pane = syntheticPane();

        expect(pane.fileModel).toBeNull();
        expect(pane.fileName).toBeNull();
        expect(pane.absoluteFilePath).toBeNull();
        expect(pane.hasDiskConflict).toBe(false);
        expect(pane.encoding).toBe(DEFAULT_ENCODING);
        expect(pane.isModified).toBe(false);
        pane.dispose();
    });

    it("сохранять и перечитывать нечего: no-file, false, кодировка не меняется", async () => {
        const pane = syntheticPane();

        expect(await pane.save()).toBe("no-file");
        expect(await pane.saveWithEncoding("utf16le")).toBe("no-file");
        expect(pane.revertToDisk()).toBe(false);
        expect(pane.reopenWithEncoding("utf16le")).toBe(false);
        pane.setEncoding("utf16le");
        expect(pane.encoding).toBe(DEFAULT_ENCODING);
        expect(pane.getText()).toBe("class Lib {}\n");
        pane.dispose();
    });

    it("файловые события молчат, подписки на них безопасны", () => {
        const pane = syntheticPane();
        let fired = 0;
        const subscriptions = [
            pane.onDidChangeEncoding(() => fired++),
            pane.onDidChangeDiskState(() => fired++),
            pane.onDidChangeState(() => fired++),
        ];

        pane.model.appendContent("tail\n");

        // Правка владельца — это контент (вкладка перерисуется), но не «файл».
        expect(fired).toBe(1);
        for (const subscription of subscriptions) subscription.dispose();
        pane.dispose();
    });

    it("открыть файл или Save As поверх синтетики — ошибка, а не тихий no-op", () => {
        const pane = syntheticPane();

        expect(() => {
            pane.openFile(Uri.file("/tmp/x.txt"));
        }).toThrow(/openFile: у буфера jdt:/);
        expect(() => pane.saveAs("/tmp/x.txt")).toThrow(/saveAs: у буфера jdt:/);
        pane.dispose();
    });

    it("isTextEditorPane узнаёт текстовую вкладку над любой моделью", () => {
        const pane = syntheticPane();

        expect(isTextEditorPane(pane)).toBe(true);
        expect(isTextEditorPane(pane.model)).toBe(false);
        pane.dispose();
    });
});
