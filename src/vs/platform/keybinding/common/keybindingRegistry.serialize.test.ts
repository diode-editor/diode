import { describe, expect, it } from "vitest";

import { chordsEqual, parseChord, serializeChord } from "./keybindingRegistry.ts";

// Every spec name from the registry's special-key table (spec → event key value).
const SPECIAL_KEY_SPECS = [
    "enter",
    "escape",
    "tab",
    "backspace",
    "space",
    "up",
    "down",
    "left",
    "right",
    "home",
    "end",
    "pageup",
    "pagedown",
    "delete",
    "insert",
    "f1",
    "f2",
    "f3",
    "f4",
    "f5",
    "f6",
    "f7",
    "f8",
    "f9",
    "f10",
    "f11",
    "f12",
];

describe("serializeChord", () => {
    it("round-trips every special key through parseChord", () => {
        for (const spec of SPECIAL_KEY_SPECS) {
            expect(serializeChord(parseChord(spec))).toBe(spec);
        }
    });

    it("round-trips modified special keys", () => {
        for (const spec of ["ctrl+enter", "shift+tab", "alt+up", "ctrl+shift+pagedown"]) {
            expect(serializeChord(parseChord(spec))).toBe(spec);
        }
    });

    it("orders modifiers canonically regardless of input order", () => {
        expect(serializeChord(parseChord("shift+ctrl+p"))).toBe("ctrl+shift+p");
        expect(serializeChord(parseChord("meta+alt+shift+ctrl+z"))).toBe("ctrl+shift+alt+meta+z");
    });

    it("serializes multi-part chords space-separated", () => {
        expect(serializeChord(parseChord("ctrl+k ctrl+u"))).toBe("ctrl+k ctrl+u");
        expect(serializeChord(parseChord("ctrl+k s"))).toBe("ctrl+k s");
    });

    it("lower-cases keys captured from events (uppercase letter under shift)", () => {
        const chord = [{ key: "S", ctrlKey: true, shiftKey: true, altKey: false, metaKey: false }];
        expect(serializeChord(chord)).toBe("ctrl+shift+s");
    });

    it("passes unknown keys through lower-cased, matching parseKeybinding's normalization", () => {
        const chord = [{ key: "MediaPlayPause", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false }];
        const spec = serializeChord(chord);
        expect(spec).toBe("mediaplaypause");
        // parseChord keeps unknown keys as-is (lower-cased), so the round-trip is stable.
        expect(chordsEqual(parseChord(spec), chord)).toBe(true);
    });
});
