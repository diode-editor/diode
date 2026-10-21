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

describe("TextEditorPane over a synthetic model", () => {
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

    it("no file axes: name, path, conflict, deletion, default encoding", () => {
        const pane = syntheticPane();

        expect(pane.fileModel).toBeNull();
        expect(pane.fileName).toBeNull();
        expect(pane.absoluteFilePath).toBeNull();
        expect(pane.hasDiskConflict).toBe(false);
        expect(pane.isOrphaned).toBe(false);
        expect(pane.encoding).toBe(DEFAULT_ENCODING);
        expect(pane.isModified).toBe(false);
        pane.dispose();
    });

    it("nothing to save or reload: no-file, false, encoding does not change", async () => {
        const pane = syntheticPane();

        expect(await pane.save()).toBe("no-file");
        expect(await pane.saveWithEncoding("utf16le")).toBe("no-file");
        expect(pane.revertToDisk()).toBe(false);
        expect(await pane.reopenWithEncoding("utf16le")).toBe(false);
        pane.setEncoding("utf16le");
        expect(pane.encoding).toBe(DEFAULT_ENCODING);
        expect(pane.getText()).toBe("class Lib {}\n");
        pane.dispose();
    });

    it("file events stay silent, subscribing to them is safe", () => {
        const pane = syntheticPane();
        let fired = 0;
        const subscriptions = [
            pane.onDidChangeEncoding(() => fired++),
            pane.onDidChangeDiskState(() => fired++),
            pane.onDidChangeState(() => fired++),
        ];

        pane.model.appendContent("tail\n");

        // An owner edit is a content change (the tab repaints), not a "file" change.
        expect(fired).toBe(1);
        for (const subscription of subscriptions) subscription.dispose();
        pane.dispose();
    });

    it("opening a file or Save As over a synthetic buffer throws instead of a silent no-op", () => {
        const pane = syntheticPane();

        expect(() => {
            pane.openFile(Uri.file("/tmp/x.txt"));
        }).toThrow(/openFile: buffer jdt:/);
        expect(() => pane.saveAs("/tmp/x.txt")).toThrow(/saveAs: buffer jdt:/);
        pane.dispose();
    });

    it("isTextEditorPane recognizes a text tab over any model", () => {
        const pane = syntheticPane();

        expect(isTextEditorPane(pane)).toBe(true);
        expect(isTextEditorPane(pane.model)).toBe(false);
        pane.dispose();
    });
});
