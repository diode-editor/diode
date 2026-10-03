import { describe, expect, it } from "vitest";

import { ContextKeyService } from "../../contextkey/common/contextKeyService.ts";

import { KeybindingRegistry, parseChord, parseKeybinding } from "./keybindingRegistry.ts";

const CTRL_I = { key: "i", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false };

function resolve(registry: KeybindingRegistry, contextKeys = new ContextKeyService()): string | undefined {
    const resolution = registry.resolveKey(CTRL_I, contextKeys);
    registry.resetPending();
    return resolution.kind === "command" ? resolution.commandId : undefined;
}

function commands(registry: KeybindingRegistry): string[] {
    return registry.listBindings().map((entry) => `${entry.source}:${entry.commandId}`);
}

describe("KeybindingRegistry — слои default / extension / user", () => {
    it("user сильнее extension, extension сильнее default — независимо от момента регистрации", () => {
        const registry = new KeybindingRegistry();
        // Пользовательский слой пришёл раньше расширений (так стартует bootstrap).
        registry.setUserKeybindings([{ command: "user.cmd", chord: parseChord("ctrl+i") }]);
        registry.setExtensionKeybindings([{ command: "ext.cmd", chord: parseChord("ctrl+i") }]);
        registry.register(parseKeybinding("ctrl+i"), "default.cmd", undefined, "default", undefined, { weight: 900 });

        expect(resolve(registry)).toBe("user.cmd");
        expect(commands(registry)).toEqual(["default:default.cmd", "extension:ext.cmd", "user:user.cmd"]);

        registry.setUserKeybindings([]);
        expect(resolve(registry)).toBe("ext.cmd");
        registry.setExtensionKeybindings([]);
        expect(resolve(registry)).toBe("default.cmd");
    });

    it("user `-command` снимает бинд расширения, пришедшего позже", () => {
        const registry = new KeybindingRegistry();
        registry.setUserKeybindings([{ command: "-ext.cmd" }]);
        registry.setExtensionKeybindings([{ command: "ext.cmd", chord: parseChord("ctrl+i") }]);
        expect(resolve(registry)).toBeUndefined();
    });

    it("`-command` расширения снимает дефолт, но не user-бинд той же команды", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+i"), "cmd");
        registry.setUserKeybindings([{ command: "cmd", chord: parseChord("ctrl+alt+i") }]);
        registry.setExtensionKeybindings([{ command: "-cmd" }]);

        expect(resolve(registry)).toBeUndefined();
        expect(commands(registry)).toEqual(["user:cmd"]);
    });

    it("user `-command` не снимает собственные user-бинды команды", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+s"), "cmd");
        registry.setUserKeybindings([{ command: "cmd", chord: parseChord("ctrl+i") }, { command: "-cmd" }]);
        expect(resolve(registry)).toBe("cmd");
        expect(commands(registry)).toEqual(["user:cmd"]);
    });

    it("when у снятия: снимаются только записи, чей when содержит все его условия", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+i"), "cmd", "(textInputFocus) && (!editorReadonly)");
        registry.register(parseKeybinding("ctrl+alt+i"), "cmd", "listFocus");
        registry.setUserKeybindings([{ command: "-cmd", when: "!editorReadonly && textInputFocus" }]);

        expect(registry.listBindings().map((entry) => entry.when)).toEqual(["listFocus"]);
        // Битое when снятия сопоставляется строкой — и ничего не снимает.
        registry.setUserKeybindings([{ command: "-cmd", when: "listFocus &&" }]);
        expect(registry.listBindings()).toHaveLength(2);
        registry.setUserKeybindings([{ command: "-cmd", when: " listFocus " }]);
        expect(registry.listBindings().map((entry) => entry.when)).toEqual(["(textInputFocus) && (!editorReadonly)"]);
    });

    it("when снятия — подмножество условий записи: лишние условия записи не мешают, недостающие — мешают", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+i"), "cmd", "a && b && c");
        registry.register(parseKeybinding("ctrl+alt+i"), "cmd", "a && b");
        // `a && x`: условия x у записей нет — не снимается ни одна.
        registry.setUserKeybindings([{ command: "-cmd", when: "a && x" }]);
        expect(registry.listBindings()).toHaveLength(2);
        // `c && a`: содержится только в первой (вложенная конъюнкция раскрыта).
        registry.setUserKeybindings([{ command: "-cmd", when: "c && a" }]);
        expect(registry.listBindings().map((entry) => entry.when)).toEqual(["a && b"]);
    });

    it("снятие с комбинацией снимает только её; запись без when не снимается снятием с when", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+i"), "cmd");
        registry.register(parseKeybinding("ctrl+alt+i"), "cmd");
        registry.setUserKeybindings([
            { command: "-cmd", chord: parseChord("ctrl+alt+i") },
            { command: "-cmd", chord: parseChord("ctrl+i"), when: "textInputFocus" },
        ]);
        expect(resolve(registry)).toBe("cmd");
        expect(registry.listBindings()).toHaveLength(1);
    });

    it("смена слоя возвращает снятые дефолты на прежний приоритет (не в конец)", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+i"), "first");
        registry.register(parseKeybinding("ctrl+i"), "second");
        registry.setUserKeybindings([{ command: "-second" }]);
        expect(resolve(registry)).toBe("first");
        registry.setUserKeybindings([]);
        expect(resolve(registry)).toBe("second");
    });

    it("бинд слоя без комбинации пропускается; dispose очищает слои", () => {
        const registry = new KeybindingRegistry();
        registry.setUserKeybindings([{ command: "user.cmd" }, { command: "user.ok", chord: parseChord("ctrl+i") }]);
        expect(commands(registry)).toEqual(["user:user.ok"]);
        registry.setExtensionKeybindings([{ command: "ext.cmd", chord: parseChord("ctrl+e") }]);

        registry.dispose();
        expect(registry.listBindings()).toEqual([]);
    });
});
