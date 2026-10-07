import { describe, expect, it } from "vitest";

import { ConfigurationModel } from "./configurationModel.ts";
import type { IConfigurationPropertySchema } from "./configurationRegistry.ts";
import type { ConfigurationScope } from "./configurationRegistry.ts";
import { ConfigurationRegistry } from "./configurationRegistry.ts";
import {
    filterWorkspaceSettings,
    isValidConfigurationValue,
    sanitizeConfiguration,
} from "./configurationValidation.ts";
import { InMemoryConfigurationService } from "./inMemoryConfigurationService.ts";

function schema(overrides: Partial<IConfigurationPropertySchema>): IConfigurationPropertySchema {
    return { type: "string", default: "", scope: "window", ...overrides };
}

describe("isValidConfigurationValue", () => {
    it.each([
        ["number", 4, true],
        ["number", "4", false],
        ["number", Number.NaN, false],
        ["number", Number.POSITIVE_INFINITY, false],
        ["boolean", false, true],
        ["boolean", "false", false],
        ["string", "x", true],
        ["string", 1, false],
        ["array", [1], true],
        ["array", { 0: 1 }, false],
        ["object", { a: 1 }, true],
        ["object", [1], false],
        ["object", null, false],
        ["null", null, true],
        ["null", 0, false],
    ] as const)("type %s, значение %j → %s", (type, value, expected) => {
        expect(isValidConfigurationValue(schema({ type }), value)).toBe(expected);
    });

    it("список типов — годится любой из них", () => {
        const kinds = schema({ type: ["object", "array"] });
        expect(isValidConfigurationValue(kinds, { "source.fixAll": true })).toBe(true);
        expect(isValidConfigurationValue(kinds, ["source.fixAll"])).toBe(true);
        expect(isValidConfigurationValue(kinds, "source.fixAll")).toBe(false);
    });

    it("enum пропускает только перечисленное", () => {
        const wordWrap = schema({ enum: ["off", "on"] });
        expect(isValidConfigurationValue(wordWrap, "on")).toBe(true);
        expect(isValidConfigurationValue(wordWrap, "sometimes")).toBe(false);
    });

    it("minimum и maximum — границы включительно", () => {
        const timeout = schema({ type: "number", minimum: 1, maximum: 10 });
        expect(isValidConfigurationValue(timeout, 1)).toBe(true);
        expect(isValidConfigurationValue(timeout, 10)).toBe(true);
        expect(isValidConfigurationValue(timeout, 0)).toBe(false);
        expect(isValidConfigurationValue(timeout, 11)).toBe(false);
        // Без границ — любое конечное число, в том числе отрицательное.
        expect(isValidConfigurationValue(schema({ type: "number" }), -5)).toBe(true);
    });
});

describe("sanitizeConfiguration", () => {
    const schemas = new Map<string, IConfigurationPropertySchema>([
        ["editor.tabSize", schema({ type: "number", default: 4, minimum: 1 })],
        ["editor.wordWrap", schema({ enum: ["off", "on"], default: "off" })],
        ["files.exclude", schema({ type: "object", default: { "**/.git": true } })],
    ]);

    it("значение вне схемы заменяется дефолтом, валидное и чужое — как есть", () => {
        const model = ConfigurationModel.fromRaw({
            "editor.tabSize": "four",
            "editor.wordWrap": "on",
            "files.exclude": "nope",
            "git.enabled": "whatever",
        });

        const sanitized = sanitizeConfiguration(model, schemas);

        expect(sanitized.get("editor.tabSize")).toBe(4);
        expect(sanitized.get("editor.wordWrap")).toBe("on");
        expect(sanitized.get("files.exclude")).toEqual({ "**/.git": true });
        expect(sanitized.get("git.enabled")).toBe("whatever");
    });

    it("всё валидно — та же модель, без пересборки", () => {
        const model = ConfigurationModel.fromRaw({ "editor.tabSize": 2 });

        expect(sanitizeConfiguration(model, schemas)).toBe(model);
    });
});

describe("сервис в памяти отдаёт значения, прошедшие схему", () => {
    it("мусор из user-слоя — дефолт, inspect().user — как записано", () => {
        const registry = new ConfigurationRegistry([
            {
                id: "editor",
                properties: {
                    "editor.inlineSuggest.delay": { scope: "window", type: "number", default: 50, minimum: 0 },
                },
            },
        ]);
        const service = new InMemoryConfigurationService(registry, { "editor.inlineSuggest.delay": -5 });

        expect(service.get("editor.inlineSuggest.delay")).toBe(50);
        expect(service.inspect("editor.inlineSuggest.delay").user).toBe(-5);
    });
});

describe("filterWorkspaceSettings", () => {
    const scopes = new Map<string, ConfigurationScope>([
        ["terminal.tier", "machine"],
        ["terminal.modes", "machine"],
        ["terminal.customModes", "window"],
        ["update.mode", "application"],
        ["editor.tabSize", "language-overridable"],
        ["java.home", "machine-overridable"],
    ]);

    it("ничего не отброшено — та же модель", () => {
        const model = ConfigurationModel.fromRaw({ "editor.tabSize": 2, "x.y": 1 });
        const result = filterWorkspaceSettings(model, scopes);
        expect(result.model).toBe(model);
        expect(result.excludedKeys).toEqual([]);
    });

    it("отбрасывает application/machine — без пустых предков; соседи по секции остаются", () => {
        const model = ConfigurationModel.fromRaw({
            "terminal.tier": "kitty",
            "terminal.customModes": { a: 1 },
            "update.mode": "none",
            "java.home": "/jdk",
            "[go]": { "terminal.modes": [], "editor.tabSize": 8 },
        });

        const result = filterWorkspaceSettings(model, scopes);

        expect(result.model.toRaw()).toEqual({
            terminal: { customModes: { a: 1 } },
            java: { home: "/jdk" },
            "[go]": { editor: { tabSize: 8 } },
        });
        expect([...result.excludedKeys].sort()).toEqual(["[go].terminal.modes", "terminal.tier", "update.mode"]);
        // Исходная модель не тронута.
        expect(model.get("terminal.tier")).toBe("kitty");
    });

    it("секция языка, где были только отброшенные ключи, остаётся пустой секцией", () => {
        const result = filterWorkspaceSettings(ConfigurationModel.fromRaw({ "[go]": { "update.mode": "x" } }), scopes);
        expect(result.model.getOverride("go").get("update.mode")).toBeUndefined();
        expect(result.excludedKeys).toEqual(["[go].update.mode"]);
    });
});
