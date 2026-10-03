import { describe, expect, it } from "vitest";

import { createConfigurationChangeEvent, diffConfigurationKeys } from "./configurationChangeEvent.ts";
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

    it("returns an empty list for structurally equal models", () => {
        const a = ConfigurationModel.fromRaw({ "x.y": [1, 2], "x.z": "s" });
        const b = ConfigurationModel.fromRaw({ "x.y": [1, 2], "x.z": "s" });
        expect(diffConfigurationKeys(a, b)).toEqual([]);
    });
});

describe("createConfigurationChangeEvent", () => {
    it("affectsConfiguration matches exact key, ancestor and descendant", () => {
        const event = createConfigurationChangeEvent(["editor.tabSize"]);
        expect(event.affectsConfiguration("editor.tabSize")).toBe(true); // exact
        expect(event.affectsConfiguration("editor")).toBe(true); // ancestor
        expect(event.affectsConfiguration("editor.tabSize.deep")).toBe(true); // descendant
        expect(event.affectsConfiguration("workbench")).toBe(false); // unrelated
        expect(event.affectsConfiguration("editorX")).toBe(false); // prefix but not a segment boundary
    });

    it("affectsConfiguration — достаточно одного совпавшего ключа из нескольких", () => {
        const event = createConfigurationChangeEvent(["editor.tabSize", "files.exclude"]);
        expect(event.affectsConfiguration("files.exclude")).toBe(true);
        expect(event.affectsConfiguration("search.exclude")).toBe(false);
    });
});
