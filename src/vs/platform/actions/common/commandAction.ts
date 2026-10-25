import type { IProductIcon } from "../../../base/common/codicons.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { CommandRegistry } from "../../commands/common/commandRegistry.ts";
import { ContextKeyServiceDIToken } from "../../contextkey/common/contextKeyService.ts";
import type { ServiceAccessor } from "../../instantiation/common/diContainer.ts";
import { token } from "../../instantiation/common/diContainer.ts";
import type { Keybinding, KeybindingChord, KeybindingRegistry } from "../../keybinding/common/keybindingRegistry.ts";

import type { MenuId } from "./menuId.ts";

/** Per-binding `when` is AND-ed with the action-wide `when`. */
export interface ConditionalKeybinding {
    readonly keys: Keybinding | KeybindingChord;
    readonly when?: string;
    readonly weight?: number;
}

export type KeybindingEntry = Keybinding | KeybindingChord | ConditionalKeybinding;

/** `IMenuContribution` minus `command` (that is the action id); the `menu` field of VS Code `registerAction2`. */
export interface CommandMenuPlacement {
    readonly menuId: MenuId;
    readonly title?: string;
    readonly when?: string;
    /** Narrows {@link CommandAction.enablement} (AND). */
    readonly enablement?: string;
    readonly visible?: (context: unknown) => boolean;
    readonly toggled?: string;
    readonly group?: string;
    readonly order?: number;
    /** A product icon follows `diode.icons.nerdFont`; a plain string is a literal. */
    readonly icon?: IProductIcon | string;
    readonly args?: (context: unknown) => readonly unknown[];
    /** `false` hides the shortcut; a string is a literal; otherwise it comes from `KeybindingRegistry`. */
    readonly shortcut?: string | false;
}

export interface CommandAction {
    readonly id: string;
    readonly title: string;
    /** Without the category ("File: Copy" → "Copy"): the command palette shows `title`, menus show this. */
    readonly shortTitle?: string;
    readonly keybinding?: KeybindingEntry;
    readonly keybindings?: KeybindingEntry[];
    readonly when?: string;
    /** Defaults to `EditorCore`; on equal weight the later registration wins. */
    readonly weight?: number;
    /** Like VS Code `precondition`: `when` hides the item, this one disables it (the item stays but does not run). */
    readonly enablement?: string;
    readonly menus?: readonly CommandMenuPlacement[];
    run(accessor: ServiceAccessor, ...args: unknown[]): unknown;
}

export const CommandActionsDIToken = token<readonly CommandAction[]>("CommandActions");

function isConditionalKeybinding(entry: KeybindingEntry): entry is ConditionalKeybinding {
    return !Array.isArray(entry) && "keys" in entry;
}

export function combineWhen(actionWhen?: string, bindingWhen?: string): string | undefined {
    if (actionWhen && bindingWhen) return `(${actionWhen}) && (${bindingWhen})`;
    return actionWhen ?? bindingWhen;
}

export function registerAction(
    commands: CommandRegistry,
    keybindings: KeybindingRegistry,
    accessor: ServiceAccessor,
    action: CommandAction,
): IDisposable {
    const disposables: IDisposable[] = [];

    // A guard on the command itself covers ALL invocation paths, not just the ones that render an item.
    // The service is resolved lazily: commands without `enablement` must not require it to be bound.
    const handler = (...args: unknown[]): unknown => {
        if (action.enablement !== undefined && !accessor.get(ContextKeyServiceDIToken).evaluate(action.enablement)) {
            return undefined;
        }
        return action.run(accessor, ...args);
    };
    disposables.push(commands.register(action.id, handler, action.title, action.enablement));

    const allBindings: KeybindingEntry[] = [];
    if (action.keybinding) {
        allBindings.push(action.keybinding);
    }
    if (action.keybindings) {
        allBindings.push(...action.keybindings);
    }

    // `enablement` goes into the binding's when, like VS Code `precondition`: otherwise the dispatcher
    // would swallow the key and do nothing; this way it falls through the chain.
    const scope = combineWhen(action.when, action.enablement);
    for (const entry of allBindings) {
        const { keys, when, weight } = isConditionalKeybinding(entry)
            ? { keys: entry.keys, when: entry.when, weight: entry.weight ?? action.weight }
            : { keys: entry, when: undefined, weight: action.weight };
        disposables.push(
            keybindings.register(keys, action.id, combineWhen(scope, when), "default", undefined, { weight }),
        );
    }

    return {
        dispose() {
            for (let i = disposables.length - 1; i >= 0; i--) {
                disposables[i].dispose();
            }
        },
    };
}
