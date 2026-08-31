import { describe, expect, it } from "vitest";

import { editorConfiguration } from "./editorConfiguration.ts";

// Схема — контракт: по ней генерируется каталог настроек (diode-settings) и
// валидируется settings.json, поэтому ключи прибиты дословно.

describe("editorConfiguration — схема настроек переноса", () => {
    it("editor.wordWrap: enum четырёх режимов с дефолтом off", () => {
        expect(editorConfiguration.properties["editor.wordWrap"]).toEqual({
            type: "string",
            enum: ["off", "on", "wordWrapColumn", "bounded"],
            default: "off",
            description:
                "Controls how lines should wrap: never ('off'), at the viewport width ('on'), or at " +
                "`editor.wordWrapColumn` ('wordWrapColumn'/'bounded'; both are capped by the viewport width).",
        });
    });

    it("editor.wordWrapColumn: число с дефолтом 80", () => {
        expect(editorConfiguration.properties["editor.wordWrapColumn"]).toEqual({
            type: "number",
            default: 80,
            description: "Controls the wrapping column when `editor.wordWrap` is 'wordWrapColumn' or 'bounded'.",
        });
    });

    it("editor.detectIndentation: булево с дефолтом true", () => {
        expect(editorConfiguration.properties["editor.detectIndentation"]).toEqual({
            type: "boolean",
            default: true,
            description:
                "Controls whether `editor.tabSize` and `editor.insertSpaces` are automatically detected " +
                "from the file contents when a file is opened.",
        });
    });
});
