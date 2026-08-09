import { describe, expect, it } from "vitest";

import type { KeyPressEvent } from "./keyEvent.ts";
import { parseInput } from "./parseInput.ts";

/** Helper: create expected event with defaults */
function kp(key: string, raw: string, overrides?: Partial<KeyPressEvent>): KeyPressEvent {
    return {
        type: overrides?.type ?? "keydown",
        key,
        code: overrides?.code ?? key,
        ctrlKey: overrides?.ctrlKey ?? false,
        shiftKey: overrides?.shiftKey ?? false,
        altKey: overrides?.altKey ?? false,
        metaKey: overrides?.metaKey ?? false,
        raw,
    };
}

describe("parseInput", () => {
    // ─── Printable characters ───

    it("parses a single printable character", () => {
        const events = parseInput("a");
        expect(events).toEqual([kp("a", "a", { code: "KeyA" })]);
    });

    it("parses multiple printable characters in one chunk", () => {
        const events = parseInput("hi");
        expect(events).toEqual([kp("h", "h", { code: "KeyH" }), kp("i", "i", { code: "KeyI" })]);
    });

    it("parses space", () => {
        const events = parseInput(" ");
        expect(events).toEqual([kp(" ", " ", { code: "Space" })]);
    });

    it("parses uppercase letter", () => {
        const events = parseInput("A");
        expect(events).toEqual([kp("A", "A", { code: "KeyA" })]);
    });

    it("parses digit", () => {
        const events = parseInput("5");
        expect(events).toEqual([kp("5", "5", { code: "Digit5" })]);
    });

    // ─── Special keys ───

    it("parses Enter (0x0d)", () => {
        const events = parseInput("\x0d");
        expect(events).toEqual([kp("Enter", "\x0d")]);
    });

    it("parses Tab (0x09)", () => {
        const events = parseInput("\x09");
        expect(events).toEqual([kp("Tab", "\x09")]);
    });

    it("parses Backspace (0x7f)", () => {
        const events = parseInput("\x7f");
        expect(events).toEqual([kp("Backspace", "\x7f")]);
    });

    it("parses Escape (0x1b standalone)", () => {
        const events = parseInput("\x1b");
        expect(events).toEqual([kp("Escape", "\x1b")]);
    });

    // ─── Ctrl+letter ───

    it("parses Ctrl+C (0x03)", () => {
        const events = parseInput("\x03");
        expect(events).toEqual([kp("c", "\x03", { ctrlKey: true, code: "KeyC" })]);
    });

    it("parses Ctrl+A (0x01)", () => {
        const events = parseInput("\x01");
        expect(events).toEqual([kp("a", "\x01", { ctrlKey: true, code: "KeyA" })]);
    });

    it("parses Ctrl+Z (0x1a)", () => {
        const events = parseInput("\x1a");
        expect(events).toEqual([kp("z", "\x1a", { ctrlKey: true, code: "KeyZ" })]);
    });

    it("parses Ctrl+Space (0x00)", () => {
        const events = parseInput("\x00");
        expect(events).toEqual([kp(" ", "\x00", { ctrlKey: true, code: "Space" })]);
    });

    // Символьные control-коды: `code` — как в UI Events (Digit6/Slash/…), потому что
    // физических клавиш `Key6`/`Key\` не существует.
    it("parses Ctrl+6 (0x1e)", () => {
        const events = parseInput("\x1e");
        expect(events).toEqual([kp("6", "\x1e", { ctrlKey: true, code: "Digit6" })]);
    });

    it("parses Ctrl+/ (0x1f) and the bracket/backslash control codes", () => {
        expect(parseInput("\x1f")).toEqual([kp("/", "\x1f", { ctrlKey: true, code: "Slash" })]);
        expect(parseInput("\x1c")).toEqual([kp("\\", "\x1c", { ctrlKey: true, code: "Backslash" })]);
        expect(parseInput("\x1d")).toEqual([kp("]", "\x1d", { ctrlKey: true, code: "BracketRight" })]);
    });

    // ─── Mixed input ───

    it("parses mixed input: printable + control", () => {
        const events = parseInput("a\x03b");
        expect(events).toEqual([
            kp("a", "a", { code: "KeyA" }),
            kp("c", "\x03", { ctrlKey: true, code: "KeyC" }),
            kp("b", "b", { code: "KeyB" }),
        ]);
    });

    it("returns empty array for empty input", () => {
        expect(parseInput("")).toEqual([]);
    });

    // ─── CSI sequences: arrow keys ───

    it("parses ArrowUp (\\x1b[A)", () => {
        const events = parseInput("\x1b[A");
        expect(events).toEqual([kp("ArrowUp", "\x1b[A")]);
    });

    it("parses ArrowDown (\\x1b[B)", () => {
        const events = parseInput("\x1b[B");
        expect(events).toEqual([kp("ArrowDown", "\x1b[B")]);
    });

    it("parses ArrowRight (\\x1b[C)", () => {
        const events = parseInput("\x1b[C");
        expect(events).toEqual([kp("ArrowRight", "\x1b[C")]);
    });

    it("parses ArrowLeft (\\x1b[D)", () => {
        const events = parseInput("\x1b[D");
        expect(events).toEqual([kp("ArrowLeft", "\x1b[D")]);
    });

    // ─── CSI sequences: navigation ───

    it("parses Home (\\x1b[H)", () => {
        const events = parseInput("\x1b[H");
        expect(events).toEqual([kp("Home", "\x1b[H")]);
    });

    it("parses End (\\x1b[F)", () => {
        const events = parseInput("\x1b[F");
        expect(events).toEqual([kp("End", "\x1b[F")]);
    });

    it("parses Insert (\\x1b[2~)", () => {
        const events = parseInput("\x1b[2~");
        expect(events).toEqual([kp("Insert", "\x1b[2~")]);
    });

    it("parses Delete (\\x1b[3~)", () => {
        const events = parseInput("\x1b[3~");
        expect(events).toEqual([kp("Delete", "\x1b[3~")]);
    });

    it("parses PageUp (\\x1b[5~)", () => {
        const events = parseInput("\x1b[5~");
        expect(events).toEqual([kp("PageUp", "\x1b[5~")]);
    });

    it("parses PageDown (\\x1b[6~)", () => {
        const events = parseInput("\x1b[6~");
        expect(events).toEqual([kp("PageDown", "\x1b[6~")]);
    });

    // ─── CSI sequences: F-keys ───

    it("parses F5 (\\x1b[15~)", () => {
        const events = parseInput("\x1b[15~");
        expect(events).toEqual([kp("F5", "\x1b[15~")]);
    });

    it("parses F6 (\\x1b[17~)", () => {
        const events = parseInput("\x1b[17~");
        expect(events).toEqual([kp("F6", "\x1b[17~")]);
    });

    it("parses F12 (\\x1b[24~)", () => {
        const events = parseInput("\x1b[24~");
        expect(events).toEqual([kp("F12", "\x1b[24~")]);
    });

    // ─── SS3 sequences: F1–F4 ───

    it("parses F1 (\\x1bOP)", () => {
        const events = parseInput("\x1bOP");
        expect(events).toEqual([kp("F1", "\x1bOP")]);
    });

    it("parses F2 (\\x1bOQ)", () => {
        const events = parseInput("\x1bOQ");
        expect(events).toEqual([kp("F2", "\x1bOQ")]);
    });

    it("parses F3 (\\x1bOR)", () => {
        const events = parseInput("\x1bOR");
        expect(events).toEqual([kp("F3", "\x1bOR")]);
    });

    it("parses F4 (\\x1bOS)", () => {
        const events = parseInput("\x1bOS");
        expect(events).toEqual([kp("F4", "\x1bOS")]);
    });

    // ─── CSI with modifiers ───

    it("parses Ctrl+ArrowUp (\\x1b[1;5A)", () => {
        const events = parseInput("\x1b[1;5A");
        expect(events).toEqual([kp("ArrowUp", "\x1b[1;5A", { ctrlKey: true })]);
    });

    it("parses Shift+ArrowDown (\\x1b[1;2B)", () => {
        const events = parseInput("\x1b[1;2B");
        expect(events).toEqual([kp("ArrowDown", "\x1b[1;2B", { shiftKey: true })]);
    });

    it("parses Alt+ArrowRight (\\x1b[1;3C)", () => {
        const events = parseInput("\x1b[1;3C");
        expect(events).toEqual([kp("ArrowRight", "\x1b[1;3C", { altKey: true })]);
    });

    it("parses Ctrl+Shift+ArrowLeft (\\x1b[1;6D)", () => {
        const events = parseInput("\x1b[1;6D");
        expect(events).toEqual([kp("ArrowLeft", "\x1b[1;6D", { ctrlKey: true, shiftKey: true })]);
    });

    it("parses Ctrl+Delete (\\x1b[3;5~)", () => {
        const events = parseInput("\x1b[3;5~");
        expect(events).toEqual([kp("Delete", "\x1b[3;5~", { ctrlKey: true })]);
    });

    it("parses Shift+F5 (\\x1b[15;2~)", () => {
        const events = parseInput("\x1b[15;2~");
        expect(events).toEqual([kp("F5", "\x1b[15;2~", { shiftKey: true })]);
    });

    // ─── Kitty Keyboard Protocol (CSI u) ───

    it("parses Kitty CSI u: 'a' (\\x1b[97u)", () => {
        const events = parseInput("\x1b[97u");
        expect(events).toEqual([kp("a", "\x1b[97u", { code: "KeyA" })]);
    });

    it("parses Kitty CSI u: Ctrl+a (\\x1b[97;5u)", () => {
        const events = parseInput("\x1b[97;5u");
        expect(events).toEqual([kp("a", "\x1b[97;5u", { ctrlKey: true, code: "KeyA" })]);
    });

    it("parses Kitty CSI u: Shift+a (\\x1b[97;2u)", () => {
        const events = parseInput("\x1b[97;2u");
        expect(events).toEqual([kp("A", "\x1b[97;2u", { shiftKey: true, code: "KeyA" })]);
    });

    // The integrated-terminal toggle (Ctrl+`) is only reachable under CSI-u/Kitty —
    // legacy terminals collapse Ctrl+` to NUL. Pin the parse so the binding stays live.
    it("parses Kitty CSI u: Ctrl+` (\\x1b[96;5u)", () => {
        const events = parseInput("\x1b[96;5u");
        expect(events).toEqual([kp("`", "\x1b[96;5u", { ctrlKey: true, code: "Backquote" })]);
    });

    it("parses Kitty CSI u: Shift+Alt+a (\\x1b[97;4u)", () => {
        const events = parseInput("\x1b[97;4u");
        expect(events).toEqual([kp("A", "\x1b[97;4u", { shiftKey: true, altKey: true, code: "KeyA" })]);
    });

    it("parses Kitty CSI u: Shift+a with shiftedKey sub-parameter (\\x1b[97:65;2u)", () => {
        const events = parseInput("\x1b[97:65;2u");
        expect(events).toEqual([kp("A", "\x1b[97:65;2u", { shiftKey: true, code: "KeyA" })]);
    });

    it("parses Kitty CSI u: Shift+а cyrillic (\\x1b[1072;2u) → key='А'", () => {
        // U+0430 'а' (codepoint 1072) with Shift → U+0410 'А'
        const events = parseInput("\x1b[1072;2u");
        expect(events).toEqual([kp("А", "\x1b[1072;2u", { shiftKey: true, code: "а" })]);
    });

    it("parses Kitty CSI u: Shift+а cyrillic with shiftedKey sub-parameter (\\x1b[1072:1040;2u) → key='А'", () => {
        // shiftedKey=1040 'А'
        const events = parseInput("\x1b[1072:1040;2u");
        expect(events).toEqual([kp("А", "\x1b[1072:1040;2u", { shiftKey: true, code: "а" })]);
    });

    // ─── Kitty CSI u: navigation keys (sent when Kitty flags include 8) ───

    it("parses Kitty CSI u: ArrowLeft (\\x1b[57350u)", () => {
        const events = parseInput("\x1b[57350u");
        expect(events).toEqual([kp("ArrowLeft", "\x1b[57350u")]);
    });

    it("parses Kitty CSI u: Ctrl+Shift+ArrowLeft (\\x1b[57350;6u)", () => {
        const events = parseInput("\x1b[57350;6u");
        expect(events).toEqual([kp("ArrowLeft", "\x1b[57350;6u", { ctrlKey: true, shiftKey: true })]);
    });

    it("parses Kitty CSI u: Ctrl+Shift+ArrowRight (\\x1b[57351;6u)", () => {
        const events = parseInput("\x1b[57351;6u");
        expect(events).toEqual([kp("ArrowRight", "\x1b[57351;6u", { ctrlKey: true, shiftKey: true })]);
    });

    it("parses Kitty CSI u: Ctrl+Shift+Home (\\x1b[57356;6u)", () => {
        const events = parseInput("\x1b[57356;6u");
        expect(events).toEqual([kp("Home", "\x1b[57356;6u", { ctrlKey: true, shiftKey: true })]);
    });

    it("parses Kitty CSI u: Ctrl+Shift+End (\\x1b[57357;6u)", () => {
        const events = parseInput("\x1b[57357;6u");
        expect(events).toEqual([kp("End", "\x1b[57357;6u", { ctrlKey: true, shiftKey: true })]);
    });

    it("parses Kitty CSI u: Shift+Home (\\x1b[57356;2u)", () => {
        const events = parseInput("\x1b[57356;2u");
        expect(events).toEqual([kp("Home", "\x1b[57356;2u", { shiftKey: true })]);
    });

    it("parses Kitty CSI u: Shift+End (\\x1b[57357;2u)", () => {
        const events = parseInput("\x1b[57357;2u");
        expect(events).toEqual([kp("End", "\x1b[57357;2u", { shiftKey: true })]);
    });

    it("parses Kitty CSI u: PageUp (\\x1b[57354u)", () => {
        const events = parseInput("\x1b[57354u");
        expect(events).toEqual([kp("PageUp", "\x1b[57354u")]);
    });

    it("parses Kitty CSI u: PageDown (\\x1b[57355u)", () => {
        const events = parseInput("\x1b[57355u");
        expect(events).toEqual([kp("PageDown", "\x1b[57355u")]);
    });

    it("parses Kitty CSI u: Delete (\\x1b[57349u)", () => {
        const events = parseInput("\x1b[57349u");
        expect(events).toEqual([kp("Delete", "\x1b[57349u")]);
    });

    // ─── Alt+key via ESC prefix ───

    it("parses Alt+a (\\x1ba)", () => {
        const events = parseInput("\x1ba");
        expect(events).toEqual([kp("a", "\x1ba", { altKey: true, code: "KeyA" })]);
    });

    it("parses Alt+Enter (\\x1b\\x0d)", () => {
        const events = parseInput("\x1b\x0d");
        expect(events).toEqual([kp("Enter", "\x1b\x0d", { altKey: true })]);
    });

    it("parses Alt+Backspace (\\x1b\\x7f)", () => {
        const events = parseInput("\x1b\x7f");
        expect(events).toEqual([kp("Backspace", "\x1b\x7f", { altKey: true })]);
    });

    it("parses Alt+Ctrl+C (\\x1b\\x03)", () => {
        const events = parseInput("\x1b\x03");
        expect(events).toEqual([kp("c", "\x1b\x03", { altKey: true, ctrlKey: true, code: "KeyC" })]);
    });

    // ─── Edge cases ───

    it("handles multiple CSI sequences in one chunk", () => {
        const events = parseInput("\x1b[A\x1b[B");
        expect(events).toHaveLength(2);
        expect(events[0].key).toBe("ArrowUp");
        expect(events[1].key).toBe("ArrowDown");
    });

    it("handles CSI sequence followed by printable", () => {
        const events = parseInput("\x1b[Aa");
        expect(events).toHaveLength(2);
        expect(events[0].key).toBe("ArrowUp");
        expect(events[1].key).toBe("a");
    });

    it("handles unknown CSI sequence gracefully", () => {
        // \x1b[99~ — unknown but complete tilde sequence: consumed and dropped, no key events.
        const events = parseInput("\x1b[99~");
        expect(events).toEqual([]);
    });

    it("all default events have type 'keydown'", () => {
        const events = parseInput("abc\x03\x1b[A\x1b\x0d");
        for (const event of events) {
            expect(event.type).toBe("keydown");
        }
    });

    // ─── Kitty event types (keydown/keyup via :eventtype) ───

    it("parses CSI u with explicit press event type :1 as keydown", () => {
        // CSI 97;1:1 u → 'a' press, no modifiers, event type 1 (press)
        const events = parseInput("\x1b[97;1:1u");
        expect(events).toEqual([kp("a", "\x1b[97;1:1u", { type: "keydown", code: "KeyA" })]);
    });

    it("parses CSI u with repeat event type :2 as keydown", () => {
        // CSI 97;1:2 u → 'a' repeat, no modifiers, event type 2 (repeat → keydown, browser-aligned)
        const events = parseInput("\x1b[97;1:2u");
        expect(events).toEqual([kp("a", "\x1b[97;1:2u", { type: "keydown", code: "KeyA" })]);
    });

    it("parses CSI u with release event type :3 as keyup", () => {
        // CSI 97;1:3 u → 'a' release
        const events = parseInput("\x1b[97;1:3u");
        expect(events).toEqual([kp("a", "\x1b[97;1:3u", { type: "keyup", code: "KeyA" })]);
    });

    it("parses CSI letter with release event type :3 as keyup", () => {
        // CSI 1;9:3 C → ArrowRight, Meta, release
        const events = parseInput("\x1b[1;9:3C");
        expect(events).toEqual([kp("ArrowRight", "\x1b[1;9:3C", { type: "keyup", metaKey: true })]);
    });

    it("parses CSI tilde with event type release as keyup", () => {
        // CSI 3;5:3 ~ → Delete, Ctrl, release
        const events = parseInput("\x1b[3;5:3~");
        expect(events).toEqual([kp("Delete", "\x1b[3;5:3~", { type: "keyup", ctrlKey: true })]);
    });

    it("parses CSI u without event type as keydown (default)", () => {
        // CSI 97;5 u → Ctrl+a, no event type → keydown
        const events = parseInput("\x1b[97;5u");
        expect(events).toEqual([kp("a", "\x1b[97;5u", { ctrlKey: true, code: "KeyA" })]);
    });

    // ─── Kitty functional key codepoints ───

    it("parses LEFT_SUPER release (Cmd keyup) — CSI 57444;1:3 u", () => {
        // This is the exact sequence from the user's Cmd+End scenario
        const events = parseInput("\x1b[57444;1:3u");
        expect(events).toEqual([kp("Meta", "\x1b[57444;1:3u", { type: "keyup", code: "MetaLeft" })]);
    });

    it("parses LEFT_SUPER press (Cmd keydown) — CSI 57444;9:1 u", () => {
        // Cmd pressed → modifier 9 (1+Meta), event type 1 (press)
        const events = parseInput("\x1b[57444;9:1u");
        expect(events).toEqual([kp("Meta", "\x1b[57444;9:1u", { type: "keydown", metaKey: true, code: "MetaLeft" })]);
    });

    it("parses LEFT_SHIFT press — CSI 57441;2:1 u", () => {
        const events = parseInput("\x1b[57441;2:1u");
        expect(events).toEqual([
            kp("Shift", "\x1b[57441;2:1u", { type: "keydown", shiftKey: true, code: "ShiftLeft" }),
        ]);
    });

    it("parses LEFT_CONTROL release — CSI 57442;1:3 u", () => {
        const events = parseInput("\x1b[57442;1:3u");
        expect(events).toEqual([kp("Control", "\x1b[57442;1:3u", { type: "keyup", code: "ControlLeft" })]);
    });

    it("parses LEFT_ALT press — CSI 57443;3:1 u", () => {
        const events = parseInput("\x1b[57443;3:1u");
        expect(events).toEqual([kp("Alt", "\x1b[57443;3:1u", { type: "keydown", altKey: true, code: "AltLeft" })]);
    });

    it("parses RIGHT_SUPER release — CSI 57450;1:3 u", () => {
        const events = parseInput("\x1b[57450;1:3u");
        expect(events).toEqual([kp("Meta", "\x1b[57450;1:3u", { type: "keyup", code: "MetaRight" })]);
    });

    it("parses CapsLock via CSI u — CSI 57358 u", () => {
        const events = parseInput("\x1b[57358u");
        expect(events).toEqual([kp("CapsLock", "\x1b[57358u")]);
    });

    it("parses Enter via CSI u with event type — CSI 13;1:3 u (release) as keyup", () => {
        const events = parseInput("\x1b[13;1:3u");
        expect(events).toEqual([kp("Enter", "\x1b[13;1:3u", { type: "keyup" })]);
    });

    it("parses Tab via CSI u with modifiers — CSI 9;5:1 u (Ctrl+Tab press)", () => {
        const events = parseInput("\x1b[9;5:1u");
        expect(events).toEqual([kp("Tab", "\x1b[9;5:1u", { type: "keydown", ctrlKey: true })]);
    });

    it("parses Tab via CSI I with modifiers — CSI 1;5I (Ctrl+Tab)", () => {
        const events = parseInput("\x1b[1;5I");
        expect(events).toEqual([kp("Tab", "\x1b[1;5I", { type: "keydown", ctrlKey: true })]);
    });

    it("parses Tab via xterm modifyOtherKeys — CSI 27;5;9~ (Ctrl+Tab)", () => {
        const events = parseInput("\x1b[27;5;9~");
        expect(events).toEqual([kp("Tab", "\x1b[27;5;9~", { type: "keydown", ctrlKey: true })]);
    });

    it("parses Shift+Ctrl+Tab via xterm modifyOtherKeys — CSI 27;6;9~", () => {
        const events = parseInput("\x1b[27;6;9~");
        expect(events).toEqual([kp("Tab", "\x1b[27;6;9~", { type: "keydown", ctrlKey: true, shiftKey: true })]);
    });

    it("parses Escape via CSI u — CSI 27;1:3 u (release) as keyup", () => {
        const events = parseInput("\x1b[27;1:3u");
        expect(events).toEqual([kp("Escape", "\x1b[27;1:3u", { type: "keyup" })]);
    });

    // ─── Kitty PUA characters via ESC prefix ───

    it("parses ESC + PUA for LEFT_SUPER (Cmd keydown) — \\x1b + U+E064", () => {
        // ESC + PUA is a Kitty protocol encoding, ESC is NOT an Alt modifier.
        // It's a key press → keydown.
        const leftSuper = String.fromCodePoint(57444); // U+E064
        const events = parseInput("\x1b" + leftSuper);
        expect(events).toEqual([kp("Meta", "\x1b" + leftSuper, { type: "keydown", code: "MetaLeft" })]);
    });

    it("parses standalone PUA character for LEFT_SHIFT as keydown", () => {
        const leftShift = String.fromCodePoint(57441);
        const events = parseInput(leftShift);
        expect(events).toEqual([kp("Shift", leftShift, { type: "keydown", code: "ShiftLeft" })]);
    });

    // ─── Full Cmd+End scenario (3 events in one chunk) ───

    it("parses full Cmd+Right sequence: modifier press + key release + modifier release", () => {
        // Simulates what the terminal sends for Cmd+Right with Kitty protocol (flags 11)
        const superDown = "\x1b" + String.fromCodePoint(57444); // ESC + LEFT_SUPER PUA
        const arrowRelease = "\x1b[1;9:3C"; // ArrowRight Meta release
        const superRelease = "\x1b[57444;1:3u"; // LEFT_SUPER release

        const events = parseInput(superDown + arrowRelease + superRelease);
        expect(events).toHaveLength(3);

        // Event 1: LEFT_SUPER keydown (ESC + PUA)
        expect(events[0]).toEqual(kp("Meta", superDown, { type: "keydown", code: "MetaLeft" }));

        // Event 2: ArrowRight + Meta, keyup (no synthesis in pure parseInput)
        expect(events[1]).toEqual(kp("ArrowRight", arrowRelease, { type: "keyup", metaKey: true }));

        // Event 3: LEFT_SUPER release, keyup
        expect(events[2]).toEqual(kp("Meta", superRelease, { type: "keyup", code: "MetaLeft" }));
    });

    // ─── Codepoint sub-parameters (shifted:base) ───

    it("parses CSI u with codepoint sub-parameters (shifted key)", () => {
        // CSI 97:65;2 u → 'a' with shifted value 65 ('A'), Shift modifier → key='A'
        const events = parseInput("\x1b[97:65;2u");
        expect(events).toEqual([kp("A", "\x1b[97:65;2u", { shiftKey: true, code: "KeyA" })]);
    });

    // ─── Key held down (repeat) ───

    it("parses held ArrowDown (repeat) as keydown", () => {
        // CSI 1;1:2 B → ArrowDown, no modifiers, repeat (browser-aligned: keydown auto-repeat)
        const events = parseInput("\x1b[1;1:2B");
        expect(events).toEqual([kp("ArrowDown", "\x1b[1;1:2B", { type: "keydown" })]);
    });

    it("parses held Ctrl+ArrowRight (repeat) as keydown with modifier", () => {
        // CSI 1;5:2 C → ArrowRight, Ctrl, repeat
        const events = parseInput("\x1b[1;5:2C");
        expect(events).toEqual([kp("ArrowRight", "\x1b[1;5:2C", { type: "keydown", ctrlKey: true })]);
    });

    it("parses held Delete (repeat via tilde) as keydown", () => {
        // CSI 3;1:2 ~ → Delete, no modifiers, repeat
        const events = parseInput("\x1b[3;1:2~");
        expect(events).toEqual([kp("Delete", "\x1b[3;1:2~", { type: "keydown" })]);
    });

    // ─── No synthesis in parseInput (it’s pure) ───

    it("does not synthesize keypress — parseInput is a pure parser", () => {
        // ArrowDown: legacy press (ESC[B) + release (ESC[1;1:3B)
        const press = "\x1b[B";
        const release = "\x1b[1;1:3B";
        const events = parseInput(press + release);
        expect(events).toEqual([kp("ArrowDown", press), kp("ArrowDown", release, { type: "keyup" })]);
    });

    it("does not synthesize keypress for standalone keyup", () => {
        // CSI 97;1:3 u (release only)
        const release = "\x1b[97;1:3u";
        const events = parseInput(release);
        expect(events).toEqual([kp("a", release, { type: "keyup", code: "KeyA" })]);
    });
});
