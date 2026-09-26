import { describe, expect, expectTypeOf, it } from "vitest";

import { ContextKeyService } from "../../contextkey/common/contextKeyService.ts";

import {
    MAC_KEYS_RUNGS,
    macKeysAtLeast,
    macKeysBelow,
    macKeysIs,
    macKeysLevel,
    type MacKeysRung,
    notMacKeys,
} from "./macKeys.ts";

function contextAt(rung: MacKeysRung | undefined): ContextKeyService {
    const contextKeys = new ContextKeyService();
    contextKeys.set("macKeys", macKeysLevel(rung));
    return contextKeys;
}

describe("macKeys", () => {
    it("уровни: 0 — не мак, дальше 1…3 по возрастанию", () => {
        expect(macKeysLevel(undefined)).toBe(0);
        expect(MAC_KEYS_RUNGS.map(macKeysLevel)).toEqual([1, 2, 3]);
    });

    it("хелперы строят when-выражения над числовым ключом", () => {
        expect(macKeysAtLeast("cmd")).toBe("macKeys >= 3");
        expect(macKeysIs("legacy")).toBe("macKeys == 1");
        expect(macKeysBelow("cmd")).toBe("macKeys < 3");
        expect(notMacKeys()).toBe("macKeys < 1");
    });

    // Наследование вверх: объявленное на рунге действует и выше, но не ниже.
    it.each<[MacKeysRung | undefined, Record<string, boolean>]>([
        [undefined, { atLeastLegacy: false, atLeastCmd: false, isExtended: false, belowCmd: true, notMac: true }],
        ["legacy", { atLeastLegacy: true, atLeastCmd: false, isExtended: false, belowCmd: true, notMac: false }],
        ["extended", { atLeastLegacy: true, atLeastCmd: false, isExtended: true, belowCmd: true, notMac: false }],
        ["cmd", { atLeastLegacy: true, atLeastCmd: true, isExtended: false, belowCmd: false, notMac: false }],
    ])("рунг %s", (rung, expected) => {
        const contextKeys = contextAt(rung);
        expect({
            atLeastLegacy: contextKeys.evaluate(macKeysAtLeast("legacy")),
            atLeastCmd: contextKeys.evaluate(macKeysAtLeast("cmd")),
            isExtended: contextKeys.evaluate(macKeysIs("extended")),
            belowCmd: contextKeys.evaluate(macKeysBelow("cmd")),
            notMac: contextKeys.evaluate(notMacKeys()),
        }).toEqual(expected);
    });

    it("невыставленный ключ — не мак: мак-бинды не оживают до выставления окружения", () => {
        const contextKeys = new ContextKeyService();
        expect(contextKeys.evaluate(macKeysAtLeast("legacy"))).toBe(false);
        expect(contextKeys.evaluate(notMacKeys())).toBe(true);
    });

    it("рунг чужого семейства (tier) — ошибка типа, а не соглашение", () => {
        expectTypeOf(macKeysAtLeast).parameter(0).toEqualTypeOf<MacKeysRung>();
        expectTypeOf(macKeysIs).parameter(0).toEqualTypeOf<MacKeysRung>();
        expectTypeOf<"kitty">().not.toExtend<MacKeysRung>();
        expectTypeOf<"csi-u">().not.toExtend<MacKeysRung>();
    });
});
