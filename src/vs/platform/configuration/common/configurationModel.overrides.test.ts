import { describe, expect, it } from "vitest";

import { ConfigurationModel, isOverrideKey } from "./configurationModel.ts";

describe("ConfigurationModel — секции языков", () => {
    it("isOverrideKey: одна и несколько скобок; обычный ключ — нет", () => {
        expect(isOverrideKey("[go]")).toBe(true);
        expect(isOverrideKey("[javascript][typescript]")).toBe(true);
        expect(isOverrideKey("editor.tabSize")).toBe(false);
        expect(isOverrideKey("[go")).toBe(false);
        expect(isOverrideKey("x[go]")).toBe(false);
        expect(isOverrideKey("[]")).toBe(false);
    });

    it("секция не видна в основном дереве, override(lang) кладёт её поверх", () => {
        const model = ConfigurationModel.fromRaw({
            "editor.tabSize": 4,
            "editor.insertSpaces": true,
            "[makefile]": { "editor.insertSpaces": false },
        });

        expect(model.get("editor.insertSpaces")).toBe(true);
        expect(model.getValue()).toEqual({ editor: { tabSize: 4, insertSpaces: true } });
        expect(model.override("makefile").get("editor.insertSpaces")).toBe(false);
        expect(model.override("makefile").get("editor.tabSize")).toBe(4);
        // Нет секции — та же модель.
        expect(model.override("go")).toBe(model);
        expect(model.getOverrideIdentifiers()).toEqual(["makefile"]);
    });

    it("сдвоенная секция действует для каждого языка; не-объект — опечатка, игнорируется", () => {
        const model = ConfigurationModel.fromRaw({
            "[javascript][ typescript ]": { "editor.tabSize": 2 },
            "[go]": 8,
        });

        expect(model.override("javascript").get("editor.tabSize")).toBe(2);
        expect(model.override("typescript").get("editor.tabSize")).toBe(2);
        expect(model.getOverrideIdentifiers().sort()).toEqual(["javascript", "typescript"]);
    });

    it("одна секция в слое дважды (сдвоенная и одиночная) — сливаются", () => {
        const model = ConfigurationModel.fromRaw({
            "[javascript][typescript]": { "editor.tabSize": 2 },
            "[typescript]": { "editor.insertSpaces": false },
        });

        expect(model.getOverride("typescript").getValue()).toEqual({ editor: { tabSize: 2, insertSpaces: false } });
    });

    it("merge сливает секции послойно, позднее главнее; [lang] любого слоя бьёт плоское значение", () => {
        const defaults = ConfigurationModel.fromRaw({
            "editor.insertSpaces": true,
            "[go]": { "editor.insertSpaces": false },
        });
        const user = ConfigurationModel.fromRaw({ "editor.insertSpaces": true, "[go]": { "editor.tabSize": 8 } });

        const merged = ConfigurationModel.merge(defaults, user).override("go");

        expect(merged.get("editor.insertSpaces")).toBe(false);
        expect(merged.get("editor.tabSize")).toBe(8);
    });

    it("toRaw — основное дерево плюс секции в скобках; fromRaw(toRaw) — та же модель", () => {
        const model = ConfigurationModel.fromRaw({ "editor.tabSize": 4, "[go]": { "editor.tabSize": 8 } });

        const raw = model.toRaw();

        expect(raw).toEqual({ editor: { tabSize: 4 }, "[go]": { editor: { tabSize: 8 } } });
        expect(ConfigurationModel.fromRaw(raw).override("go").get("editor.tabSize")).toBe(8);
    });

    it("пустой идентификатор (`[ ]`, `[a][ ]`) отбрасывается", () => {
        const model = ConfigurationModel.fromRaw({ "[ ]": { "editor.tabSize": 1 }, "[a][ ]": { "editor.tabSize": 2 } });

        expect(model.getOverrideIdentifiers()).toEqual(["a"]);
    });

    it("getOverride без секции — пустая модель", () => {
        expect(ConfigurationModel.fromRaw({}).getOverride("go").getValue()).toEqual({});
    });
});
