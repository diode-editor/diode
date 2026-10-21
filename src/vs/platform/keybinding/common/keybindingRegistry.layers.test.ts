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

describe("KeybindingRegistry: default / extension / user layers", () => {
    it("user beats extension, extension beats default, regardless of registration time", () => {
        const registry = new KeybindingRegistry();
        // The user layer arrives before extensions (that's how bootstrap starts).
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

    it("user `-command` removes the binding of an extension that arrives later", () => {
        const registry = new KeybindingRegistry();
        registry.setUserKeybindings([{ command: "-ext.cmd" }]);
        registry.setExtensionKeybindings([{ command: "ext.cmd", chord: parseChord("ctrl+i") }]);
        expect(resolve(registry)).toBeUndefined();
    });

    it("an extension `-command` removes the default but not a user binding of the same command", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+i"), "cmd");
        registry.setUserKeybindings([{ command: "cmd", chord: parseChord("ctrl+alt+i") }]);
        registry.setExtensionKeybindings([{ command: "-cmd" }]);

        expect(resolve(registry)).toBeUndefined();
        expect(commands(registry)).toEqual(["user:cmd"]);
    });

    it("user `-command` does not remove the command's own user bindings", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+s"), "cmd");
        registry.setUserKeybindings([{ command: "cmd", chord: parseChord("ctrl+i") }, { command: "-cmd" }]);
        expect(resolve(registry)).toBe("cmd");
        expect(commands(registry)).toEqual(["user:cmd"]);
    });

    it("removal when: only entries whose when contains all its conditions are removed", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+i"), "cmd", "(textInputFocus) && (!editorReadonly)");
        registry.register(parseKeybinding("ctrl+alt+i"), "cmd", "listFocus");
        registry.setUserKeybindings([{ command: "-cmd", when: "!editorReadonly && textInputFocus" }]);

        expect(registry.listBindings().map((entry) => entry.when)).toEqual(["listFocus"]);
        // A broken removal when is matched as a string, and removes nothing.
        registry.setUserKeybindings([{ command: "-cmd", when: "listFocus &&" }]);
        expect(registry.listBindings()).toHaveLength(2);
        registry.setUserKeybindings([{ command: "-cmd", when: " listFocus " }]);
        expect(registry.listBindings().map((entry) => entry.when)).toEqual(["(textInputFocus) && (!editorReadonly)"]);
    });

    it("removal when is a subset of the entry's conditions: extra entry conditions do not matter, missing ones do", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+i"), "cmd", "a && b && c");
        registry.register(parseKeybinding("ctrl+alt+i"), "cmd", "a && b");
        // `a && x`: no entry has condition x, so none is removed.
        registry.setUserKeybindings([{ command: "-cmd", when: "a && x" }]);
        expect(registry.listBindings()).toHaveLength(2);
        // `c && a`: contained only in the first (the nested conjunction is flattened).
        registry.setUserKeybindings([{ command: "-cmd", when: "c && a" }]);
        expect(registry.listBindings().map((entry) => entry.when)).toEqual(["a && b"]);
    });

    it("a removal with a keybinding removes only that one; an entry without when is not removed by a removal with when", () => {
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

    it("a layer change restores removed defaults at their former priority (not at the end)", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+i"), "first");
        registry.register(parseKeybinding("ctrl+i"), "second");
        registry.setUserKeybindings([{ command: "-second" }]);
        expect(resolve(registry)).toBe("first");
        registry.setUserKeybindings([]);
        expect(resolve(registry)).toBe("second");
    });

    it("a layer binding without a keybinding is skipped; dispose clears the layers", () => {
        const registry = new KeybindingRegistry();
        registry.setUserKeybindings([{ command: "user.cmd" }, { command: "user.ok", chord: parseChord("ctrl+i") }]);
        expect(commands(registry)).toEqual(["user:user.ok"]);
        registry.setExtensionKeybindings([{ command: "ext.cmd", chord: parseChord("ctrl+e") }]);

        registry.dispose();
        expect(registry.listBindings()).toEqual([]);
    });
});
