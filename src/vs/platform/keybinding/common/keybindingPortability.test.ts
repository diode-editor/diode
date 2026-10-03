import { describe, expect, it } from "vitest";

import { requiresExtendedKeys } from "./keybindingPortability.ts";
import { parseChord } from "./keybindingRegistry.ts";

// Таблица эвристики: spec → требует ли extended keys. Калибрована по разбору
// ввода движка (см. шапку keybindingPortability.ts); таблица фиксирует контракт.
const CASES: readonly [string, boolean][] = [
    ["ctrl+s", false],
    ["alt+enter", false],
    ["alt+backspace", false],
    ["f6", false],
    ["ctrl+k ctrl+u", false],
    ["shift+f6", false],
    // ctrl+shift+<функциональная>: ключ не печатный одиночный — переносимо
    // (якоря ^…$ в регексе обязаны держать «ровно один символ»).
    ["ctrl+shift+f5", false],
    ["ctrl+shift+f12", false],
    // Модифицированные стрелки legacy-терминал шлёт параметром CSI.
    ["shift+alt+left", false],
    ["ctrl+shift+left", false],
    ["ctrl+shift+p", true],
    ["ctrl+shift+5", true],
    // Shift неотличим и под Alt: `ESC F` против `ESC f` события не различают.
    ["shift+alt+f", true],
    ["shift+alt+0", true],
    ["shift+space", true],
    ["meta+x", true],
    ["ctrl+enter", true],
    ["shift+enter", true],
    ["ctrl+tab", true],
    ["ctrl+backspace", true],
    ["shift+backspace", true],
    // Shift+Tab — это CSI Z (backtab), а Alt+Tab — `ESC 0x09`, то есть Ctrl+Alt+I.
    ["shift+tab", false],
    ["alt+tab", true],
    // Ctrl+Space — NUL, отдельный байт.
    ["ctrl+space", false],
    // ESC [ и ESC ] — вводители CSI и OSC.
    ["alt+[", true],
    ["alt+]", true],
    ["ctrl+[", false],
    // Достаточно одной непереносимой части чорда.
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
