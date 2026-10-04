import { describe, expect, it } from "vitest";

import type { IConfigurationNode } from "./configurationRegistry.ts";
import { ConfigurationRegistry } from "./configurationRegistry.ts";

const editorNode: IConfigurationNode = {
    id: "editor",
    properties: {
        "editor.tabSize": { scope: "language-overridable", type: "number", default: 4 },
        "editor.insertSpaces": { scope: "language-overridable", type: "boolean", default: true },
    },
};

const terminalNode: IConfigurationNode = {
    id: "terminal",
    properties: {
        "terminal.tier": { scope: "machine", type: "string", default: "auto", enum: ["auto", "legacy"] },
        "terminal.capabilities": { scope: "machine", type: "object", default: {} },
    },
};

describe("ConfigurationRegistry", () => {
    it("aggregates properties of all nodes by dotted key", () => {
        const registry = new ConfigurationRegistry([editorNode, terminalNode]);
        const props = registry.getConfigurationProperties();
        expect([...props.keys()].sort()).toEqual([
            "editor.insertSpaces",
            "editor.tabSize",
            "terminal.capabilities",
            "terminal.tier",
        ]);
        expect(props.get("terminal.tier")?.enum).toEqual(["auto", "legacy"]);
    });

    it("derives the defaults tree from property defaults", () => {
        const registry = new ConfigurationRegistry([editorNode, terminalNode]);
        expect(registry.getDefaultConfiguration()).toEqual({
            editor: { tabSize: 4, insertSpaces: true },
            terminal: { tier: "auto", capabilities: {} },
        });
    });

    it("registerConfiguration appends a node after construction", () => {
        const registry = new ConfigurationRegistry([editorNode]);
        registry.registerConfiguration(terminalNode);
        expect(registry.getConfigurationProperties().has("terminal.tier")).toBe(true);
    });

    it("throws on a duplicate key registration", () => {
        const registry = new ConfigurationRegistry([editorNode]);
        expect(() => {
            registry.registerConfiguration(editorNode);
        }).toThrow(/already registered/);
    });

    it("builds deep trees for multi-segment keys", () => {
        const registry = new ConfigurationRegistry([
            {
                id: "git",
                properties: { "git.decorations.enabled": { scope: "resource", type: "boolean", default: true } },
            },
        ]);
        expect(registry.getDefaultConfiguration()).toEqual({ git: { decorations: { enabled: true } } });
    });
});

describe("ConfigurationRegistry — настройки расширений", () => {
    it("ключи расширения: дефолт в дереве, владелец и область — в свойствах", () => {
        const registry = new ConfigurationRegistry([editorNode]);

        registry.registerExtensionConfiguration("acme.ruff", {
            "ruff.importStrategy": { default: "fromEnvironment", scope: "resource" },
            "ruff.path": {},
        });

        expect(registry.getDefaultConfiguration()).toEqual({
            editor: { tabSize: 4, insertSpaces: true },
            ruff: { importStrategy: "fromEnvironment" },
        });
        expect(registry.getExtensionConfigurationProperties().get("ruff.importStrategy")).toEqual({
            default: "fromEnvironment",
            scope: "resource",
            extensionId: "acme.ruff",
        });
        // Ключ без дефолта известен, но в дерево дефолтов не попадает (даже
        // `undefined`-значением: toEqual такого не различил бы).
        expect(registry.getExtensionConfigurationProperties().has("ruff.path")).toBe(true);
        expect(Object.keys(registry.getDefaultConfiguration().ruff as object)).toEqual(["importStrategy"]);
        // Схемы ядра (по ним идёт валидация) ключей расширений не содержат.
        expect(registry.getConfigurationProperties().has("ruff.importStrategy")).toBe(false);
    });

    it.each([
        [undefined, "window"],
        ["application", "application"],
        ["machine", "machine"],
        ["machine-overridable", "machine"],
        ["language-overridable", "language-overridable"],
        ["somethingNew", "window"],
    ])("scope %s → %s", (scope, expected) => {
        const registry = new ConfigurationRegistry();
        registry.registerExtensionConfiguration("a.b", { "a.key": { default: 1, scope } });
        expect(registry.getExtensionConfigurationProperties().get("a.key")?.scope).toBe(expected);
    });

    it("дубль ключа ядра или другого расширения — предупреждение и пропуск, не исключение", () => {
        const registry = new ConfigurationRegistry([editorNode]);
        const problems: string[] = [];
        registry.registerExtensionConfiguration("first.ext", { "shared.key": { default: 1 } });

        registry.registerExtensionConfiguration(
            "second.ext",
            { "editor.tabSize": { default: 8 }, "shared.key": { default: 2 }, "own.key": { default: 3 } },
            (message) => problems.push(message),
        );

        expect(problems).toEqual([
            'second.ext: configuration key "editor.tabSize" is already registered by core, skipped',
            'second.ext: configuration key "shared.key" is already registered by first.ext, skipped',
        ]);
        expect(registry.getDefaultConfiguration()).toMatchObject({
            editor: { tabSize: 4 },
            shared: { key: 1 },
            own: { key: 3 },
        });
    });

    it("дубль без колбэка проблем — тихий пропуск, не исключение", () => {
        const registry = new ConfigurationRegistry([editorNode]);

        expect(() => {
            registry.registerExtensionConfiguration("x.ext", { "editor.tabSize": { default: 8 } });
        }).not.toThrow();
        expect(registry.getDefaultConfiguration()).toMatchObject({ editor: { tabSize: 4 } });
    });

    it("переопределения дефолтов — поверх ядра и расширений, позднее главнее", () => {
        const registry = new ConfigurationRegistry([editorNode]);
        registry.registerExtensionConfiguration("acme.ruff", { "ruff.importStrategy": { default: "fromEnvironment" } });

        registry.registerDefaultConfigurations({ "ruff.importStrategy": "useBundled", "editor.tabSize": 2 });
        registry.registerDefaultConfigurations({ "editor.tabSize": 3 });

        expect(registry.getDefaultConfiguration()).toEqual({
            editor: { tabSize: 3, insertSpaces: true },
            ruff: { importStrategy: "useBundled" },
        });
    });
});

describe("ConfigurationRegistry — секции языков в переопределениях дефолтов", () => {
    it("секции одного языка от разных источников сливаются, плоские ключи — заменяются", () => {
        const registry = new ConfigurationRegistry([editorNode]);

        registry.registerDefaultConfigurations({ "[go]": { "editor.insertSpaces": false }, "editor.tabSize": 2 });
        registry.registerDefaultConfigurations({ "[go]": { "editor.tabSize": 8 }, "editor.tabSize": 3 });

        expect(registry.getDefaultConfiguration()).toEqual({
            editor: { tabSize: 3, insertSpaces: true },
            "[go]": { "editor.insertSpaces": false, "editor.tabSize": 8 },
        });
    });

    it("обычный ключ с объектом — заменяется целиком, не сливается", () => {
        const registry = new ConfigurationRegistry();
        registry.registerDefaultConfigurations({ "files.exclude": { "**/a": true } });

        registry.registerDefaultConfigurations({ "files.exclude": { "**/b": true } });

        expect(registry.getDefaultConfiguration()).toEqual({ files: { exclude: { "**/b": true } } });
    });

    it("null в секции языка — заменяет", () => {
        const registry = new ConfigurationRegistry();
        registry.registerDefaultConfigurations({ "[go]": { "editor.tabSize": 8 } });

        registry.registerDefaultConfigurations({ "[go]": null });

        expect(registry.getDefaultConfiguration()).toEqual({ "[go]": null });
    });

    it("не-объект в секции языка — заменяет, а не сливается", () => {
        const registry = new ConfigurationRegistry();
        registry.registerDefaultConfigurations({ "[go]": { "editor.tabSize": 8 } });

        registry.registerDefaultConfigurations({ "[go]": 1 });

        expect(registry.getDefaultConfiguration()).toEqual({ "[go]": 1 });
    });
});
