import { describe, expect, it } from "vitest";

import { registerAction } from "../../../platform/actions/common/commandAction.ts";
import { isSubmenuContribution } from "../../../platform/actions/common/iMenuContribution.ts";
import { CommandRegistry } from "../../../platform/commands/common/commandRegistry.ts";
import {
    type ContextKeyExpression,
    evaluateWhen,
    parseWhen,
    whenKeys,
} from "../../../platform/contextkey/common/contextKeyExpr.ts";
import { registerContextKeys } from "../../../platform/contextkey/common/contextKeys.ts";
import { ContextKeyService } from "../../../platform/contextkey/common/contextKeyService.ts";
import type { ServiceAccessor } from "../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../platform/keybinding/common/keybindingRegistry.ts";

import { builtinActions } from "./builtinActions.ts";
import { withMacKeybindings } from "./macKeybindings.ts";
import { MENU_CONTRIBUTIONS } from "./menuContributions.ts";

/** Все when-строки встроенных регистраций — так, как их видит вычислитель (с мак-вариантами и `combineWhen`). */
function builtinWhens(): Set<string> {
    const keybindings = new KeybindingRegistry();
    const accessor = {} as ServiceAccessor; // enablement резолвится только при исполнении
    for (const builtin of builtinActions) {
        registerAction(new CommandRegistry(), keybindings, accessor, withMacKeybindings(builtin));
    }
    const whens = new Set<string>();
    const add = (when: string | undefined): void => {
        if (when !== undefined) whens.add(when);
    };
    for (const entry of keybindings.listBindings()) add(entry.when);
    for (const action of builtinActions) add(action.enablement);
    for (const item of MENU_CONTRIBUTIONS) {
        add(item.when);
        if (!isSubmenuContribution(item)) {
            add(item.enablement);
            add(item.toggled);
        }
    }
    return whens;
}

describe("when-строки встроенных регистраций", () => {
    it("каждая разбирается парсером (иначе бинд или пункт молча мёртв)", () => {
        const whens = builtinWhens();
        // Сотни строк: гейт должен смотреть на реальный набор, а не на пустой.
        expect(whens.size).toBeGreaterThan(50);
        const broken = [...whens].filter((when) => parseWhen(when) === undefined);
        expect(broken).toEqual([]);
    });

    it("парсер вычисляет их так же, как прежний new Function-вычислитель", () => {
        // Страховка перехода (C7): на каждой встроенной строке и наборе
        // псевдослучайных контекстов оба вычислителя обязаны совпасть.
        let seed = 7;
        const random = (n: number): number => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed % n;
        };
        const NUMBERS = [undefined, 0, 1, 2, 3];
        const SCALARS = [true, false, undefined, "legacy", "csi-u", "kitty", "mac", "linux", "windows", "local"];
        const mismatches: string[] = [];
        for (const when of builtinWhens()) {
            const expr = parseWhen(when)!;
            const keys = whenKeys(expr);
            registerContextKeys(keys); // прежнему вычислителю имя нужно знать заранее
            const numeric = new Set(keys.filter((key) => new RegExp(`${key}\\s*[<>]`).test(when)));
            for (let sample = 0; sample < 32; sample++) {
                const values = new Map<string, boolean | string | number | undefined>();
                for (const key of keys) {
                    const domain = numeric.has(key) ? NUMBERS : SCALARS;
                    values.set(key, domain[random(domain.length)]);
                }
                const legacy = new ContextKeyService();
                for (const [key, value] of values) if (value !== undefined) legacy.setRaw(key, value);
                const expected = legacy.evaluate(when);
                const actual = evaluateWhen(expr, { getValue: (key) => values.get(key) });
                if (actual !== expected) mismatches.push(`${when} @ ${JSON.stringify([...values])}`);
            }
        }
        expect(mismatches).toEqual([]);
    });
});
