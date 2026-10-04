import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { registerAction } from "../../../platform/actions/common/commandAction.ts";
import { isSubmenuContribution } from "../../../platform/actions/common/iMenuContribution.ts";
import { CommandRegistry } from "../../../platform/commands/common/commandRegistry.ts";
import { parseWhen, whenKeys } from "../../../platform/contextkey/common/contextKeyExpr.ts";
import type { ServiceAccessor } from "../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { MENU_CONTRIBUTIONS, WORKBENCH_ACTIONS } from "../../workbench.common.main.ts";

import { withMacKeybindings } from "./macKeybindings.ts";

/**
 * Ключи, объявленные в `ContextKeyTypes` (раскомментированные поля интерфейса).
 * Рантайм-списка имён у вычислителя нет и не нужно — источник правды один,
 * интерфейс, и тест читает его как есть, а не дублирует.
 */
function declaredContextKeys(): Set<string> {
    const source = readFileSync(new URL("../../../platform/contextkey/common/contextKeys.ts", import.meta.url), "utf8");
    return new Set([...source.matchAll(/^ {4}(\w+)\??:/gm)].map((match) => match[1]));
}

/** Динамические семейства ключей: свои моды окружения и capability терминала. */
const DYNAMIC_KEY_PREFIXES = ["mode_", "cap_"];

/** Все when-строки встроенных регистраций — так, как их видит вычислитель (с мак-вариантами и `combineWhen`). */
function builtinWhens(): Set<string> {
    const keybindings = new KeybindingRegistry();
    const accessor = {} as ServiceAccessor; // enablement резолвится только при исполнении
    for (const builtin of WORKBENCH_ACTIONS) {
        registerAction(new CommandRegistry(), keybindings, accessor, withMacKeybindings(builtin));
    }
    const whens = new Set<string>();
    const add = (when: string | undefined): void => {
        if (when !== undefined) whens.add(when);
    };
    for (const entry of keybindings.listBindings()) add(entry.when);
    for (const action of WORKBENCH_ACTIONS) add(action.enablement);
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

    it("каждая ссылается только на объявленные ключи (опечатка в when иначе молча даёт false)", () => {
        const declared = declaredContextKeys();
        expect(declared.has("textInputFocus")).toBe(true); // разбор интерфейса жив
        expect(declared.has("editorFocus")).toBe(false); // закомментированные поля — не объявлены
        const unknown = new Set<string>();
        for (const when of builtinWhens()) {
            for (const key of whenKeys(parseWhen(when)!)) {
                if (!declared.has(key) && !DYNAMIC_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)))
                    unknown.add(key);
            }
        }
        expect([...unknown]).toEqual([]);
    });
});
