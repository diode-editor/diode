import { describe, expect, it } from "vitest";

import { registerAction } from "../../../platform/actions/common/commandAction.ts";
import { isSubmenuContribution } from "../../../platform/actions/common/iMenuContribution.ts";
import { CommandRegistry } from "../../../platform/commands/common/commandRegistry.ts";
import { parseWhen } from "../../../platform/contextkey/common/contextKeyExpr.ts";
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
});
