import { describe, expect, it } from "vitest";

import { compareKeybindingPriority, KeybindingWeight, sortByPriority } from "./keybindingResolver.ts";

describe("compareKeybindingPriority", () => {
    it("сначала вес: тяжёлый сильнее независимо от номера правила", () => {
        expect(compareKeybindingPriority({ weight: 100, seq: 0 }, { weight: 0, seq: 9 })).toBeGreaterThan(0);
        expect(compareKeybindingPriority({ weight: 0, seq: 9 }, { weight: 100, seq: 0 })).toBeLessThan(0);
    });

    it("при равном весе — номер правила: позже зарегистрированное сильнее", () => {
        expect(compareKeybindingPriority({ weight: 5, seq: 2 }, { weight: 5, seq: 1 })).toBeGreaterThan(0);
        expect(compareKeybindingPriority({ weight: 5, seq: 1 }, { weight: 5, seq: 2 })).toBeLessThan(0);
        expect(compareKeybindingPriority({ weight: 5, seq: 1 }, { weight: 5, seq: 1 })).toBe(0);
    });
});

describe("sortByPriority", () => {
    it("по возрастанию приоритета, устойчиво, исходный массив не трогает", () => {
        const a = { id: "a", weight: 0, seq: 1 };
        const b = { id: "b", weight: 100, seq: 0 };
        const c = { id: "c", weight: 0, seq: 2 };
        const twin = { id: "twin", weight: 0, seq: 2 }; // вариант того же правила (mod → ctrl/cmd)
        const input = [b, c, twin, a];

        expect(sortByPriority(input).map((entry) => entry.id)).toEqual(["a", "c", "twin", "b"]);
        expect(input.map((entry) => entry.id)).toEqual(["b", "c", "twin", "a"]);
    });
});

describe("KeybindingWeight", () => {
    it("ступени как у upstream", () => {
        expect(KeybindingWeight).toEqual({ EditorCore: 0, EditorContrib: 100, WorkbenchContrib: 200 });
    });
});
