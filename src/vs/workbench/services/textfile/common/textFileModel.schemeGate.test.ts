import { describe, expect, it } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";

import { TextFileModel } from "./textFileModel.ts";

/**
 * Гейт схемы у {@link TextFileModel.openFile}: модель файла работает ТОЛЬКО с
 * диском. Без гейта промах тихий и разрушительный — `fsPath` у не-file uri не
 * бросает, а отдаёт «путь» как есть, и `git:`-ресурс показал бы рабочее дерево,
 * повесив watcher на чужой путь.
 *
 * Гейт — инвариант самой модели, а не способ сообщить пользователю: недисковые
 * ресурсы до него больше не доезжают, их разбирает `EditorService.openUri`
 * (см. `editorService.virtualDocument.test.ts`).
 */
describe("TextFileModel.openFile — гейт схемы", () => {
    function make(): TextFileModel {
        return new TextFileModel(NULL_LANGUAGE_SERVICE, new UndoRedoService());
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

        // Ресурс не подменён, содержимое чужого пути не прочитано.
        expect(model.uri.scheme).toBe("untitled");
        expect(model.getText()).toBe("");
        model.dispose();
    });
});
