import { describe, expect, it } from "vitest";

import { requiresExtendedKeys } from "./keybindingPortability.ts";
import { parseChord } from "./keybindingRegistry.ts";

// Таблица эвристики: spec → требует ли extended keys. Эвристика честно
// неполная (это предупреждение, не гейт) — таблица фиксирует её контракт.
const CASES: readonly [string, boolean][] = [
    ["ctrl+s", false],
    ["alt+enter", false],
    ["f6", false],
    ["ctrl+k ctrl+u", false],
    ["shift+f6", false],
    // ctrl+shift+<функциональная>: ключ не одиночный alnum — переносимо
    // (якоря ^…$ в регексе обязаны держать «ровно один символ»).
    ["ctrl+shift+f5", false],
    ["ctrl+shift+f12", false],
    ["ctrl+shift+p", true],
    ["ctrl+shift+5", true],
    ["meta+x", true],
    ["ctrl+enter", true],
    ["shift+enter", true],
    ["ctrl+tab", true],
    ["shift+tab", true],
    ["ctrl+space", true],
    ["ctrl+backspace", true],
    // Достаточно одной непереносимой части чорда.
    ["ctrl+k ctrl+enter", true],
];

describe("requiresExtendedKeys", () => {
    for (const [spec, expected] of CASES) {
        it(`${spec} → ${String(expected)}`, () => {
            expect(requiresExtendedKeys(parseChord(spec))).toBe(expected);
        });
    }
});
