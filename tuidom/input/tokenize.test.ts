import { describe, expect, it } from "vitest";

import type { RawTerminalToken } from "./rawTerminalToken.ts";
import { tokenize } from "./tokenize.ts";

describe("tokenize", () => {
    // ─── CharToken ───

    it("tokenizes printable character as char token", () => {
        const tokens = tokenize("a");
        expect(tokens).toEqual([{ kind: "char", char: "a", codepoint: 97, raw: "a" }]);
    });

    it("tokenizes space as char token", () => {
        const tokens = tokenize(" ");
        expect(tokens).toEqual([{ kind: "char", char: " ", codepoint: 32, raw: " " }]);
    });

    it("tokenizes multiple characters as separate tokens", () => {
        const tokens = tokenize("hi");
        expect(tokens).toHaveLength(2);
        expect(tokens[0]).toMatchObject({ kind: "char", char: "h" });
        expect(tokens[1]).toMatchObject({ kind: "char", char: "i" });
    });

    // ─── SpecialKeyToken ───

    it("tokenizes Enter (0x0d) as special-key", () => {
        const tokens = tokenize("\x0d");
        expect(tokens).toEqual([{ kind: "special-key", key: "Enter", raw: "\x0d" }]);
    });

    it("tokenizes Tab (0x09) as special-key", () => {
        const tokens = tokenize("\x09");
        expect(tokens).toEqual([{ kind: "special-key", key: "Tab", raw: "\x09" }]);
    });

    it("tokenizes Backspace (0x7f) as special-key", () => {
        const tokens = tokenize("\x7f");
        expect(tokens).toEqual([{ kind: "special-key", key: "Backspace", raw: "\x7f" }]);
    });

    // ─── CtrlCharToken ───

    it("tokenizes Ctrl+C (0x03) as ctrl-char", () => {
        const tokens = tokenize("\x03");
        expect(tokens).toEqual([{ kind: "ctrl-char", letter: "c", raw: "\x03" }]);
    });

    it("tokenizes Ctrl+A (0x01) as ctrl-char", () => {
        const tokens = tokenize("\x01");
        expect(tokens).toEqual([{ kind: "ctrl-char", letter: "a", raw: "\x01" }]);
    });

    it("tokenizes Ctrl+Space (0x00) as ctrl-char with space", () => {
        const tokens = tokenize("\x00");
        expect(tokens).toEqual([{ kind: "ctrl-char", letter: " ", raw: "\x00" }]);
    });

    // 0x1c–0x1f — единственные control-коды вне Ctrl+A..Z, что приходят с обычной
    // клавиатуры; раньше они уходили в unknown-byte и не доходили до биндов.
    it("tokenizes Ctrl+6 (0x1e) as ctrl-char with digit", () => {
        expect(tokenize("\x1e")).toEqual([{ kind: "ctrl-char", letter: "6", raw: "\x1e" }]);
    });

    it("tokenizes the remaining 0x1c–0x1f control codes as their symbols", () => {
        expect(tokenize("\x1c")).toEqual([{ kind: "ctrl-char", letter: "\\", raw: "\x1c" }]);
        expect(tokenize("\x1d")).toEqual([{ kind: "ctrl-char", letter: "]", raw: "\x1d" }]);
        expect(tokenize("\x1f")).toEqual([{ kind: "ctrl-char", letter: "/", raw: "\x1f" }]);
    });

    // ─── StandaloneEscToken ───

    it("tokenizes standalone Escape as standalone-esc", () => {
        const tokens = tokenize("\x1b");
        expect(tokens).toEqual([{ kind: "standalone-esc", raw: "\x1b" }]);
    });

    // ─── EscSpecialToken ───

    it("tokenizes ESC+Enter as esc-special Enter", () => {
        const tokens = tokenize("\x1b\x0d");
        expect(tokens).toEqual([{ kind: "esc-special", key: "Enter", raw: "\x1b\x0d" }]);
    });

    it("tokenizes ESC+Backspace as esc-special Backspace", () => {
        const tokens = tokenize("\x1b\x7f");
        expect(tokens).toEqual([{ kind: "esc-special", key: "Backspace", raw: "\x1b\x7f" }]);
    });

    // ─── EscCharToken ───

    it("tokenizes ESC+printable as esc-char (Alt+key)", () => {
        const tokens = tokenize("\x1ba");
        expect(tokens).toEqual([{ kind: "esc-char", char: "a", charCode: 97, raw: "\x1ba" }]);
    });

    // ─── EscControlToken ───

    it("tokenizes ESC+control char as esc-control (Alt+Ctrl+letter)", () => {
        const tokens = tokenize("\x1b\x03");
        expect(tokens).toEqual([{ kind: "esc-control", letter: "c", raw: "\x1b\x03" }]);
    });

    // ─── PuaToken ───

    it("tokenizes standalone PUA character as pua token", () => {
        const leftShift = String.fromCodePoint(57441);
        const tokens = tokenize(leftShift);
        expect(tokens).toEqual([{ kind: "pua", codepoint: 57441, key: "Shift", code: "ShiftLeft", raw: leftShift }]);
    });

    it("tokenizes ESC+PUA character as pua token (not esc-char)", () => {
        const leftSuper = String.fromCodePoint(57444);
        const tokens = tokenize("\x1b" + leftSuper);
        expect(tokens).toEqual([
            { kind: "pua", codepoint: 57444, key: "Meta", code: "MetaLeft", raw: "\x1b" + leftSuper },
        ]);
    });

    // ─── Ss3Token ───

    it("tokenizes SS3 F1 (\\x1bOP) as ss3 token", () => {
        const tokens = tokenize("\x1bOP");
        expect(tokens).toEqual([{ kind: "ss3", finalByte: "P", key: "F1", raw: "\x1bOP" }]);
    });

    it("tokenizes SS3 ArrowUp (\\x1bOA) as ss3 token", () => {
        const tokens = tokenize("\x1bOA");
        expect(tokens).toEqual([{ kind: "ss3", finalByte: "A", key: "ArrowUp", raw: "\x1bOA" }]);
    });

    // ─── CsiLetterToken ───

    it("tokenizes CSI ArrowUp (\\x1b[A) as csi-letter", () => {
        const tokens = tokenize("\x1b[A");
        expect(tokens).toEqual([
            {
                kind: "csi-letter",
                finalByte: "A",
                key: "ArrowUp",
                shiftKey: false,
                altKey: false,
                ctrlKey: false,
                metaKey: false,
                eventType: 0,
                raw: "\x1b[A",
            },
        ]);
    });

    it("tokenizes CSI Ctrl+ArrowUp (\\x1b[1;5A) as csi-letter with modifiers", () => {
        const tokens = tokenize("\x1b[1;5A");
        expect(tokens).toEqual([
            {
                kind: "csi-letter",
                finalByte: "A",
                key: "ArrowUp",
                shiftKey: false,
                altKey: false,
                ctrlKey: true,
                metaKey: false,
                eventType: 0,
                raw: "\x1b[1;5A",
            },
        ]);
    });

    it("tokenizes CSI letter with eventType release (\\x1b[1;9:3C)", () => {
        const tokens = tokenize("\x1b[1;9:3C");
        expect(tokens).toEqual([
            {
                kind: "csi-letter",
                finalByte: "C",
                key: "ArrowRight",
                shiftKey: false,
                altKey: false,
                ctrlKey: false,
                metaKey: true,
                eventType: 3,
                raw: "\x1b[1;9:3C",
            },
        ]);
    });

    it("tokenizes CSI Home (\\x1b[H) as csi-letter", () => {
        const tokens = tokenize("\x1b[H");
        expect(tokens).toMatchObject([{ kind: "csi-letter", key: "Home", finalByte: "H" }]);
    });

    // ─── CsiTildeToken ───

    it("tokenizes CSI Delete (\\x1b[3~) as csi-tilde", () => {
        const tokens = tokenize("\x1b[3~");
        expect(tokens).toEqual([
            {
                kind: "csi-tilde",
                number: 3,
                key: "Delete",
                shiftKey: false,
                altKey: false,
                ctrlKey: false,
                metaKey: false,
                eventType: 0,
                raw: "\x1b[3~",
            },
        ]);
    });

    it("tokenizes CSI F5 (\\x1b[15~) as csi-tilde", () => {
        const tokens = tokenize("\x1b[15~");
        expect(tokens).toMatchObject([{ kind: "csi-tilde", number: 15, key: "F5" }]);
    });

    it("tokenizes CSI tilde with modifiers and eventType (\\x1b[3;5:3~)", () => {
        const tokens = tokenize("\x1b[3;5:3~");
        expect(tokens).toEqual([
            {
                kind: "csi-tilde",
                number: 3,
                key: "Delete",
                shiftKey: false,
                altKey: false,
                ctrlKey: true,
                metaKey: false,
                eventType: 3,
                raw: "\x1b[3;5:3~",
            },
        ]);
    });

    it("tokenizes xterm modifyOtherKeys Ctrl+Tab (\\x1b[27;5;9~) as csi-tilde", () => {
        const tokens = tokenize("\x1b[27;5;9~");
        expect(tokens).toEqual([
            {
                kind: "csi-tilde",
                number: 27,
                key: "Tab",
                shiftKey: false,
                altKey: false,
                ctrlKey: true,
                metaKey: false,
                eventType: 0,
                raw: "\x1b[27;5;9~",
            },
        ]);
    });

    // ─── CsiUToken ───

    it("tokenizes basic CSI u 'a' (\\x1b[97u) as csi-u", () => {
        const tokens = tokenize("\x1b[97u");
        expect(tokens).toEqual([
            {
                kind: "csi-u",
                codepoint: 97,
                shiftedKey: undefined,
                baseLayoutKey: undefined,
                key: "a",
                code: "KeyA",
                shiftKey: false,
                altKey: false,
                ctrlKey: false,
                metaKey: false,
                eventType: 0,
                raw: "\x1b[97u",
            },
        ]);
    });

    it("maps Kitty functional codepoint 57362 to Pause (line 200)", () => {
        const tokens = tokenize("\x1b[57362u");
        expect(tokens).toMatchObject([
            {
                kind: "csi-u",
                codepoint: 57362,
                key: "Pause",
            },
        ]);
    });

    it("maps Kitty functional codepoint 57361 to PrintScreen", () => {
        const tokens = tokenize("\x1b[57361u");
        expect(tokens).toMatchObject([{ kind: "csi-u", codepoint: 57361, key: "PrintScreen" }]);
    });

    it("maps Kitty functional codepoint 57363 to ContextMenu", () => {
        const tokens = tokenize("\x1b[57363u");
        expect(tokens).toMatchObject([{ kind: "csi-u", codepoint: 57363, key: "ContextMenu" }]);
    });

    it("tokenizes CSI u Ctrl+a (\\x1b[97;5u) with modifiers", () => {
        const tokens = tokenize("\x1b[97;5u");
        expect(tokens).toMatchObject([
            {
                kind: "csi-u",
                codepoint: 97,
                key: "a",
                ctrlKey: true,
                shiftKey: false,
                altKey: false,
                metaKey: false,
                eventType: 0,
            },
        ]);
    });

    it("tokenizes CSI u with shifted key sub-parameter (\\x1b[97:65;2u)", () => {
        const tokens = tokenize("\x1b[97:65;2u");
        expect(tokens).toMatchObject([
            {
                kind: "csi-u",
                codepoint: 97,
                shiftedKey: 65,
                baseLayoutKey: undefined,
                key: "a",
                shiftKey: true,
            },
        ]);
    });

    it("tokenizes CSI u with event type release (\\x1b[97;1:3u)", () => {
        const tokens = tokenize("\x1b[97;1:3u");
        expect(tokens).toMatchObject([
            {
                kind: "csi-u",
                codepoint: 97,
                key: "a",
                eventType: 3,
            },
        ]);
    });

    it("tokenizes CSI u with event type repeat (\\x1b[97;1:2u)", () => {
        const tokens = tokenize("\x1b[97;1:2u");
        expect(tokens).toMatchObject([
            {
                kind: "csi-u",
                codepoint: 97,
                eventType: 2,
            },
        ]);
    });

    it("tokenizes CSI u with baseLayoutKey — uses it for code (Ctrl+с Russian = \\x1b[1089::115;5u)", () => {
        // Kitty flag 4 (alternate keys): codepoint=1089 (с), shiftedKey=none, baseLayoutKey=115 (s)
        const tokens = tokenize("\x1b[1089::115;5u");
        expect(tokens).toMatchObject([
            {
                kind: "csi-u",
                codepoint: 1089,
                baseLayoutKey: 115,
                key: "\u0441",
                code: "KeyS", // inferred from baseLayoutKey, not from codepoint
                ctrlKey: true,
            },
        ]);
    });

    it("tokenizes CSI u without baseLayoutKey — code is inferred from key (\\x1b[115;5u = Ctrl+s)", () => {
        const tokens = tokenize("\x1b[115;5u");
        expect(tokens).toMatchObject([
            {
                kind: "csi-u",
                codepoint: 115,
                baseLayoutKey: undefined,
                key: "s",
                code: "KeyS",
                ctrlKey: true,
            },
        ]);
    });

    it("tokenizes CSI u LEFT_SUPER release (\\x1b[57444;1:3u) as csi-u with kitty key", () => {
        const tokens = tokenize("\x1b[57444;1:3u");
        expect(tokens).toEqual([
            {
                kind: "csi-u",
                codepoint: 57444,
                shiftedKey: undefined,
                baseLayoutKey: undefined,
                key: "Meta",
                code: "MetaLeft",
                shiftKey: false,
                altKey: false,
                ctrlKey: false,
                metaKey: false,
                eventType: 3,
                raw: "\x1b[57444;1:3u",
            },
        ]);
    });

    it("tokenizes CSI u CapsLock (\\x1b[57358u) as csi-u", () => {
        const tokens = tokenize("\x1b[57358u");
        expect(tokens).toMatchObject([
            {
                kind: "csi-u",
                codepoint: 57358,
                key: "CapsLock",
            },
        ]);
    });

    it("tokenizes CSI u Enter release (\\x1b[13;1:3u)", () => {
        const tokens = tokenize("\x1b[13;1:3u");
        expect(tokens).toMatchObject([
            {
                kind: "csi-u",
                codepoint: 13,
                key: "Enter",
                eventType: 3,
            },
        ]);
    });

    // ─── UnknownByteToken ───

    it("tokenizes unknown control byte as unknown-byte", () => {
        const tokens = tokenize("\x02");
        // 0x02 is Ctrl+B, should be ctrl-char
        expect(tokens).toEqual([{ kind: "ctrl-char", letter: "b", raw: "\x02" }]);
    });

    // ─── Mixed input ───

    it("tokenizes mixed input as separate tokens preserving order", () => {
        const tokens = tokenize("a\x03\x1b[A");
        expect(tokens).toHaveLength(3);
        expect(tokens[0]).toMatchObject({ kind: "char", char: "a" });
        expect(tokens[1]).toMatchObject({ kind: "ctrl-char", letter: "c" });
        expect(tokens[2]).toMatchObject({ kind: "csi-letter", key: "ArrowUp" });
    });

    it("returns empty array for empty input", () => {
        expect(tokenize("")).toEqual([]);
    });

    // ─── Full Cmd+Right scenario (3 tokens in one chunk) ───

    it("tokenizes full Cmd+Right sequence into 3 distinct token types", () => {
        const superDown = "\x1b" + String.fromCodePoint(57444);
        const arrowRelease = "\x1b[1;9:3C";
        const superRelease = "\x1b[57444;1:3u";

        const tokens = tokenize(superDown + arrowRelease + superRelease);
        expect(tokens).toHaveLength(3);

        expect(tokens[0]).toMatchObject({ kind: "pua", codepoint: 57444, key: "Meta", code: "MetaLeft" });
        expect(tokens[1]).toMatchObject({ kind: "csi-letter", key: "ArrowRight", metaKey: true, eventType: 3 });
        expect(tokens[2]).toMatchObject({
            kind: "csi-u",
            codepoint: 57444,
            key: "Meta",
            code: "MetaLeft",
            eventType: 3,
        });
    });

    // ─── Edge cases ───

    it("drops a complete but unrecognized CSI tilde sequence (no text leak)", () => {
        const tokens = tokenize("\x1b[99~");
        expect(tokens).toEqual([{ kind: "unknown-csi", raw: "\x1b[99~" }]);
    });

    it("handles unknown SS3 as standalone-esc", () => {
        const tokens = tokenize("\x1bOZ");
        expect(tokens[0]).toMatchObject({ kind: "standalone-esc" });
    });

    // ─── OSC sequences ───

    it("parses OSC 52 with BEL terminator", () => {
        const tokens = tokenize("\x1b]52;c;aGVsbG8=\x07");
        expect(tokens).toHaveLength(1);
        expect(tokens[0]).toMatchObject({ kind: "osc", code: 52, data: "c;aGVsbG8=" });
    });

    it("parses OSC 52 with ST terminator", () => {
        const tokens = tokenize("\x1b]52;c;aGVsbG8=\x1b\\");
        expect(tokens).toHaveLength(1);
        expect(tokens[0]).toMatchObject({ kind: "osc", code: 52, data: "c;aGVsbG8=" });
    });

    it("parses OSC 52 query response '?'", () => {
        const tokens = tokenize("\x1b]52;c;?\x07");
        expect(tokens).toHaveLength(1);
        expect(tokens[0]).toMatchObject({ kind: "osc", code: 52, data: "c;?" });
    });

    it("emits standalone-esc for incomplete OSC sequence", () => {
        const tokens = tokenize("\x1b]52;c;aGVsbG8=");
        expect(tokens[0]).toMatchObject({ kind: "standalone-esc" });
    });

    it("parses OSC followed by regular input", () => {
        const tokens = tokenize("\x1b]52;c;aGVsbG8=\x07a");
        expect(tokens).toHaveLength(2);
        expect(tokens[0]).toMatchObject({ kind: "osc", code: 52 });
        expect(tokens[1]).toMatchObject({ kind: "char", char: "a" });
    });

    // ─── Device reports (capability-probe responses) ───

    it("parses a Kitty keyboard-flags report (CSI ? flags u) as device-report, not a keypress", () => {
        const tokens = tokenize("\x1b[?15u");
        expect(tokens).toHaveLength(1);
        expect(tokens[0]).toMatchObject({ kind: "device-report", report: "kitty-flags", params: "?15" });
    });

    it("parses a DA1 report (CSI ? attrs c) as device-report", () => {
        const tokens = tokenize("\x1b[?62;1;6c");
        expect(tokens).toHaveLength(1);
        expect(tokens[0]).toMatchObject({ kind: "device-report", report: "da1", params: "?62;1;6" });
    });

    it("parses a Kitty-flags report immediately followed by DA1 (the paired probe reply)", () => {
        const tokens = tokenize("\x1b[?15u\x1b[?62;1;6c");
        expect(tokens).toHaveLength(2);
        expect(tokens[0]).toMatchObject({ kind: "device-report", report: "kitty-flags", params: "?15" });
        expect(tokens[1]).toMatchObject({ kind: "device-report", report: "da1", params: "?62;1;6" });
    });

    it("still parses an ordinary Kitty CSI u key event (no private marker)", () => {
        // 's' = codepoint 115; ensure the device-report guard doesn't swallow real key events.
        const tokens = tokenize("\x1b[115u");
        expect(tokens).toHaveLength(1);
        expect(tokens[0]).toMatchObject({ kind: "csi-u", codepoint: 115 });
    });

    it("parses a device-report followed by regular input", () => {
        const tokens = tokenize("\x1b[?15ua");
        expect(tokens).toHaveLength(2);
        expect(tokens[0]).toMatchObject({ kind: "device-report", report: "kitty-flags" });
        expect(tokens[1]).toMatchObject({ kind: "char", char: "a" });
    });

    // ─── Fallback / edge-case control bytes ───

    it("ESC followed by an unknown low byte (NUL) → standalone-esc, then the byte itself", () => {
        // next byte 0x00 is below the ESC+printable/control ranges → final else branch.
        const tokens = tokenize("\x1b\x00");
        expect(tokens).toHaveLength(2);
        expect(tokens[0]).toEqual({ kind: "standalone-esc", raw: "\x1b" });
        // 0x00 is then tokenized on its own as Ctrl+Space.
        expect(tokens[1]).toEqual({ kind: "ctrl-char", letter: " ", raw: "\x00" });
    });

    it("CSI with an intermediate byte (0x20–0x2f) before the final byte is consumed", () => {
        // ESC [ <SP> A : the space (0x20) is a CSI intermediate byte, 'A' is the final byte.
        const tokens = tokenize("\x1b[ A");
        expect(tokens).toHaveLength(1);
        expect(tokens[0]).toMatchObject({ kind: "csi-letter", key: "ArrowUp", finalByte: "A", raw: "\x1b[ A" });
    });

    it("unrecognized but complete CSI sequence → consumed and dropped as unknown-csi", () => {
        // 'X' is a valid CSI final byte but not in any key/mouse map. The whole sequence is
        // consumed as a single unknown-csi token so its bytes are never typed as literal text.
        const tokens = tokenize("\x1b[1X");
        expect(tokens).toEqual([{ kind: "unknown-csi", raw: "\x1b[1X" }]);
    });
});
