import { describe, expect, it } from "vitest";

import {
    createConfigurationChangeEvent,
    diffConfigurationKeys,
    diffOverrideIdentifiers,
} from "./configurationChangeEvent.ts";
import { ConfigurationModel } from "./configurationModel.ts";

describe("diffConfigurationKeys", () => {
    it("reports added, removed and changed leaf keys (including arrays/objects)", () => {
        const prev = ConfigurationModel.fromRaw({
            "editor.tabSize": 2,
            "editor.rulers": [80],
            "a.b": 1,
        });
        const next = ConfigurationModel.fromRaw({
            "editor.tabSize": 4, // changed
            "editor.rulers": [80, 120], // changed (array)
            "c.d": true, // added
            // a.b removed
        });
        expect(new Set(diffConfigurationKeys(prev, next))).toEqual(
            new Set(["editor.tabSize", "editor.rulers", "c.d", "a.b"]),
        );
    });

    it("an edit inside an object value with dotted keys reports the setting itself", () => {
        const prev = ConfigurationModel.fromRaw({
            "workbench.colorCustomizations": { "editor.background": "#202020" },
            "files.exclude": { "**/.git": true },
            "editor.tabSize": 2,
        });
        const next = ConfigurationModel.fromRaw({
            "workbench.colorCustomizations": {
                "editor.background": "#303030",
                "[Light Modern]": { "editor.background": "#fff8e0" },
            },
            "files.exclude": { "**/.git": false },
            "editor.tabSize": 2,
        });
        expect(new Set(diffConfigurationKeys(prev, next))).toEqual(
            new Set(["workbench.colorCustomizations", "files.exclude"]),
        );
    });

    it("returns an empty list for structurally equal models", () => {
        const a = ConfigurationModel.fromRaw({ "x.y": [1, 2], "x.z": "s" });
        const b = ConfigurationModel.fromRaw({ "x.y": [1, 2], "x.z": "s" });
        expect(diffConfigurationKeys(a, b)).toEqual([]);
    });
});

describe("createConfigurationChangeEvent", () => {
    it("affectsConfiguration matches exact key, ancestor and descendant", () => {
        const event = createConfigurationChangeEvent(["editor.tabSize"]);
        expect(event.affectsConfiguration("editor.tabSize")).toBe(true);
        expect(event.affectsConfiguration("editor")).toBe(true);
        expect(event.affectsConfiguration("editor.tabSize.deep")).toBe(true);
        expect(event.affectsConfiguration("workbench")).toBe(false);
        expect(event.affectsConfiguration("editorX")).toBe(false); // prefix but not a segment boundary
    });

    it("no languages — empty overrideIdentifiers", () => {
        expect(createConfigurationChangeEvent(["editor.tabSize"]).overrideIdentifiers).toEqual([]);
    });

    it("affectsConfiguration — one matching key out of several is enough", () => {
        const event = createConfigurationChangeEvent(["editor.tabSize", "files.exclude"]);
        expect(event.affectsConfiguration("files.exclude")).toBe(true);
        expect(event.affectsConfiguration("search.exclude")).toBe(false);
    });
});

describe("diffOverrideIdentifiers", () => {
    it("only languages whose section changed, including added and removed ones", () => {
        const prev = ConfigurationModel.fromRaw({
            "[go]": { "editor.tabSize": 4 },
            "[python]": { "editor.tabSize": 2 },
            "[rust]": { "editor.tabSize": 4 },
        });
        const next = ConfigurationModel.fromRaw({
            "[go]": { "editor.tabSize": 8 },
            "[python]": { "editor.tabSize": 2 },
            "[c]": { "editor.tabSize": 4 },
        });

        expect(diffOverrideIdentifiers(prev, next).sort()).toEqual(["c", "go", "rust"]);
    });
});
