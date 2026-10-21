import { describe, expect, it } from "vitest";

import { editorConfiguration } from "./editorConfiguration.ts";

// Дефолты onSave обязаны быть выключены (#196): с ними сохранение не меняется ни на байт.

describe("editorConfiguration — emptySelectionClipboard", () => {
    it("boolean, включён по умолчанию — как в VS Code", () => {
        const schema = editorConfiguration.properties["editor.emptySelectionClipboard"];
        expect(schema.type).toBe("boolean");
        expect(schema.default).toBe(true);
        expect(schema.description).toContain("copies the current line");
    });
});

describe("editorConfiguration — призрачные подсказки", () => {
    it("editor.inlineSuggest.enabled: boolean, включён по умолчанию (гейт только автозапроса)", () => {
        const schema = editorConfiguration.properties["editor.inlineSuggest.enabled"];
        expect(schema.type).toBe("boolean");
        expect(schema.default).toBe(true);
        expect(schema.description).toContain("automatically show inline suggestions");
    });

    it("editor.inlineSuggest.delay: number, 50 мс по умолчанию", () => {
        const schema = editorConfiguration.properties["editor.inlineSuggest.delay"];
        expect(schema.type).toBe("number");
        expect(schema.default).toBe(50);
        // Обе половины склейки описания — их видит автодополнение settings.json.
        expect(schema.description).toContain("before automatically requesting an inline suggestion");
        expect(schema.description).toContain("slow or metered provider");
    });

    it("editor.inlineSuggest.requestTimeout: number, 5000 мс по умолчанию", () => {
        const schema = editorConfiguration.properties["editor.inlineSuggest.requestTimeout"];
        expect(schema.type).toBe("number");
        expect(schema.default).toBe(5000);
        expect(schema.description).toContain("wait for an inline suggestion provider to answer");
        expect(schema.description).toContain("no suggestion is shown");
    });
});

describe("editorConfiguration — авто-открытие suggest (дефолты эталона)", () => {
    it("quickSuggestions: в коде уступает призраку, в комментариях и строках выключен", () => {
        const schema = editorConfiguration.properties["editor.quickSuggestions"];
        expect(schema.type).toEqual(["boolean", "string", "object"]);
        expect(schema.default).toEqual({ other: "offWhenInlineCompletions", comments: "off", strings: "off" });
    });

    it("quickSuggestionsDelay 10 мс, suggestOnTriggerCharacters вкл, suppressSuggestions выкл", () => {
        expect(editorConfiguration.properties["editor.quickSuggestionsDelay"].default).toBe(10);
        expect(editorConfiguration.properties["editor.suggestOnTriggerCharacters"].default).toBe(true);
        expect(editorConfiguration.properties["editor.inlineSuggest.suppressSuggestions"].default).toBe(false);
    });

    it("wordBasedSuggestions: пять режимов эталона, дефолт offWithInlineSuggestions", () => {
        const schema = editorConfiguration.properties["editor.wordBasedSuggestions"];
        expect(schema.enum).toEqual([
            "off",
            "offWithInlineSuggestions",
            "currentDocument",
            "matchingDocuments",
            "allDocuments",
        ]);
        expect(schema.enumDescriptions).toHaveLength(5);
        expect(schema.default).toBe("offWithInlineSuggestions");
    });
});

describe("editorConfiguration — onSave-настройки", () => {
    it("editor.formatOnSave: boolean, выключен по умолчанию", () => {
        const schema = editorConfiguration.properties["editor.formatOnSave"];
        expect(schema.type).toBe("boolean");
        expect(schema.default).toBe(false);
        expect(schema.description).toContain("Format a file on save");
    });

    it("editor.codeActionsOnSave: объект или массив, пустой по умолчанию, описание про иерархию kind'ов", () => {
        const schema = editorConfiguration.properties["editor.codeActionsOnSave"];
        expect(schema.type).toEqual(["object", "array"]);
        expect(schema.default).toEqual({});
        // По одной фразе из каждой половины склейки.
        expect(schema.description).toContain("run on save");
        expect(schema.description).toContain("hierarchically");
    });
});
