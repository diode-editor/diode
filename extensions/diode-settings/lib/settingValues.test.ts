import { describe, expect, it } from "vitest";

import { SETTINGS_SCHEMA } from "../settings-schema.generated.ts";

import { completionValuesFor } from "./settingValues.ts";

describe("completionValuesFor", () => {
    it("enum → all values, strings in quotes", () => {
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

    it("number without enum → default as a starting point", () => {
        expect(completionValuesFor({ key: "editor.tabSize", type: "number", default: 4 })).toEqual(["4"]);
    });

    it("string without enum → default in quotes", () => {
        expect(completionValuesFor({ key: "git.path", type: "string", default: "" })).toEqual(['""']);
    });

    it("enum wins over the boolean type", () => {
        expect(completionValuesFor({ key: "x", type: "boolean", default: true, enum: [true] })).toEqual(["true"]);
    });

    it("no enum and no default → nothing to suggest", () => {
        expect(completionValuesFor({ key: "x", type: "string" })).toEqual([]);
    });

    it("an empty enum does not count as a closed set", () => {
        expect(completionValuesFor({ key: "x", type: "boolean", default: false, enum: [] })).toEqual(["true", "false"]);
    });
});

// Without the generated schema's enums, suggestions silently degrade to a single default.
describe("SETTINGS_SCHEMA — enums in place", () => {
    function entry(key: string) {
        const found = SETTINGS_SCHEMA.find((e) => e.key === key);
        if (found === undefined) throw new Error(`No key ${key} in SETTINGS_SCHEMA`);
        return found;
    }

    it("terminal.tier carries all tiers", () => {
        expect(entry("terminal.tier").enum).toEqual(["auto", "legacy", "csi-u", "kitty"]);
    });

    it("workbench.colorTheme carries the builtin theme names", () => {
        const themes = entry("workbench.colorTheme").enum;
        expect(themes).toContain("Dark Modern");
        expect(themes).toContain("Light Modern");
        expect(themes).toContain(entry("workbench.colorTheme").default);
    });

    it("a boolean setting yields true/false even without an enum", () => {
        expect(completionValuesFor(entry("editor.insertSpaces"))).toEqual(["true", "false"]);
    });
});
