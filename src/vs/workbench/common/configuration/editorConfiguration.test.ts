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
