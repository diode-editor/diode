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

/** The source of truth is the `ContextKeyTypes` interface itself; the test reads it instead of duplicating it. */
function declaredContextKeys(): Set<string> {
    const source = readFileSync(new URL("../../../platform/contextkey/common/contextKeys.ts", import.meta.url), "utf8");
    return new Set([...source.matchAll(/^ {4}(\w+)\??:/gm)].map((match) => match[1]));
}

/** Dynamic key families: environment modes and terminal capabilities. */
const DYNAMIC_KEY_PREFIXES = ["mode_", "cap_"];

/** As the evaluator sees them: with mac variants and `combineWhen`. */
function builtinWhens(): Set<string> {
    const keybindings = new KeybindingRegistry();
    const accessor = {} as ServiceAccessor; // enablement resolves only on execution
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

describe("when clauses of built-in registrations", () => {
    it("each one parses (otherwise the keybinding or item is silently dead)", () => {
        const whens = builtinWhens();
        expect(whens.size).toBeGreaterThan(50);
        const broken = [...whens].filter((when) => parseWhen(when) === undefined);
        expect(broken).toEqual([]);
    });

    it("each one references only declared keys (otherwise a typo in when silently yields false)", () => {
        const declared = declaredContextKeys();
        expect(declared.has("textInputFocus")).toBe(true); // interface parsing works
        expect(declared.has("editorFocus")).toBe(false); // commented-out fields are not declared
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
