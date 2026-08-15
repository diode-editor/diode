import { describe, expect, it } from "vitest";

import { SETTINGS_SCHEMA } from "../settings-schema.generated.ts";

import { completionValuesFor } from "./settingValues.ts";

describe("completionValuesFor", () => {
    it("enum → все варианты, строки в кавычках", () => {
        expect(completionValuesFor({ key: "terminal.tier", type: "string", enum: ["auto", "kitty"] })).toEqual([
            '"auto"',
            '"kitty"',
        ]);
    });

    it("boolean → true/false", () => {
        expect(completionValuesFor({ key: "editor.insertSpaces", type: "boolean", default: true })).toEqual([
            "true",
            "false",
        ]);
    });

    it("число без enum → дефолт как отправная точка", () => {
        expect(completionValuesFor({ key: "editor.tabSize", type: "number", default: 4 })).toEqual(["4"]);
    });

    it("строка без enum → дефолт в кавычках", () => {
        expect(completionValuesFor({ key: "git.path", type: "string", default: "" })).toEqual(['""']);
    });

    it("enum выигрывает у boolean-типа", () => {
        expect(completionValuesFor({ key: "x", type: "boolean", default: true, enum: [true] })).toEqual(["true"]);
    });

    it("без enum и без дефолта → предлагать нечего", () => {
        expect(completionValuesFor({ key: "x", type: "string" })).toEqual([]);
    });

    it("пустой enum не считается закрытым набором", () => {
        expect(completionValuesFor({ key: "x", type: "boolean", default: false, enum: [] })).toEqual(["true", "false"]);
    });
});

// Схема — сгенерированный артефакт (scripts/generate-settings-schema.mjs), и
// задача «подсказывать значения» держится на её enum'ах. Тут сторожим сам факт их
// наличия: без них подсказки молча выродятся в один дефолт.
describe("SETTINGS_SCHEMA — enum'ы на месте", () => {
    function entry(key: string) {
        const found = SETTINGS_SCHEMA.find((e) => e.key === key);
        if (found === undefined) throw new Error(`Нет ключа ${key} в SETTINGS_SCHEMA`);
        return found;
    }

    it("terminal.tier несёт все tier'ы", () => {
        expect(entry("terminal.tier").enum).toEqual(["auto", "legacy", "csi-u", "kitty"]);
    });

    it("workbench.colorTheme несёт имена встроенных тем", () => {
        const themes = entry("workbench.colorTheme").enum;
        expect(themes).toContain("Dark Modern");
        expect(themes).toContain("Light Modern");
        // Дефолт обязан быть выбираемым значением.
        expect(themes).toContain(entry("workbench.colorTheme").default);
    });

    it("boolean-настройка отдаёт true/false, даже не имея enum", () => {
        expect(completionValuesFor(entry("editor.insertSpaces"))).toEqual(["true", "false"]);
    });
});
