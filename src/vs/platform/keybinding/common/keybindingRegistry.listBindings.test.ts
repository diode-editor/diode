import { describe, expect, it } from "vitest";

import { chordsEqual, KeybindingRegistry, parseChord, parseKeybinding } from "./keybindingRegistry.ts";

describe("KeybindingRegistry.listBindings", () => {
    it("returns entries in registration order with chord, command and when", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+s"), "save");
        registry.register(parseChord("ctrl+k ctrl+u"), "hover", "textViewFocus");

        const bindings = registry.listBindings();

        expect(bindings).toHaveLength(2);
        expect(bindings[0].commandId).toBe("save");
        expect(bindings[0].when).toBeUndefined();
        expect(chordsEqual(bindings[0].chord, parseChord("ctrl+s"))).toBe(true);
        expect(bindings[1].commandId).toBe("hover");
        expect(bindings[1].when).toBe("textViewFocus");
        expect(chordsEqual(bindings[1].chord, parseChord("ctrl+k ctrl+u"))).toBe(true);
    });

    it("records the source of each entry, defaulting to \"default\"", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+s"), "save");
        registry.register(parseKeybinding("ctrl+e"), "ext.command", undefined, "extension");
        registry.register(parseKeybinding("ctrl+u"), "user.command", undefined, "user");

        const sources = registry.listBindings().map((entry) => entry.source);

        expect(sources).toEqual(["default", "extension", "user"]);
    });

    it("reflects disposals and removals", () => {
        const registry = new KeybindingRegistry();
        const disposable = registry.register(parseKeybinding("ctrl+s"), "save");
        registry.register(parseKeybinding("ctrl+p"), "palette");

        disposable.dispose();

        expect(registry.listBindings().map((entry) => entry.commandId)).toEqual(["palette"]);
    });
});

describe("KeybindingRegistry.removeBindings — returned snapshots", () => {
    it("returns every removed entry when no chord is given", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+s"), "save");
        registry.register(parseChord("ctrl+k s"), "save", "textViewFocus");
        registry.register(parseKeybinding("ctrl+p"), "palette");

        const removed = registry.removeBindings("save");

        expect(removed).toHaveLength(2);
        expect(removed[0].commandId).toBe("save");
        expect(removed[0].source).toBe("default");
        expect(removed[1].when).toBe("textViewFocus");
        expect(chordsEqual(removed[1].chord, parseChord("ctrl+k s"))).toBe(true);
    });

    it("returns only the entry matching the given chord", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+s"), "save");
        registry.register(parseKeybinding("ctrl+alt+s"), "save");

        const removed = registry.removeBindings("save", parseChord("ctrl+s"));

        expect(removed).toHaveLength(1);
        expect(chordsEqual(removed[0].chord, parseChord("ctrl+s"))).toBe(true);
    });

    it("returns an empty array when nothing matched", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+s"), "save");

        expect(registry.removeBindings("other")).toEqual([]);
    });
});

describe("chordsEqual", () => {
    it("compares keys case-insensitively and modifiers exactly", () => {
        expect(chordsEqual(parseChord("ctrl+s"), [{ key: "S", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false }])).toBe(true);
        expect(chordsEqual(parseChord("ctrl+s"), parseChord("ctrl+shift+s"))).toBe(false);
    });

    it("distinguishes chords of different length", () => {
        expect(chordsEqual(parseChord("ctrl+k"), parseChord("ctrl+k ctrl+s"))).toBe(false);
    });
});
