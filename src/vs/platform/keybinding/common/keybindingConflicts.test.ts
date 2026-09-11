import { describe, expect, it } from "vitest";

import { findConflictingBindings, whenMayOverlap } from "./keybindingConflicts.ts";
import type { IKeybindingEntrySnapshot } from "./keybindingRegistry.ts";
import { parseChord } from "./keybindingRegistry.ts";

function entry(spec: string, commandId: string, when?: string): IKeybindingEntrySnapshot {
    return { chord: parseChord(spec), commandId, when, source: "default" };
}

describe("whenMayOverlap", () => {
    it("отсутствующий when пересекается с любым", () => {
        expect(whenMayOverlap(undefined, undefined)).toBe(true);
        expect(whenMayOverlap(undefined, "textViewFocus")).toBe(true);
        expect(whenMayOverlap("textViewFocus", undefined)).toBe(true);
    });

    it("непустые when сравниваются нормализованной строкой — обе стороны тримятся", () => {
        expect(whenMayOverlap("textViewFocus", "textViewFocus ")).toBe(true);
        // Пробел слева тоже нормализуется (иначе a.trim() не проверен).
        expect(whenMayOverlap("  textViewFocus", "textViewFocus")).toBe(true);
        expect(whenMayOverlap("textViewFocus", "listFocus")).toBe(false);
    });
});

describe("findConflictingBindings", () => {
    it("две записи одной комбинации без when конфликтуют", () => {
        const entries = [entry("ctrl+s", "save"), entry("ctrl+s", "other"), entry("ctrl+p", "palette")];

        expect(findConflictingBindings(entries)).toEqual(new Set([0, 1]));
    });

    it("одинаковый чорд с разными when — не конфликт", () => {
        const entries = [entry("f6", "a", "textViewFocus"), entry("f6", "b", "listFocus")];

        expect(findConflictingBindings(entries)).toEqual(new Set());
    });

    it("when без when — конфликт (глобальный бинд перекрывает контекстный)", () => {
        const entries = [entry("f6", "a", "textViewFocus"), entry("f6", "b")];

        expect(findConflictingBindings(entries)).toEqual(new Set([0, 1]));
    });

    it("chord-префикс — не конфликт: ctrl+k против ctrl+k ctrl+s", () => {
        const entries = [entry("ctrl+k", "a"), entry("ctrl+k ctrl+s", "b")];

        expect(findConflictingBindings(entries)).toEqual(new Set());
    });

    it("эквивалентная запись комбинации ловится через канонизацию serializeChord", () => {
        const entries = [entry("Ctrl+S", "a"), entry("ctrl+s", "b")];

        expect(findConflictingBindings(entries)).toEqual(new Set([0, 1]));
    });

    it("в тройке конфликтуют только пересекающиеся пары", () => {
        const entries = [
            entry("f6", "a", "textViewFocus"),
            entry("f6", "b", "listFocus"),
            entry("f6", "c", "textViewFocus"),
        ];

        expect(findConflictingBindings(entries)).toEqual(new Set([0, 2]));
    });
});
