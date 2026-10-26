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

    it("a key without a default stays out of the defaults tree", () => {
        const registry = new ConfigurationRegistry([
            {
                id: "editor",
                properties: {
                    "editor.cursorStyle": { scope: "language-overridable", type: "string", enum: ["line", "block"] },
                },
            },
        ]);
        expect(registry.getDefaultConfiguration()).toEqual({});
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

describe("ConfigurationRegistry — extension settings", () => {
    it("extension keys: default in the tree, owner and scope in properties", () => {
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
        // A key without a default is known but stays out of the defaults tree (not even
        // as an `undefined` value: toEqual would not tell them apart).
        expect(registry.getExtensionConfigurationProperties().has("ruff.path")).toBe(true);
        expect(Object.keys(registry.getDefaultConfiguration().ruff as object)).toEqual(["importStrategy"]);
        expect(registry.getConfigurationProperties().has("ruff.importStrategy")).toBe(false);
    });

    it.each([
        [undefined, "window"],
        ["application", "application"],
        ["machine", "machine"],
        // The project may override it, so the workspace layer keeps it.
        ["machine-overridable", "machine-overridable"],
        // For the workspace layer `application-machine` ≡ `application`: user settings only.
        ["application-machine", "application"],
        ["language-overridable", "language-overridable"],
        ["somethingNew", "window"],
    ])("scope %s → %s", (scope, expected) => {
        const registry = new ConfigurationRegistry();
        registry.registerExtensionConfiguration("a.b", { "a.key": { default: 1, scope } });
        expect(registry.getExtensionConfigurationProperties().get("a.key")?.scope).toBe(expected);
    });

    it("duplicate of a core key or another extension's key — warning and skip, not an exception", () => {
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

    it("duplicate without an issue callback — silent skip, not an exception", () => {
        const registry = new ConfigurationRegistry([editorNode]);

        expect(() => {
            registry.registerExtensionConfiguration("x.ext", { "editor.tabSize": { default: 8 } });
        }).not.toThrow();
        expect(registry.getDefaultConfiguration()).toMatchObject({ editor: { tabSize: 4 } });
    });

    it("default overrides — on top of core and extensions, later wins", () => {
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

describe("ConfigurationRegistry — language sections in default overrides", () => {
    it("sections of one language from different sources merge, flat keys are replaced", () => {
        const registry = new ConfigurationRegistry([editorNode]);

        registry.registerDefaultConfigurations({ "[go]": { "editor.insertSpaces": false }, "editor.tabSize": 2 });
        registry.registerDefaultConfigurations({ "[go]": { "editor.tabSize": 8 }, "editor.tabSize": 3 });

        expect(registry.getDefaultConfiguration()).toEqual({
            editor: { tabSize: 3, insertSpaces: true },
            "[go]": { "editor.insertSpaces": false, "editor.tabSize": 8 },
        });
    });

    it("plain key with an object value is replaced as a whole, not merged", () => {
        const registry = new ConfigurationRegistry();
        registry.registerDefaultConfigurations({ "files.exclude": { "**/a": true } });

        registry.registerDefaultConfigurations({ "files.exclude": { "**/b": true } });

        expect(registry.getDefaultConfiguration()).toEqual({ files: { exclude: { "**/b": true } } });
    });

    it("null in a language section replaces", () => {
        const registry = new ConfigurationRegistry();
        registry.registerDefaultConfigurations({ "[go]": { "editor.tabSize": 8 } });

        registry.registerDefaultConfigurations({ "[go]": null });

        expect(registry.getDefaultConfiguration()).toEqual({ "[go]": null });
    });

    it("non-object in a language section replaces rather than merges", () => {
        const registry = new ConfigurationRegistry();
        registry.registerDefaultConfigurations({ "[go]": { "editor.tabSize": 8 } });

        registry.registerDefaultConfigurations({ "[go]": 1 });

        expect(registry.getDefaultConfiguration()).toEqual({ "[go]": 1 });
    });
});

describe("ConfigurationRegistry — scope of all keys", () => {
    it("getConfigurationScopes: core and extensions in one map", () => {
        const registry = new ConfigurationRegistry([
            {
                id: "t",
                properties: {
                    "terminal.tier": { scope: "machine", type: "string", default: "auto" },
                    "editor.tabSize": { scope: "language-overridable", type: "number", default: 4 },
                },
            },
        ]);
        registry.registerExtensionConfiguration("acme.java", {
            "java.home": { scope: "machine-overridable" },
            "java.trace": {},
        });

        expect(Object.fromEntries(registry.getConfigurationScopes())).toEqual({
            "terminal.tier": "machine",
            "editor.tabSize": "language-overridable",
            "java.home": "machine-overridable",
            "java.trace": "window",
        });
    });
});
