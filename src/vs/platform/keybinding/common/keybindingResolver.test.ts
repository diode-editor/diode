import { describe, expect, it } from "vitest";

import {
    compareKeybindingPriority,
    KeybindingLayerRank,
    KeybindingWeight,
    sortByPriority,
} from "./keybindingResolver.ts";

describe("compareKeybindingPriority", () => {
    it("сначала слой: старший слой сильнее независимо от веса и номера правила", () => {
        expect(
            compareKeybindingPriority({ layer: 2, weight: 0, seq: 0 }, { layer: 1, weight: 900, seq: 9 }),
        ).toBeGreaterThan(0);
        expect(
            compareKeybindingPriority({ layer: 1, weight: 900, seq: 9 }, { layer: 2, weight: 0, seq: 0 }),
        ).toBeLessThan(0);
    });

    it("в слое — вес: тяжёлый сильнее независимо от номера правила", () => {
        expect(
            compareKeybindingPriority({ layer: 0, weight: 100, seq: 0 }, { layer: 0, weight: 0, seq: 9 }),
        ).toBeGreaterThan(0);
        expect(
            compareKeybindingPriority({ layer: 0, weight: 0, seq: 9 }, { layer: 0, weight: 100, seq: 0 }),
        ).toBeLessThan(0);
    });

    it("при равном весе — номер правила: позже зарегистрированное сильнее", () => {
        expect(
            compareKeybindingPriority({ layer: 0, weight: 5, seq: 2 }, { layer: 0, weight: 5, seq: 1 }),
        ).toBeGreaterThan(0);
        expect(
            compareKeybindingPriority({ layer: 0, weight: 5, seq: 1 }, { layer: 0, weight: 5, seq: 2 }),
        ).toBeLessThan(0);
        expect(compareKeybindingPriority({ layer: 0, weight: 5, seq: 1 }, { layer: 0, weight: 5, seq: 1 })).toBe(0);
    });
});

describe("KeybindingLayerRank", () => {
    it("user > extension > default", () => {
        expect(KeybindingLayerRank).toEqual({ default: 0, extension: 1, user: 2 });
    });
});

describe("sortByPriority", () => {
    it("по возрастанию приоритета, устойчиво, исходный массив не трогает", () => {
        const a = { id: "a", layer: 0, weight: 0, seq: 1 };
        const b = { id: "b", layer: 0, weight: 100, seq: 0 };
        const c = { id: "c", layer: 0, weight: 0, seq: 2 };
        const twin = { id: "twin", layer: 0, weight: 0, seq: 2 }; // вариант того же правила (mod → ctrl/cmd)
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
