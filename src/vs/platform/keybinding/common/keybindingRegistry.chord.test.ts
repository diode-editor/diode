import { describe, expect, it } from "vitest";

import { ContextKeyService } from "../../contextkey/common/contextKeyService.ts";

import type { KeyboardEventLike } from "./keybindingRegistry.ts";
import { formatKeybinding, KeybindingRegistry, parseChord, parseKeybinding } from "./keybindingRegistry.ts";

function makeEvent(overrides: Partial<KeyboardEventLike> & { key: string }): KeyboardEventLike {
    return {
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
        ...overrides,
    };
}

describe("parseChord", () => {
    it("parses a single combination as a one-part chord", () => {
        expect(parseChord("ctrl+s")).toEqual([parseKeybinding("ctrl+s")]);
    });

    it("parses a two-part chord", () => {
        expect(parseChord("ctrl+k ctrl+s")).toEqual([parseKeybinding("ctrl+k"), parseKeybinding("ctrl+s")]);
    });

    it("ignores surrounding and repeated whitespace", () => {
        expect(parseChord("  ctrl+k    s  ")).toEqual([parseKeybinding("ctrl+k"), parseKeybinding("s")]);
    });
});

describe("formatKeybinding", () => {
    it("formats a single letter", () => {
        expect(formatKeybinding(parseChord("a"))).toBe("A");
    });

    it("formats modifiers in canonical order", () => {
        expect(formatKeybinding(parseChord("shift+ctrl+p"))).toBe("Ctrl+Shift+P");
    });

    it("formats special keys with friendly names", () => {
        expect(formatKeybinding(parseChord("ctrl+pagedown"))).toBe("Ctrl+PageDown");
        expect(formatKeybinding(parseChord("left"))).toBe("Left");
        expect(formatKeybinding(parseChord("space"))).toBe("Space");
        expect(formatKeybinding(parseChord("ctrl+enter"))).toBe("Ctrl+Enter");
    });

    it("formats a chord as space-separated parts", () => {
        expect(formatKeybinding(parseChord("ctrl+k ctrl+s"))).toBe("Ctrl+K Ctrl+S");
    });

    it("formats Alt and Meta modifiers", () => {
        expect(formatKeybinding(parseChord("alt+x"))).toBe("Alt+X");
        expect(formatKeybinding(parseChord("meta+x"))).toBe("Meta+X");
        expect(formatKeybinding(parseChord("ctrl+shift+alt+meta+k"))).toBe("Ctrl+Shift+Alt+Meta+K");
    });
});

describe("KeybindingRegistry — chords", () => {
    it("returns chord on first part, command on completing second part", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseChord("ctrl+k s"), "save");

        const first = registry.resolveKey(makeEvent({ key: "k", ctrlKey: true }));
        expect(first.kind).toBe("chord");
        if (first.kind === "chord") {
            expect(formatKeybinding(first.chord)).toBe("Ctrl+K");
        }

        const second = registry.resolveKey(makeEvent({ key: "s" }));
        expect(second).toEqual({ kind: "command", commandId: "save" });
    });

    it("cancels the chord and returns none on a non-matching second part", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseChord("ctrl+k s"), "save");

        registry.resolveKey(makeEvent({ key: "k", ctrlKey: true }));
        const second = registry.resolveKey(makeEvent({ key: "x" }));
        expect(second).toEqual({ kind: "none" });

        const again = registry.resolveKey(makeEvent({ key: "k", ctrlKey: true }));
        expect(again.kind).toBe("chord");
    });

    it("breaking a chord consumes the key without firing its standalone binding", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseChord("ctrl+k s"), "save-chord");
        registry.register(parseKeybinding("ctrl+s"), "save-direct");

        expect(registry.resolveKey(makeEvent({ key: "k", ctrlKey: true })).kind).toBe("chord");
        // …then press Ctrl+S (not the chord's "s"): the chord breaks and the key
        // is consumed (matching VS Code) — the standalone Ctrl+S does NOT fire.
        expect(registry.resolveKey(makeEvent({ key: "s", ctrlKey: true }))).toEqual({ kind: "none" });
        expect(registry.pendingLength).toBe(0);
    });

    it("breaking a chord with an unbound key resolves to none and clears pending", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseChord("ctrl+k s"), "save");

        registry.resolveKey(makeEvent({ key: "k", ctrlKey: true }));
        expect(registry.resolveKey(makeEvent({ key: "z", ctrlKey: true }))).toEqual({ kind: "none" });
        expect(registry.pendingLength).toBe(0);
    });

    it("resetPending() cancels an in-progress chord", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseChord("ctrl+k s"), "save");

        registry.resolveKey(makeEvent({ key: "k", ctrlKey: true }));
        registry.resetPending();

        expect(registry.resolveKey(makeEvent({ key: "s" }))).toEqual({ kind: "none" });
    });

    it("a single-key binding wins immediately over a longer chord sharing its prefix", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+k"), "single");
        registry.register(parseChord("ctrl+k s"), "chord");

        expect(registry.resolveKey(makeEvent({ key: "k", ctrlKey: true }))).toEqual({
            kind: "command",
            commandId: "single",
        });
    });

    it("supports three-part chords", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseChord("ctrl+k ctrl+x s"), "deep");

        expect(registry.resolveKey(makeEvent({ key: "k", ctrlKey: true })).kind).toBe("chord");
        expect(registry.resolveKey(makeEvent({ key: "x", ctrlKey: true })).kind).toBe("chord");
        expect(registry.resolveKey(makeEvent({ key: "s" }))).toEqual({ kind: "command", commandId: "deep" });
    });

    it("only advances a chord whose when-condition passes", () => {
        const registry = new KeybindingRegistry();
        const ctx = new ContextKeyService();
        registry.register(parseChord("ctrl+k s"), "save", "textInputFocus");

        expect(registry.resolveKey(makeEvent({ key: "k", ctrlKey: true }), ctx)).toEqual({ kind: "none" });

        ctx.set("textInputFocus", true);
        expect(registry.resolveKey(makeEvent({ key: "k", ctrlKey: true }), ctx).kind).toBe("chord");
        expect(registry.resolveKey(makeEvent({ key: "s" }), ctx)).toEqual({
            kind: "command",
            commandId: "save",
            when: "textInputFocus",
        });
    });

    it("ordinary single combinations still resolve in one step", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+s"), "save");

        expect(registry.resolveKey(makeEvent({ key: "s", ctrlKey: true }))).toEqual({
            kind: "command",
            commandId: "save",
        });
    });
});

describe("KeybindingRegistry.getPendingChord — fallback to raw events", () => {
    it("returns empty when no chord is in progress", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseChord("ctrl+k s"), "save");
        expect(registry.getPendingChord()).toEqual([]);
    });

    it("returns the canonical chord prefix while a chord is pending", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseChord("ctrl+k s"), "save");

        registry.resolveKey(makeEvent({ key: "k", ctrlKey: true }));
        expect(formatKeybinding(registry.getPendingChord())).toBe("Ctrl+K");
    });

    it("skips a longer entry whose prefix does not match the pending events", () => {
        const registry = new KeybindingRegistry();
        // Two distinct chords. We will be mid-way through the second; the first,
        // though longer, must be skipped because its first part (ctrl+a) does
        // not match the pending ctrl+k.
        registry.register(parseChord("ctrl+a ctrl+b ctrl+c"), "unrelated");
        registry.register(parseChord("ctrl+k s"), "save");

        registry.resolveKey(makeEvent({ key: "k", ctrlKey: true }));

        expect(formatKeybinding(registry.getPendingChord())).toBe("Ctrl+K");
    });

    it("falls back to raw pressed events when the matching binding is gone", () => {
        const registry = new KeybindingRegistry();
        const binding = registry.register(parseChord("ctrl+k s"), "save");

        expect(registry.resolveKey(makeEvent({ key: "k", ctrlKey: true })).kind).toBe("chord");
        expect(registry.pendingLength).toBe(1);

        binding.dispose();

        // No registered entry now matches the pending prefix, so getPendingChord
        // must fall back to reconstructing the chord from the raw events.
        const chord = registry.getPendingChord();
        expect(chord).toHaveLength(1);
        expect(chord[0]).toEqual({
            key: "k",
            ctrlKey: true,
            shiftKey: false,
            altKey: false,
            metaKey: false,
        });
    });

    it("skips a longer entry whose when-condition fails while a chord is pending", () => {
        const registry = new KeybindingRegistry();
        const ctx = new ContextKeyService();
        // The actually-active chord the user is walking into (registered first so it
        // is visited LAST in the backward scan).
        registry.register(parseChord("ctrl+k s"), "save");
        // A longer chord sharing the ctrl+k prefix but gated behind a when-clause
        // that is NOT satisfied. Registered last → visited first; its failing
        // when-clause must cause it to be skipped before the lookup reaches "save".
        registry.register(parseChord("ctrl+k ctrl+x s"), "gated", "panelFocus");

        expect(registry.resolveKey(makeEvent({ key: "k", ctrlKey: true }), ctx).kind).toBe("chord");

        expect(formatKeybinding(registry.getPendingChord(ctx))).toBe("Ctrl+K");
    });

    it("skips a longer entry that diverges on a later part of the pending sequence", () => {
        const registry = new KeybindingRegistry();
        // Two 3-part chords sharing only the first part (ctrl+k). We walk two parts
        // deep into the second; the first entry diverges at part 2 (ctrl+x vs ctrl+y).
        registry.register(parseChord("ctrl+k ctrl+x s"), "real");
        // Registered last → visited first in the backward scan; it must be rejected
        // because its second part (ctrl+y) does not match the pending ctrl+x.
        registry.register(parseChord("ctrl+k ctrl+y z w"), "diverging");

        expect(registry.resolveKey(makeEvent({ key: "k", ctrlKey: true })).kind).toBe("chord");
        expect(registry.resolveKey(makeEvent({ key: "x", ctrlKey: true })).kind).toBe("chord");
        expect(registry.pendingLength).toBe(2);

        expect(formatKeybinding(registry.getPendingChord())).toBe("Ctrl+K Ctrl+X");
    });

    it("falls back to raw events when only shorter (non-prefix) entries remain", () => {
        const registry = new KeybindingRegistry();
        const chordBinding = registry.register(parseChord("ctrl+k s"), "save");
        // A shorter, single-part binding that cannot be a prefix of the pending seq.
        registry.register(parseKeybinding("ctrl+x"), "other");

        registry.resolveKey(makeEvent({ key: "k", ctrlKey: true }));
        chordBinding.dispose();

        // Only "ctrl+x" (length 1 <= seq length 1) remains: it is skipped by the
        // length guard, so the raw-events fallback is used.
        expect(formatKeybinding(registry.getPendingChord())).toBe("Ctrl+K");
    });
});
