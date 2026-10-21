import { describe, expect, it, vi } from "vitest";

import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { IKeybindingContribution } from "../../../../platform/extensions/common/iExtensionManifest.ts";
import {
    formatKeybinding,
    KeybindingRegistry,
    parseChord,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { registerExtensionKeybindings } from "./extensionKeybindingContributor.ts";

function ext(keybindings: readonly IKeybindingContribution[]): IExtension {
    return {
        id: "test.kb",
        manifest: {
            name: "kb",
            publisher: "test",
            version: "0.0.1",
            engines: { vscode: "^1.0.0" },
            contributes: { keybindings },
        },
        location: "UserExtensions/test.kb-0.0.1/",
        isBuiltin: false,
    };
}

describe("registerExtensionKeybindings", () => {
    it("registers a chord with when and command", () => {
        const registry = new KeybindingRegistry();
        registerExtensionKeybindings(
            [ext([{ command: "regionfolder.wrapWithRegion", key: "ctrl+m ctrl+r", when: "editorTextFocus" }])],
            registry,
        );
        const chord = registry.getKeybindingForCommand("regionfolder.wrapWithRegion");
        expect(chord).toBeDefined();
        expect(formatKeybinding(chord!)).toBe("Ctrl+M Ctrl+R");
        const entry = registry.listBindings().find((b) => b.commandId === "regionfolder.wrapWithRegion");
        expect(entry?.source).toBe("extension");
    });

    function contextFor(os: "mac" | "linux" | "windows"): ContextKeyService {
        const contextKeys = new ContextKeyService();
        contextKeys.set("os", os);
        return contextKeys;
    }

    it("mac/win/linux platform override beats key — via the os context key, not process.platform", () => {
        const registry = new KeybindingRegistry();
        registerExtensionKeybindings([ext([{ command: "cmd", key: "ctrl+a", mac: "meta+a", win: "alt+a" }])], registry);
        expect(formatKeybinding(registry.getKeybindingForCommand("cmd", contextFor("mac"))!)).toBe("Meta+A");
        expect(formatKeybinding(registry.getKeybindingForCommand("cmd", contextFor("linux"))!)).toBe("Ctrl+A");
        expect(formatKeybinding(registry.getKeybindingForCommand("cmd", contextFor("windows"))!)).toBe("Alt+A");
    });

    it("variants differ by the os condition: an OS refined after startup switches the active one", () => {
        const registry = new KeybindingRegistry();
        registerExtensionKeybindings(
            [ext([{ command: "cmd", key: "ctrl+a", mac: "meta+a", when: "textInputFocus" }])],
            registry,
        );
        const whens = registry.listBindings().map((b) => [formatKeybinding(b.chord), b.when]);
        expect(whens).toEqual([
            ["Meta+A", "(os == 'mac') && (textInputFocus)"],
            ["Ctrl+A", "(os == 'linux' || os == 'windows') && (textInputFocus)"],
        ]);
        const contextKeys = contextFor("linux");
        contextKeys.set("textInputFocus", true);
        const meta = { key: "a", ctrlKey: false, shiftKey: false, altKey: false, metaKey: true };
        expect(registry.resolveKey(meta, contextKeys).kind).toBe("none");
        contextKeys.set("os", "mac");
        expect(registry.resolveKey(meta, contextKeys)).toMatchObject({ kind: "command", commandId: "cmd" });
    });

    it("the same key on all OSes registers once without an os condition", () => {
        const registry = new KeybindingRegistry();
        registerExtensionKeybindings([ext([{ command: "cmd", key: "ctrl+a", linux: "ctrl+a" }])], registry);
        expect(registry.listBindings().map((b) => b.when)).toEqual([undefined]);
    });

    it("override for one OS only without a common key — other OSes get no binding", () => {
        const registry = new KeybindingRegistry();
        const warn = vi.fn();
        registerExtensionKeybindings([ext([{ command: "cmd", key: "", mac: "meta+a" }])], registry, { warn } as never);
        expect(registry.listBindings().map((b) => b.when)).toEqual(["os == 'mac'"]);
        expect(warn).not.toHaveBeenCalled();
    });

    it("unbinding (-command) removes every variant", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseChord("ctrl+a"), "cmd");
        registry.register(parseChord("meta+a"), "cmd");
        registerExtensionKeybindings([ext([{ command: "-cmd", key: "ctrl+a", mac: "meta+a" }])], registry);
        expect(registry.listBindings()).toEqual([]);
    });

    it("leading - in command removes an existing binding", () => {
        const registry = new KeybindingRegistry();
        registry.register(
            [
                { key: "k", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false },
                { key: "s", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false },
            ],
            "editor.action.foo",
        );
        expect(registry.getKeybindingForCommand("editor.action.foo")).toBeDefined();

        registerExtensionKeybindings([ext([{ command: "-editor.action.foo", key: "ctrl+k ctrl+s" }])], registry);
        expect(registry.getKeybindingForCommand("editor.action.foo")).toBeUndefined();
    });

    it("empty/missing key is skipped without throwing", () => {
        const registry = new KeybindingRegistry();
        registerExtensionKeybindings([ext([{ command: "cmd", key: "" }])], registry);
        expect(registry.getKeybindingForCommand("cmd")).toBeUndefined();
    });

    it("a malformed manifest entry does not break the rest (isolation + log)", () => {
        const warn = vi.fn();
        const registry = new KeybindingRegistry();

        registerExtensionKeybindings(
            [
                ext([
                    { command: 42 as unknown as string, key: "ctrl+a" },
                    { command: "b", key: "ctrl+b" },
                ]),
            ],
            registry,
            { warn } as never,
        );
        expect(warn).toHaveBeenCalledOnce();
        expect(registry.getKeybindingForCommand("b")).toBeDefined();
    });

    it("extension without contributes.keybindings is ignored", () => {
        const registry = new KeybindingRegistry();
        const noKb: IExtension = {
            id: "x",
            manifest: { name: "x", publisher: "t", version: "0.0.1", engines: { vscode: "^1.0.0" } },
            location: "UserExtensions/x/",
            isBuiltin: false,
        };
        expect(() => {
            registerExtensionKeybindings([noKb], registry);
        }).not.toThrow();
    });
});
