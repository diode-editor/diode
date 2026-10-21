import { describe, expect, it } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";

import { TextFileModel } from "./textFileModel.ts";

/**
 * Without the gate the miss is silent: `fsPath` of a non-file uri returns the "path" as is. Non-disk
 * resources never reach the model; `EditorService.openUri` dispatches them.
 */
describe("TextFileModel.openFile — гейт схемы", () => {
    function make(): TextFileModel {
        return new TextFileModel(NULL_LANGUAGE_SERVICE, new UndoRedoService(), diskFileService());
    }

    it("не-file uri отвергается с названной схемой", () => {
        const model = make();

        expect(() => {
            model.openFile(Uri.parse("jdt://contents/lib.jar/pkg/Foo.java"));
        }).toThrow(/expected a file: uri, got jdt:/u);

        model.dispose();
    });

    it("отказ не оставляет модель наполовину открытой", () => {
        const model = make();

        expect(() => {
            model.openFile(Uri.from({ scheme: "git", path: "/repo/a.ts" }));
        }).toThrow();

        expect(model.uri.scheme).toBe("untitled");
        expect(model.getText()).toBe("");
        model.dispose();
    });
});
