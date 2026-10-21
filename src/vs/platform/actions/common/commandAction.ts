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

/** Как `IMenuContribution` минус `command` (это id экшена); поле `menu` у `registerAction2` VS Code. */
export interface CommandMenuPlacement {
    readonly menuId: MenuId;
    readonly title?: string;
    readonly when?: string;
    /** Сужает {@link CommandAction.enablement} (AND). */
    readonly enablement?: string;
    readonly visible?: (context: unknown) => boolean;
    readonly toggled?: string;
    readonly group?: string;
    readonly order?: number;
    readonly icon?: string;
    readonly args?: (context: unknown) => readonly unknown[];
    /** `false` — не показывать шорткат; строка — литерал; иначе — из `KeybindingRegistry`. */
    readonly shortcut?: string | false;
}

export interface CommandAction {
    readonly id: string;
    readonly title: string;
    /** Без категории («File: Copy» → «Copy»): палитра показывает `title`, меню — его. */
    readonly shortTitle?: string;
    readonly keybinding?: KeybindingEntry;
    readonly keybindings?: KeybindingEntry[];
    readonly when?: string;
    /** По умолчанию `EditorCore`; при равном весе сильнее зарегистрированный позже. */
    readonly weight?: number;
    /** Как `precondition` VS Code: `when` прячет пункт, а этот гасит — пункт на месте, но не исполняется. */
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

    // Guard на самой команде накрывает ВСЕ пути запуска, а не только рисующие пункт.
    // Сервис резолвим лениво: команды без `enablement` не должны требовать его биндинга.
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

    // `enablement` в when биндинга, как `precondition` у VS Code: иначе диспетчер
    // проглотил бы клавишу и не сделал ничего, а так она уходит дальше по цепочке.
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
