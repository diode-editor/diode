import { describe, expect, it } from "vitest";

import { ContextKeyService } from "../../contextkey/common/contextKeyService.ts";

import { KeybindingRegistry, parseChord, parseKeybinding, serializeChord } from "./keybindingRegistry.ts";
import { KeybindingWeight } from "./keybindingResolver.ts";

const ESCAPE = { key: "Escape", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
const CTRL_K = { key: "k", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false };

function resolve(registry: KeybindingRegistry, event = ESCAPE, contextKeys = new ContextKeyService()): unknown {
    const resolution = registry.resolveKey(event, contextKeys);
    registry.resetPending();
    return resolution.kind === "command" ? resolution.commandId : resolution.kind;
}

describe("KeybindingRegistry: rule weight", () => {
    it("a heavy rule wins over a lighter one registered later", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("escape"), "popup.hide", undefined, "default", undefined, {
            weight: KeybindingWeight.EditorContrib,
        });
        registry.register(parseKeybinding("escape"), "editor.cancel");

        expect(resolve(registry)).toBe("popup.hide");
        // listBindings is in ascending priority: the strongest comes last.
        expect(registry.listBindings().map((entry) => entry.commandId)).toEqual(["editor.cancel", "popup.hide"]);
    });

    it("with equal weight the last registered still wins", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("escape"), "first");
        registry.register(parseKeybinding("escape"), "second");
        expect(resolve(registry)).toBe("second");
    });

    it("the chord label and the command label read the same priority", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseChord("ctrl+k ctrl+x"), "heavy", undefined, "default", undefined, { weight: 1 });
        registry.register(parseChord("ctrl+K ctrl+y"), "light");
        registry.register(parseKeybinding("f9"), "cmd", undefined, "default", undefined, { weight: 1 });
        registry.register(parseKeybinding("f8"), "cmd");

        expect(registry.resolveKey(CTRL_K, new ContextKeyService()).kind).toBe("chord");
        expect(serializeChord(registry.getPendingChord())).toBe("ctrl+k");
        registry.resetPending();
        expect(serializeChord(registry.getKeybindingForCommand("cmd")!)).toBe("f9");
    });
});

describe("KeybindingRegistry: pending chord label", () => {
    it("the only candidate (first entry) gives the canonical label, not the raw event", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseChord("ctrl+k ctrl+y"), "only");
        // Russian layout: the Cyrillic "el" key is physically K, matched by code.
        const event = {
            key: "\u043b" /* "l" */,
            code: "KeyK",
            ctrlKey: true,
            shiftKey: false,
            altKey: false,
            metaKey: false,
        };

        expect(registry.resolveKey(event, new ContextKeyService()).kind).toBe("chord");
        expect(serializeChord(registry.getPendingChord())).toBe("ctrl+k");
    });
});

describe("KeybindingRegistry: the priority cache is invalidated", () => {
    it("a new rule after a read is taken into account", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("escape"), "first");
        expect(resolve(registry)).toBe("first");
        registry.register(parseKeybinding("escape"), "second");
        expect(resolve(registry)).toBe("second");
    });

    it("a rule removed via dispose disappears", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("escape"), "first");
        const second = registry.register(parseKeybinding("escape"), "second");
        expect(resolve(registry)).toBe("second");
        second.dispose();
        expect(resolve(registry)).toBe("first");
        expect(registry.listBindings().map((entry) => entry.commandId)).toEqual(["first"]);
    });

    it("a layer change (removal, then undoing it) is taken into account", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("escape"), "first");
        registry.register(parseKeybinding("escape"), "second");
        expect(resolve(registry)).toBe("second");
        registry.setUserKeybindings([{ command: "-second" }]);
        expect(resolve(registry)).toBe("first");
        registry.setUserKeybindings([]);
        expect(resolve(registry)).toBe("second");
    });

    it("disposing the registry clears the cache too", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("escape"), "first");
        expect(resolve(registry)).toBe("first");
        registry.dispose();
        expect(resolve(registry)).toBe("none");
        expect(registry.listBindings()).toEqual([]);
    });
});
