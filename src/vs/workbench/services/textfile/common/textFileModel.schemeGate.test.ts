import { describe, expect, it } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";

import { TextFileModel } from "./textFileModel.ts";

/**
 * Без гейта промах тихий: `fsPath` у не-file uri отдаёт «путь» как есть. Недисковые
 * ресурсы до модели не доезжают — их разбирает `EditorService.openUri`.
 */
describe("TextFileModel.openFile — гейт схемы", () => {
    function make(): TextFileModel {
        return new TextFileModel(NULL_LANGUAGE_SERVICE, new UndoRedoService(), diskFileService());
    }

    it("не-file uri отвергается с названной схемой", () => {
        const model = make();

        expect(() => {
            model.openFile(Uri.parse("jdt://contents/lib.jar/pkg/Foo.java"));
        }).toThrow(/ожидается file:-uri, получен jdt:/u);

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
