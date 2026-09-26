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
    it("регистрирует аккорд с when и командой", () => {
        const registry = new KeybindingRegistry();
        registerExtensionKeybindings(
            [ext([{ command: "regionfolder.wrapWithRegion", key: "ctrl+m ctrl+r", when: "editorTextFocus" }])],
            registry,
        );
        const chord = registry.getKeybindingForCommand("regionfolder.wrapWithRegion");
        expect(chord).toBeDefined();
        expect(formatKeybinding(chord!)).toBe("Ctrl+M Ctrl+R");
        // Источник записи — "extension" (колонка Source во вкладке шорткатов).
        const entry = registry.listBindings().find((b) => b.commandId === "regionfolder.wrapWithRegion");
        expect(entry?.source).toBe("extension");
    });

    function contextFor(os: "mac" | "linux" | "windows"): ContextKeyService {
        const contextKeys = new ContextKeyService();
        contextKeys.set("os", os);
        return contextKeys;
    }

    it("платформенный оверрайд mac/win/linux побеждает key — по контекст-ключу os, а не process.platform", () => {
        const registry = new KeybindingRegistry();
        registerExtensionKeybindings([ext([{ command: "cmd", key: "ctrl+a", mac: "meta+a", win: "alt+a" }])], registry);
        expect(formatKeybinding(registry.getKeybindingForCommand("cmd", contextFor("mac"))!)).toBe("Meta+A");
        expect(formatKeybinding(registry.getKeybindingForCommand("cmd", contextFor("linux"))!)).toBe("Ctrl+A");
        expect(formatKeybinding(registry.getKeybindingForCommand("cmd", contextFor("windows"))!)).toBe("Alt+A");
    });

    it("варианты различаются условием os: ОС, уточнённая после старта, переключает активный", () => {
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

    it("одинаковый ключ на всех ОС регистрируется один раз без условия по os", () => {
        const registry = new KeybindingRegistry();
        registerExtensionKeybindings([ext([{ command: "cmd", key: "ctrl+a", linux: "ctrl+a" }])], registry);
        expect(registry.listBindings().map((b) => b.when)).toEqual([undefined]);
    });

    it("оверрайд только для одной ОС без общего key — остальные ОС без привязки", () => {
        const registry = new KeybindingRegistry();
        registerExtensionKeybindings([ext([{ command: "cmd", key: "", mac: "meta+a" }])], registry);
        expect(registry.listBindings().map((b) => b.when)).toEqual(["os == 'mac'"]);
    });

    it("снятие привязки (-command) снимает каждый вариант", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseChord("ctrl+a"), "cmd");
        registry.register(parseChord("meta+a"), "cmd");
        registerExtensionKeybindings([ext([{ command: "-cmd", key: "ctrl+a", mac: "meta+a" }])], registry);
        expect(registry.listBindings()).toEqual([]);
    });

    it("ведущий - в command снимает существующую привязку", () => {
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

    it("пустой/отсутствующий key пропускается без падения", () => {
        const registry = new KeybindingRegistry();
        registerExtensionKeybindings([ext([{ command: "cmd", key: "" }])], registry);
        expect(registry.getKeybindingForCommand("cmd")).toBeUndefined();
    });

    it("сбой применения одного биндинга не роняет остальные (изоляция + лог)", () => {
        const warn = vi.fn();
        const registry = new KeybindingRegistry();
        let calls = 0;
        // Первый register бросает, второй — нормальный.
        const throwingRegistry = {
            register: (...args: Parameters<KeybindingRegistry["register"]>) => {
                calls++;
                if (calls === 1) throw new Error("boom");
                return registry.register(...args);
            },
            removeBindings: registry.removeBindings.bind(registry),
        } as unknown as KeybindingRegistry;

        registerExtensionKeybindings(
            [
                ext([
                    { command: "a", key: "ctrl+a" },
                    { command: "b", key: "ctrl+b" },
                ]),
            ],
            throwingRegistry,
            { warn } as never,
        );
        expect(warn).toHaveBeenCalledOnce();
        expect(registry.getKeybindingForCommand("b")).toBeDefined();
    });

    it("расширение без contributes.keybindings игнорируется", () => {
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
