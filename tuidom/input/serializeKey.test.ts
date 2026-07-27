import { describe, expect, it } from "vitest";

import { parseInput } from "./parseInput.ts";
import { serializeKey } from "./serializeKey.ts";

describe("serializeKey", () => {
    // ─── Basic keys ───

    it("serializes a printable character", () => {
        expect(serializeKey("a")).toBe("a");
    });

    it("serializes Enter", () => {
        expect(serializeKey("Enter")).toBe("\x0d");
    });

    it("serializes Tab", () => {
        expect(serializeKey("Tab")).toBe("\x09");
    });

    it("serializes Backspace", () => {
        expect(serializeKey("Backspace")).toBe("\x7f");
    });

    it("serializes Escape", () => {
        expect(serializeKey("Escape")).toBe("\x1b");
    });

    it("serializes Space", () => {
        expect(serializeKey("Space")).toBe(" ");
    });

    // ─── Ctrl+letter ───

    it("serializes Ctrl+C", () => {
        expect(serializeKey("Ctrl+C")).toBe("\x03");
    });

    it("serializes Ctrl+A", () => {
        expect(serializeKey("Ctrl+A")).toBe("\x01");
    });

    it("serializes Ctrl+Z", () => {
        expect(serializeKey("Ctrl+Z")).toBe("\x1a");
    });

    // ─── Arrow keys ───

    it("serializes ArrowUp", () => {
        expect(serializeKey("ArrowUp")).toBe("\x1b[A");
    });

    it("serializes ArrowDown", () => {
        expect(serializeKey("ArrowDown")).toBe("\x1b[B");
    });

    it("serializes ArrowRight", () => {
        expect(serializeKey("ArrowRight")).toBe("\x1b[C");
    });

    it("serializes ArrowLeft", () => {
        expect(serializeKey("ArrowLeft")).toBe("\x1b[D");
    });

    // ─── Navigation keys ───

    it("serializes Home", () => {
        expect(serializeKey("Home")).toBe("\x1b[H");
    });

    it("serializes End", () => {
        expect(serializeKey("End")).toBe("\x1b[F");
    });

    it("serializes Insert", () => {
        expect(serializeKey("Insert")).toBe("\x1b[2~");
    });

    it("serializes Delete", () => {
        expect(serializeKey("Delete")).toBe("\x1b[3~");
    });

    it("serializes PageUp", () => {
        expect(serializeKey("PageUp")).toBe("\x1b[5~");
    });

    it("serializes PageDown", () => {
        expect(serializeKey("PageDown")).toBe("\x1b[6~");
    });

    // ─── F-keys ───

    it("serializes F1 (SS3)", () => {
        expect(serializeKey("F1")).toBe("\x1bOP");
    });

    it("serializes F4 (SS3)", () => {
        expect(serializeKey("F4")).toBe("\x1bOS");
    });

    it("serializes F5", () => {
        expect(serializeKey("F5")).toBe("\x1b[15~");
    });

    it("serializes F12", () => {
        expect(serializeKey("F12")).toBe("\x1b[24~");
    });

    // ─── Modifiers with special keys ───

    it("serializes Ctrl+ArrowUp", () => {
        expect(serializeKey("Ctrl+ArrowUp")).toBe("\x1b[1;5A");
    });

    it("serializes Shift+ArrowDown", () => {
        expect(serializeKey("Shift+ArrowDown")).toBe("\x1b[1;2B");
    });

    it("serializes Ctrl+Shift+ArrowLeft", () => {
        expect(serializeKey("Ctrl+Shift+ArrowLeft")).toBe("\x1b[1;6D");
    });

    it("serializes Ctrl+Delete", () => {
        expect(serializeKey("Ctrl+Delete")).toBe("\x1b[3;5~");
    });

    it("serializes Ctrl+Tab via Kitty CSI-u", () => {
        expect(serializeKey("Ctrl+Tab")).toBe("\x1b[9;5:1u");
    });

    it("serializes Ctrl+Shift+Tab via Kitty CSI-u", () => {
        expect(serializeKey("Ctrl+Shift+Tab")).toBe("\x1b[9;6:1u");
    });

    it("serializes Alt+a", () => {
        expect(serializeKey("Alt+a")).toBe("\x1ba");
    });

    it("serializes Shift+Tab as backtab (CSI Z, line 100)", () => {
        expect(serializeKey("Shift+Tab")).toBe("\x1b[Z");
    });

    it("serializes Meta+ArrowUp (Meta modifier prefix)", () => {
        // mod = 1 + 8 (meta) = 9
        expect(serializeKey("Meta+ArrowUp")).toBe("\x1b[1;9A");
    });

    it("serializes Ctrl+Shift+Alt+Meta+ArrowUp (all modifier prefixes)", () => {
        // mod = 1 + 1(shift) + 2(alt) + 4(ctrl) + 8(meta) = 16
        expect(serializeKey("Ctrl+Shift+Alt+Meta+ArrowUp")).toBe("\x1b[1;16A");
    });

    it("parses a lone Alt prefix on a CSI key (line 85)", () => {
        // mod = 1 + 2 (Alt) = 3; Home letter = H.
        expect(serializeKey("Alt+Home")).toBe("\x1b[1;3H");
    });

    // ─── Error handling ───

    it("throws on unknown key name", () => {
        expect(() => serializeKey("Ctrl+Shift+a")).toThrow("unknown key name");
    });

    // ─── Meta modifier ───

    it("Meta+ArrowUp encodes the Meta modifier (mod = 9) in CSI form", () => {
        // mod = 1 + 8 (Meta) = 9; letter A = ArrowUp.
        expect(serializeKey("Meta+ArrowUp")).toBe("\x1b[1;9A");
    });

    it("Meta+Delete encodes the Meta modifier in CSI tilde form", () => {
        // Delete = 3; mod = 1 + 8 = 9.
        expect(serializeKey("Meta+Delete")).toBe("\x1b[3;9~");
    });

    // ─── Alt / Meta prefix parsing on CSI keys (lines 65, 85) ───

    it("Alt+ArrowUp parses the Alt prefix and encodes mod=3 (line 85)", () => {
        // mod = 1 + 2 (Alt) = 3; ArrowUp letter = A.
        expect(serializeKey("Alt+ArrowUp")).toBe("\x1b[1;3A");
    });

    it("Ctrl+Alt+ArrowRight combines Ctrl (line 65) and Alt (line 85), mod=7", () => {
        // mod = 1 + 2 (Alt) + 4 (Ctrl) = 7; ArrowRight letter = C.
        expect(serializeKey("Ctrl+Alt+ArrowRight")).toBe("\x1b[1;7C");
    });

    it("Alt+Delete encodes the Alt modifier on a tilde key", () => {
        // Delete = 3; mod = 1 + 2 = 3.
        expect(serializeKey("Alt+Delete")).toBe("\x1b[3;3~");
    });

    it("Ctrl+Alt+Shift+Meta+ArrowDown combines all four modifiers (mod=15)", () => {
        // mod = 1 + 2(shift) + 2(alt)? careful: shift +1, alt +2, ctrl +4, meta +8 → 1+1+2+4+8 = 16
        expect(serializeKey("Ctrl+Alt+Shift+Meta+ArrowDown")).toBe("\x1b[1;16B");
    });

    // ─── Roundtrip with parseInput ───

    describe("roundtrip: serializeKey → parseInput", () => {
        const simpleKeys = [
            { dsl: "a", expectedKey: "a" },
            { dsl: "Z", expectedKey: "Z" },
            { dsl: "Enter", expectedKey: "Enter" },
            { dsl: "Tab", expectedKey: "Tab" },
            { dsl: "Backspace", expectedKey: "Backspace" },
            { dsl: "Escape", expectedKey: "Escape" },
            { dsl: "Space", expectedKey: " " },
            { dsl: "Ctrl+C", expectedKey: "c", ctrlKey: true, altKey: false },
            { dsl: "Ctrl+A", expectedKey: "a", ctrlKey: true },
            { dsl: "Ctrl+Z", expectedKey: "z", ctrlKey: true },
            { dsl: "ArrowUp", expectedKey: "ArrowUp" },
            { dsl: "ArrowDown", expectedKey: "ArrowDown" },
            { dsl: "ArrowLeft", expectedKey: "ArrowLeft" },
            { dsl: "ArrowRight", expectedKey: "ArrowRight" },
            { dsl: "Home", expectedKey: "Home" },
            { dsl: "End", expectedKey: "End" },
            { dsl: "Delete", expectedKey: "Delete" },
            { dsl: "Insert", expectedKey: "Insert" },
            { dsl: "PageUp", expectedKey: "PageUp" },
            { dsl: "PageDown", expectedKey: "PageDown" },
            { dsl: "F1", expectedKey: "F1" },
            { dsl: "F4", expectedKey: "F4" },
            { dsl: "F5", expectedKey: "F5" },
            { dsl: "F12", expectedKey: "F12" },
            { dsl: "Ctrl+ArrowUp", expectedKey: "ArrowUp", ctrlKey: true },
            { dsl: "Shift+ArrowDown", expectedKey: "ArrowDown", shiftKey: true },
            { dsl: "Ctrl+Delete", expectedKey: "Delete", ctrlKey: true, altKey: false },
            { dsl: "Ctrl+Tab", expectedKey: "Tab", ctrlKey: true },
            { dsl: "Ctrl+Shift+Tab", expectedKey: "Tab", ctrlKey: true, shiftKey: true },
        ];

        for (const { dsl, expectedKey, ctrlKey, shiftKey, altKey } of simpleKeys) {
            it(`roundtrip: '${dsl}' → raw → parseInput`, () => {
                const raw = serializeKey(dsl);
                const events = parseInput(raw);
                expect(events).toHaveLength(1);
                expect(events[0].key).toBe(expectedKey);
                if (ctrlKey) expect(events[0].ctrlKey).toBe(true);
                if (shiftKey) expect(events[0].shiftKey).toBe(true);
                if (altKey) expect(events[0].altKey).toBe(true);
                expect(events[0].type).toBe("keydown");
            });
        }
    });
});

describe("serializeKey — ContextMenu (Kitty CSI-u)", () => {
    it("serializes ContextMenu without modifiers", () => {
        expect(serializeKey("ContextMenu")).toBe("\x1b[57363u");
    });

    it("serializes ContextMenu with modifiers", () => {
        expect(serializeKey("Shift+ContextMenu")).toBe("\x1b[57363;2u");
    });
});
