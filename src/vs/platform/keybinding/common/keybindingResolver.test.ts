import { describe, expect, it } from "vitest";

import {
    compareKeybindingPriority,
    KeybindingLayerRank,
    KeybindingWeight,
    sortByPriority,
} from "./keybindingResolver.ts";

describe("compareKeybindingPriority", () => {
    it("layer first: a higher layer wins regardless of weight and rule number", () => {
        expect(
            compareKeybindingPriority({ layer: 2, weight: 0, seq: 0 }, { layer: 1, weight: 900, seq: 9 }),
        ).toBeGreaterThan(0);
        expect(
            compareKeybindingPriority({ layer: 1, weight: 900, seq: 9 }, { layer: 2, weight: 0, seq: 0 }),
        ).toBeLessThan(0);
    });

    it("within a layer, weight: the heavier wins regardless of rule number", () => {
        expect(
            compareKeybindingPriority({ layer: 0, weight: 100, seq: 0 }, { layer: 0, weight: 0, seq: 9 }),
        ).toBeGreaterThan(0);
        expect(
            compareKeybindingPriority({ layer: 0, weight: 0, seq: 9 }, { layer: 0, weight: 100, seq: 0 }),
        ).toBeLessThan(0);
    });

    it("with equal weight, rule number: the later registered wins", () => {
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
    it("ascending by priority, stable, leaves the input array untouched", () => {
        const a = { id: "a", layer: 0, weight: 0, seq: 1 };
        const b = { id: "b", layer: 0, weight: 100, seq: 0 };
        const c = { id: "c", layer: 0, weight: 0, seq: 2 };
        const twin = { id: "twin", layer: 0, weight: 0, seq: 2 }; // a variant of the same rule (mod → ctrl/cmd)
        const input = [b, c, twin, a];

        expect(sortByPriority(input).map((entry) => entry.id)).toEqual(["a", "c", "twin", "b"]);
        expect(input.map((entry) => entry.id)).toEqual(["b", "c", "twin", "a"]);
    });
});

describe("KeybindingWeight", () => {
    it("steps as upstream", () => {
        expect(KeybindingWeight).toEqual({ EditorCore: 0, EditorContrib: 100, WorkbenchContrib: 200 });
    });
});
