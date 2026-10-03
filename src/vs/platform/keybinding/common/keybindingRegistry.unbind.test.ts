import { describe, expect, it } from "vitest";

import type { KeyboardEventLike } from "./keybindingRegistry.ts";
import { KeybindingRegistry, parseChord, parseKeybinding } from "./keybindingRegistry.ts";

function resolve(registry: KeybindingRegistry, event: KeyboardEventLike): string | undefined {
    const res = registry.resolveKey(event);
    return res.kind === "command" ? res.commandId : undefined;
}

const KEY = (key: string, mods: Partial<KeyboardEventLike> = {}): KeyboardEventLike => ({
    key,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...mods,
});

describe("KeybindingRegistry — снятие бинда правилом `-command`", () => {
    it("removes all bindings for a command when no chord is given", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+s"), "save");
        registry.register(parseChord("ctrl+k s"), "save");

        registry.setUserKeybindings([{ command: "-save" }]);

        expect(resolve(registry, KEY("s", { ctrlKey: true }))).toBeUndefined();
    });

    it("removes only the matching chord when one is given", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+s"), "save");
        registry.register(parseKeybinding("ctrl+alt+s"), "save");

        registry.setUserKeybindings([{ command: "-save", chord: parseChord("ctrl+s") }]);

        expect(resolve(registry, KEY("s", { ctrlKey: true }))).toBeUndefined();
        expect(resolve(registry, KEY("s", { ctrlKey: true, altKey: true }))).toBe("save");
    });

    it("leaves other commands untouched", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+s"), "save");
        registry.register(parseKeybinding("ctrl+s"), "other");

        registry.setUserKeybindings([{ command: "-save" }]);

        // The remaining ctrl+s belongs to "other".
        expect(resolve(registry, KEY("s", { ctrlKey: true }))).toBe("other");
    });

    it("keeps a binding whose chord length differs from the unbind chord", () => {
        const registry = new KeybindingRegistry();
        // A two-part chord for the same command we try to unbind with a one-part chord.
        registry.register(parseChord("ctrl+k s"), "save");

        // Unbind targets a single combination → lengths differ → chord is NOT removed.
        registry.setUserKeybindings([{ command: "-save", chord: parseChord("ctrl+s") }]);

        // The two-part chord still resolves.
        expect(registry.resolveKey(KEY("k", { ctrlKey: true })).kind).toBe("chord");
        expect(resolve(registry, KEY("s"))).toBe("save");
    });
});

describe("KeybindingRegistry.register — disposable", () => {
    it("disposing the same binding twice is a no-op the second time", () => {
        const registry = new KeybindingRegistry();
        const binding = registry.register(parseKeybinding("ctrl+s"), "save");

        binding.dispose();
        expect(resolve(registry, KEY("s", { ctrlKey: true }))).toBeUndefined();

        // Second dispose: the entry is already gone (indexOf === -1), so nothing happens.
        expect(() => {
            binding.dispose();
        }).not.toThrow();
        expect(resolve(registry, KEY("s", { ctrlKey: true }))).toBeUndefined();
    });
});
