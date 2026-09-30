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
