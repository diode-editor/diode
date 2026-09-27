import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { enablePerformanceMarks, getMarks, resetPerformanceMarks } from "../../../../base/common/performance.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { PlainTextTokenizer } from "../../../../editor/common/languages/builtin/plainTextTokenizer.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";

// Вехи лестницы старта (docs/TODO/OpenPerformance.md): открытие файла ставит
// метки чтения/декодирования/построения документа и готовности токенайзера,
// которые бенч читает из трассы DIODE_STARTUP_TRACE.
describe("EditorComponent + TextFileModel — вехи старта", () => {
    let ws: ITempWorkspace;
    const typescriptLanguageService: ILanguageService = {
        ...NULL_LANGUAGE_SERVICE,
        getLanguageIdForResource: () => "typescript",
        getLanguageDisplayName: () => undefined,
    };

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-startup-marks-" });
    });

    afterEach(() => {
        resetPerformanceMarks();
        ws.dispose();
    });

    it("без включённой трассы открытие файла не ставит ни одной метки", () => {
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(ws.writeFile("a.txt", "hello\nworld\n")));
        expect(getMarks()).toEqual([]);
        ctrl.dispose();
    });

    it("чтение → декодирование → документ: три вехи по порядку с размерами файла", () => {
        enablePerformanceMarks();
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(ws.writeFile("a.txt", "hello\nworld\n")));

        const marks = getMarks().filter((m) => m.name.startsWith("textfile:"));
        expect(marks.map((m) => m.name)).toEqual(["textfile:read", "textfile:decoded", "textfile:document-built"]);
        expect(marks[0].detail).toEqual({ bytes: 12 });
        expect(marks[1].detail).toEqual({ chars: 12 });
        expect(marks[2].detail).toEqual({ lines: 3 });
        expect(marks[0].startTime).toBeLessThanOrEqual(marks[1].startTime);
        expect(marks[1].startTime).toBeLessThanOrEqual(marks[2].startTime);
        ctrl.dispose();
    });

    it("токенайзер из реестра на руках — веха editor:tokenizer-ready с языком", () => {
        enablePerformanceMarks();
        const registry = new TokenizationRegistry();
        registry.register("typescript", new PlainTextTokenizer());
        const ctrl = createEditorPane({ registry, languageService: typescriptLanguageService });
        ctrl.openFile(Uri.file(ws.writeFile("a.ts", "const x = 1;")));

        const ready = getMarks().filter((m) => m.name === "editor:tokenizer-ready");
        expect(ready.length).toBeGreaterThanOrEqual(1);
        expect(ready[0].detail).toEqual({ languageId: "typescript" });
        // Токенайзер приходит ДО построения документа? Нет: сначала документ,
        // потом редактор — веха стоит после textfile:document-built.
        const built = getMarks().find((m) => m.name === "textfile:document-built");
        expect(built).toBeDefined();
        expect(ready[0].startTime).toBeGreaterThanOrEqual(built?.startTime ?? Infinity);
        ctrl.dispose();
    });

    it("реестр без поддержки языка — fallback на plaintext без вехи tokenizer-ready", () => {
        enablePerformanceMarks();
        const ctrl = createEditorPane({ registry: new TokenizationRegistry(), languageService: typescriptLanguageService });
        ctrl.openFile(Uri.file(ws.writeFile("a.ts", "const x = 1;")));

        expect(getMarks().some((m) => m.name === "editor:tokenizer-ready")).toBe(false);
        expect(ctrl.getText()).toBe("const x = 1;");
        ctrl.dispose();
    });
});
