import { describe, expect, it } from "vitest";

import { MarkerSeverity } from "../../../../platform/markers/common/iMarker.ts";

import {
    collectKnownSettingKeys,
    validateSettingsJson,
    workspaceUnsupportedSettingMessage,
} from "./settingsDiagnostics.ts";

const KNOWN = collectKnownSettingKeys({
    editor: { tabSize: 4, insertSpaces: true },
    workbench: { colorTheme: "Dark Modern" },
});
const isKnown = (key: string): boolean => KNOWN.has(key);

describe("collectKnownSettingKeys", () => {
    it("includes every dotted leaf and every prefix", () => {
        expect(KNOWN.has("editor")).toBe(true);
        expect(KNOWN.has("editor.tabSize")).toBe(true);
        expect(KNOWN.has("editor.insertSpaces")).toBe(true);
        expect(KNOWN.has("workbench.colorTheme")).toBe(true);
    });

    it("does not include unrelated keys", () => {
        expect(KNOWN.has("editor.fontSize")).toBe(false);
        expect(KNOWN.has("telemetry")).toBe(false);
    });
});

describe("validateSettingsJson", () => {
    it("flags an unknown top-level key as a warning", () => {
        const markers = validateSettingsJson(`{ "editor.fontSize": 12 }`, isKnown);
        expect(markers).toHaveLength(1);
        expect(markers[0].severity).toBe(MarkerSeverity.Warning);
        expect(markers[0].message).toContain("editor.fontSize");
        expect(markers[0].source).toBe("json");
    });

    it("ranges the marker over the quoted key", () => {
        //            0         1
        //            0123456789012345678
        const text = `{ "unknown.key": 1 }`;
        const [marker] = validateSettingsJson(text, isKnown);
        // The key string node spans the quotes: offset 2 .. 15.
        expect(marker.range.start).toEqual({ line: 0, character: 2 });
        expect(marker.range.end).toEqual({ line: 0, character: 15 });
    });

    it("computes multi-line positions from offsets", () => {
        const text = ["{", '  "editor.tabSize": 4,', '  "bogus": true', "}"].join("\n");
        const [marker] = validateSettingsJson(text, isKnown);
        expect(marker.message).toContain("bogus");
        expect(marker.range.start).toEqual({ line: 2, character: 2 });
    });

    it("ignores known keys, including object-valued parents", () => {
        const text = `{ "editor.tabSize": 2, "editor": { "insertSpaces": false } }`;
        expect(validateSettingsJson(text, isKnown)).toEqual([]);
    });

    it("returns nothing for a non-object root", () => {
        expect(validateSettingsJson(`[1, 2, 3]`, isKnown)).toEqual([]);
        expect(validateSettingsJson(``, isKnown)).toEqual([]);
    });

    it("tolerates comments and trailing commas (JSONC)", () => {
        const text = ["{", "  // a comment", '  "nope": 1,', "}"].join("\n");
        const markers = validateSettingsJson(text, isKnown);
        expect(markers.map((m) => m.message)).toHaveLength(1);
        expect(markers[0].message).toContain("nope");
    });
});

describe("validateSettingsJson — ключи, не действующие в этом файле", () => {
    it("известный ключ с причиной — подсказка (Hint) на ключе, неизвестный — прежнее предупреждение", () => {
        const text = ["{", '    "editor.tabSize": 2,', '    "workbench.colorTheme": "x",', '    "nope": 1', "}"].join(
            "\n",
        );
        const markers = validateSettingsJson(text, isKnown, (key) =>
            key === "workbench.colorTheme" ? "not here" : null,
        );

        expect(markers.map((m) => [m.severity, m.message, m.code])).toEqual([
            [MarkerSeverity.Hint, "not here", "unsupportedSetting"],
            [MarkerSeverity.Warning, "Unknown Configuration Setting: nope", "unknownSetting"],
        ]);
        expect(markers[0].source).toBe("json");
        expect(markers[0].range.start).toEqual({ line: 2, character: 4 });
        expect(markers[0].range.end).toEqual({ line: 2, character: 26 });
    });

    it("без предиката причин — известные ключи молчат (user settings.json)", () => {
        expect(validateSettingsJson(`{ "workbench.colorTheme": "x" }`, isKnown)).toEqual([]);
    });
});

describe("workspaceUnsupportedSettingMessage — тексты эталона", () => {
    it.each([
        [
            "application",
            "This setting has an application scope and can only be set in the settings file from the Default profile.",
        ],
        [
            "machine",
            "This setting can only be applied in user settings in local window or in remote settings in remote window.",
        ],
    ] as const)("%s", (scope, message) => {
        expect(workspaceUnsupportedSettingMessage(scope)).toBe(message);
    });

    it.each(["window", "resource", "language-overridable", "machine-overridable", undefined] as const)(
        "%s — действует в воркспейсе",
        (scope) => {
            expect(workspaceUnsupportedSettingMessage(scope)).toBeNull();
        },
    );
});
