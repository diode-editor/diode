import { describe, expect, it } from "vitest";

import { requiresExtendedKeys } from "./keybindingPortability.ts";
import { parseChord } from "./keybindingRegistry.ts";

const CASES: readonly [string, boolean][] = [
    ["ctrl+s", false],
    ["alt+enter", false],
    ["alt+backspace", false],
    ["f6", false],
    ["ctrl+k ctrl+u", false],
    ["shift+f6", false],
    // ctrl+shift+<function key>: the key is not a single printable char, so it's portable
    // (the ^…$ anchors in the regex must enforce "exactly one char").
    ["ctrl+shift+f5", false],
    ["ctrl+shift+f12", false],
    // A legacy terminal sends modified arrows as a CSI parameter.
    ["shift+alt+left", false],
    ["ctrl+shift+left", false],
    ["ctrl+shift+p", true],
    ["ctrl+shift+5", true],
    // Shift is indistinguishable under Alt too: events don't tell `ESC F` from `ESC f`.
    ["shift+alt+f", true],
    ["shift+alt+0", true],
    ["shift+space", true],
    ["meta+x", true],
    ["ctrl+enter", true],
    ["shift+enter", true],
    ["ctrl+tab", true],
    ["ctrl+backspace", true],
    ["shift+backspace", true],
    // Shift+Tab is CSI Z (backtab), while Alt+Tab is `ESC 0x09`, i.e. Ctrl+Alt+I.
    ["shift+tab", false],
    ["alt+tab", true],
    ["ctrl+space", false],
    ["alt+[", true],
    ["alt+]", true],
    ["ctrl+[", false],
    ["ctrl+k ctrl+enter", true],
    ["ctrl+k alt+s", false],
];

describe("requiresExtendedKeys", () => {
    for (const [spec, expected] of CASES) {
        it(`${spec} → ${String(expected)}`, () => {
            expect(requiresExtendedKeys(parseChord(spec))).toBe(expected);
        });
    }
});
