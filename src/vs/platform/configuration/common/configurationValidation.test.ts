import { describe, expect, it } from "vitest";

import { ConfigurationModel } from "./configurationModel.ts";
import type { IConfigurationPropertySchema } from "./configurationRegistry.ts";
import type { ConfigurationScope } from "./configurationRegistry.ts";
import { ConfigurationRegistry } from "./configurationRegistry.ts";
import {
    filterWorkspaceSettings,
    isValidConfigurationValue,
    pickRegisteredSettings,
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
        ["integer", 4, true],
        ["integer", -4, true],
        ["integer", 4.5, false],
        ["integer", "4", false],
        ["integer", Number.NaN, false],
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
    ] as const)("type %s, value %j → %s", (type, value, expected) => {
        expect(isValidConfigurationValue(schema({ type }), value)).toBe(expected);
    });

    it("list of types — any of them fits", () => {
        const kinds = schema({ type: ["object", "array"] });
        expect(isValidConfigurationValue(kinds, { "source.fixAll": true })).toBe(true);
        expect(isValidConfigurationValue(kinds, ["source.fixAll"])).toBe(true);
        expect(isValidConfigurationValue(kinds, "source.fixAll")).toBe(false);
    });

    it("enum accepts only the listed values", () => {
        const wordWrap = schema({ enum: ["off", "on"] });
        expect(isValidConfigurationValue(wordWrap, "on")).toBe(true);
        expect(isValidConfigurationValue(wordWrap, "sometimes")).toBe(false);
    });

    it("minimum and maximum are inclusive", () => {
        const timeout = schema({ type: "number", minimum: 1, maximum: 10 });
        expect(isValidConfigurationValue(timeout, 1)).toBe(true);
        expect(isValidConfigurationValue(timeout, 10)).toBe(true);
        expect(isValidConfigurationValue(timeout, 0)).toBe(false);
        expect(isValidConfigurationValue(timeout, 11)).toBe(false);
        expect(isValidConfigurationValue(schema({ type: "number" }), -5)).toBe(true);
        const limit = schema({ type: "integer", minimum: 1, maximum: 10 });
        expect(isValidConfigurationValue(limit, 1)).toBe(true);
        expect(isValidConfigurationValue(limit, 10)).toBe(true);
        expect(isValidConfigurationValue(limit, 0)).toBe(false);
        expect(isValidConfigurationValue(limit, 11)).toBe(false);
    });
});

describe("sanitizeConfiguration", () => {
    const schemas = new Map<string, IConfigurationPropertySchema>([
        ["editor.tabSize", schema({ type: "number", default: 4, minimum: 1 })],
        ["editor.wordWrap", schema({ enum: ["off", "on"], default: "off" })],
        ["files.exclude", schema({ type: "object", default: { "**/.git": true } })],
    ]);

    it("value outside the schema is replaced by the default; valid and foreign ones stay as is", () => {
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

    it("everything valid — the same model, no rebuild", () => {
        const model = ConfigurationModel.fromRaw({ "editor.tabSize": 2 });

        expect(sanitizeConfiguration(model, schemas)).toBe(model);
    });

    it("integer, as upstream `clampedInt`: a number is clamped into the range and truncated, anything else is the default", () => {
        const ranged = new Map([["a.limit", schema({ type: "integer", default: 500, minimum: 1, maximum: 1000 })]]);
        const open = new Map([["a.limit", schema({ type: "integer", default: 500 })]]);
        const sanitized = (value: unknown, schemas = ranged): unknown =>
            sanitizeConfiguration(ConfigurationModel.fromRaw({ "a.limit": value }), schemas).get("a.limit");

        expect(sanitized(7)).toBe(7);
        expect(sanitized(1)).toBe(1);
        expect(sanitized(1000)).toBe(1000);
        expect(sanitized(0)).toBe(1);
        expect(sanitized(-5)).toBe(1);
        expect(sanitized(2e6)).toBe(1000);
        expect(sanitized(2.7)).toBe(2);
        expect(sanitized(-0.5)).toBe(1);
        // Not `parseInt` of a number: its string form may be exponential.
        expect(sanitized(5e-7)).toBe(1);
        expect(sanitized("42")).toBe(42);
        expect(sanitized("5000")).toBe(1000);
        expect(sanitized("many")).toBe(500);
        expect(sanitized(Number.NaN)).toBe(500);
        expect(sanitized(Number.POSITIVE_INFINITY)).toBe(500);
        expect(sanitized(true)).toBe(500);

        expect(sanitized(-7.9, open)).toBe(-7);
        expect(sanitized("-12", open)).toBe(-12);
    });
});

describe("in-memory service returns schema-validated values", () => {
    it("garbage in the user layer becomes the default, inspect().user is as written", () => {
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

    it("nothing dropped — the same model", () => {
        const model = ConfigurationModel.fromRaw({ "editor.tabSize": 2, "x.y": 1 });
        const result = filterWorkspaceSettings(model, scopes);
        expect(result.model).toBe(model);
        expect(result.excludedKeys).toEqual([]);
    });

    it("drops application/machine without leaving empty ancestors; section siblings stay", () => {
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
        expect(model.get("terminal.tier")).toBe("kitty");
    });

    it("language section with only dropped keys stays as an empty section", () => {
        const result = filterWorkspaceSettings(ConfigurationModel.fromRaw({ "[go]": { "update.mode": "x" } }), scopes);
        expect(result.model.getOverride("go").get("update.mode")).toBeUndefined();
        expect(result.excludedKeys).toEqual(["[go].update.mode"]);
    });

    describe("pickRegisteredSettings", () => {
        it("keeps only registry keys of the requested scope — unregistered and foreign ones go", () => {
            const model = ConfigurationModel.fromRaw({
                "update.mode": "none",
                "terminal.tier": "kitty",
                "editor.tabSize": 2,
                "x.y": 1,
                "[go]": { "update.mode": "manual", "editor.tabSize": 8 },
                "[py]": { "editor.tabSize": 4 },
            });
            const picked = pickRegisteredSettings(model, scopes, ["application"]);
            expect(picked.toRaw()).toEqual({ update: { mode: "none" }, "[go]": { update: { mode: "manual" } } });
            expect(picked.getOverrideIdentifiers()).toEqual(["go"]);
            expect(model.get("x.y")).toBe(1);
        });

        it("nothing to take — empty model", () => {
            const model = ConfigurationModel.fromRaw({ "editor.tabSize": 2, "x.y": 1 });
            expect(pickRegisteredSettings(model, scopes, ["application"])).toBe(ConfigurationModel.EMPTY);
        });
    });
});
