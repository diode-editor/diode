import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { SyntheticTextModel } from "../../../common/editor/syntheticTextModel.ts";

import { TextFileModel } from "./textFileModel.ts";

/** Сервис языков, который знает `.ts` и записывает каждый запрос фич как есть (без дедупа). */
function recordingLanguageService(): ILanguageService & { requests: string[] } {
    const requests: string[] = [];
    return {
        ...NULL_LANGUAGE_SERVICE,
        requests,
        getLanguageIdForResource: (filePath) => (filePath.endsWith(".ts") ? "typescript" : undefined),
        requestLanguageFeatures: (languageId) => {
            requests.push(languageId);
        },
    };
}

/**
 * Модель просит фичи языка там, где у документа появляется или меняется язык,
 * — отсюда активация расширений по `onLanguage:` для любой модели, а не только
 * для активного редактора.
 */
describe("TextFileModel — запрос фич языка", () => {
    let ws: ITempWorkspace;
    let languages: ReturnType<typeof recordingLanguageService>;
    let model: TextFileModel;

    beforeEach(() => {
        ws = createTempWorkspace({ files: { "a.ts": "const x = 1;\n", "b.md": "# b\n" } });
        languages = recordingLanguageService();
        model = new TextFileModel(languages, new UndoRedoService());
    });

    afterEach(() => {
        model.dispose();
        ws.dispose();
    });

    it("новая модель — plaintext, открытый файл — его язык", () => {
        expect(languages.requests).toEqual(["plaintext"]);

        model.openFile(Uri.file(ws.path("a.ts")));

        expect(languages.requests).toEqual(["plaintext", "typescript"]);
    });

    it("смена языка просит фичи нового языка", () => {
        model.openFile(Uri.file(ws.path("a.ts")));

        model.setLanguage("markdown");

        expect(languages.requests.at(-1)).toBe("markdown");
    });

    it("синтетический документ просит фичи своего языка", () => {
        new SyntheticTextModel(languages, new UndoRedoService(), Uri.parse("jdt://contents/Foo.class"), "java");

        expect(languages.requests.at(-1)).toBe("java");
    });

    it("подписка на смену языка живёт и на пересозданном документе", () => {
        model.openFile(Uri.file(ws.path("a.ts")));
        model.openFile(Uri.file(ws.path("b.md")));

        model.setLanguage("rust");

        expect(languages.requests).toEqual(["plaintext", "typescript", "plaintext", "rust"]);
    });
});
