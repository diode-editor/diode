import { describe, expect, it } from "vitest";

import { editorConfiguration } from "./editorConfiguration.ts";

// Схема настроек onSave (#196, хвост): дефолты ОБЯЗАНЫ быть выключены — с
// ними поведение сохранения не меняется ни на байт. Тип и описание — контракт
// валидатора settings.json и автодополнения ключей (diode-settings).

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

describe("editorConfiguration — onSave-настройки", () => {
    it("editor.formatOnSave: boolean, выключен по умолчанию", () => {
        const schema = editorConfiguration.properties["editor.formatOnSave"];
        expect(schema.type).toBe("boolean");
        expect(schema.default).toBe(false);
        expect(schema.description).toContain("Format a file on save");
    });

    it("editor.codeActionsOnSave: object, пустой по умолчанию, описание про иерархию kind'ов", () => {
        const schema = editorConfiguration.properties["editor.codeActionsOnSave"];
        expect(schema.type).toBe("object");
        expect(schema.default).toEqual({});
        // Обе половины склейки: «run on save» есть только в первой,
        // «hierarchically» — только во второй.
        expect(schema.description).toContain("run on save");
        expect(schema.description).toContain("hierarchically");
    });
});
