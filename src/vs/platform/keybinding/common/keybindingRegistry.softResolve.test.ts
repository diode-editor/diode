import { describe, expect, it } from "vitest";

import type { KeyboardEventLike } from "./keybindingRegistry.ts";
import { KeybindingRegistry, parseChord } from "./keybindingRegistry.ts";

function makeEvent(overrides: Partial<KeyboardEventLike> & { key: string }): KeyboardEventLike {
    return { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...overrides };
}

const CTRL_K = makeEvent({ key: "k", ctrlKey: true });

describe("KeybindingRegistry.softResolveKey", () => {
    it("reports a chord prefix without starting the chord", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseChord("ctrl+k s"), "save");

        expect(registry.softResolveKey(CTRL_K).kind).toBe("chord");
        expect(registry.pendingLength).toBe(0);
    });

    it("resolves the continuation of a pending chord and leaves the chord pending", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseChord("ctrl+k s"), "save");
        registry.resolveKey(CTRL_K);

        expect(registry.softResolveKey(makeEvent({ key: "s" }))).toMatchObject({ kind: "command", commandId: "save" });
        expect(registry.pendingLength).toBe(1);
    });

    it("a key that would break the chord leaves it pending", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseChord("ctrl+k s"), "save");
        registry.resolveKey(CTRL_K);

        expect(registry.softResolveKey(makeEvent({ key: "x" })).kind).toBe("none");
        expect(registry.pendingLength).toBe(1);
    });
});
