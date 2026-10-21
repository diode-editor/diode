import { describe, expect, it } from "vitest";

import { ConfigurationModel, isOverrideKey } from "./configurationModel.ts";

describe("ConfigurationModel — language sections", () => {
    it("isOverrideKey: one or several brackets; a plain key is not", () => {
        expect(isOverrideKey("[go]")).toBe(true);
        expect(isOverrideKey("[javascript][typescript]")).toBe(true);
        expect(isOverrideKey("editor.tabSize")).toBe(false);
        expect(isOverrideKey("[go")).toBe(false);
        expect(isOverrideKey("x[go]")).toBe(false);
        expect(isOverrideKey("[]")).toBe(false);
    });

    it("section is hidden from the main tree, override(lang) layers it on top", () => {
        const model = ConfigurationModel.fromRaw({
            "editor.tabSize": 4,
            "editor.insertSpaces": true,
            "[makefile]": { "editor.insertSpaces": false },
        });

        expect(model.get("editor.insertSpaces")).toBe(true);
        expect(model.getValue()).toEqual({ editor: { tabSize: 4, insertSpaces: true } });
        expect(model.override("makefile").get("editor.insertSpaces")).toBe(false);
        expect(model.override("makefile").get("editor.tabSize")).toBe(4);
        expect(model.override("go")).toBe(model);
        expect(model.getOverrideIdentifiers()).toEqual(["makefile"]);
    });

    it("combined section applies to each language; a non-object is a typo and is ignored", () => {
        const model = ConfigurationModel.fromRaw({
            "[javascript][ typescript ]": { "editor.tabSize": 2 },
            "[go]": 8,
        });

        expect(model.override("javascript").get("editor.tabSize")).toBe(2);
        expect(model.override("typescript").get("editor.tabSize")).toBe(2);
        expect(model.getOverrideIdentifiers().sort()).toEqual(["javascript", "typescript"]);
    });

    it("same section twice in a layer (combined and single) — merged", () => {
        const model = ConfigurationModel.fromRaw({
            "[javascript][typescript]": { "editor.tabSize": 2 },
            "[typescript]": { "editor.insertSpaces": false },
        });

        expect(model.getOverride("typescript").getValue()).toEqual({ editor: { tabSize: 2, insertSpaces: false } });
    });

    it("merge merges sections layer by layer, later wins; [lang] of any layer beats a flat value", () => {
        const defaults = ConfigurationModel.fromRaw({
            "editor.insertSpaces": true,
            "[go]": { "editor.insertSpaces": false },
        });
        const user = ConfigurationModel.fromRaw({ "editor.insertSpaces": true, "[go]": { "editor.tabSize": 8 } });

        const merged = ConfigurationModel.merge(defaults, user).override("go");

        expect(merged.get("editor.insertSpaces")).toBe(false);
        expect(merged.get("editor.tabSize")).toBe(8);
    });

    it("toRaw — main tree plus bracketed sections; fromRaw(toRaw) — the same model", () => {
        const model = ConfigurationModel.fromRaw({ "editor.tabSize": 4, "[go]": { "editor.tabSize": 8 } });

        const raw = model.toRaw();

        expect(raw).toEqual({ editor: { tabSize: 4 }, "[go]": { editor: { tabSize: 8 } } });
        expect(ConfigurationModel.fromRaw(raw).override("go").get("editor.tabSize")).toBe(8);
    });

    it("empty identifier (`[ ]`, `[a][ ]`) is dropped", () => {
        const model = ConfigurationModel.fromRaw({ "[ ]": { "editor.tabSize": 1 }, "[a][ ]": { "editor.tabSize": 2 } });

        expect(model.getOverrideIdentifiers()).toEqual(["a"]);
    });

    it("getOverride without a section — empty model", () => {
        expect(ConfigurationModel.fromRaw({}).getOverride("go").getValue()).toEqual({});
    });
});
