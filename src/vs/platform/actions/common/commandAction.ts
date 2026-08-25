import type { IDisposable } from "@tuidom/core/common/disposable";
import type { CommandRegistry } from "../../commands/common/commandRegistry.ts";
import { ContextKeyServiceDIToken } from "../../contextkey/common/contextKeyService.ts";
import type { ServiceAccessor } from "../../instantiation/common/diContainer.ts";
import type { Keybinding, KeybindingChord, KeybindingRegistry } from "../../keybinding/common/keybindingRegistry.ts";

import type { MenuId } from "./menuId.ts";

/**
 * A binding plus an optional `when` that narrows JUST this binding — used for
 * environment-conditional defaults (tier / mode / capability / OS). The per-binding
 * `when` is AND-ed with the action-wide `when`.
 *
 * Example: bind Ctrl+Shift+Right only where the terminal can disambiguate it:
 *   { keys: parseKeybinding("ctrl+shift+right"), when: "tier == 'kitty' || tier == 'csi-u'" }
 */
export interface ConditionalKeybinding {
    readonly keys: Keybinding | KeybindingChord;
    readonly when?: string;
}

export type KeybindingEntry = Keybinding | KeybindingChord | ConditionalKeybinding;

/**
 * Co-located размещение команды в меню (аналог поля `menu` у `registerAction2`
 * VS Code): экшен сам объявляет, в каких меню он виден. Из этих размещений
 * деривируется `MENU_CONTRIBUTIONS` (см. `Menus/menuContributions.ts`).
 * Семантика полей — как у `IMenuContribution`, минус `command` (это id экшена).
 */
export interface CommandMenuPlacement {
    readonly menuId: MenuId;
    /** Label только для этого меню; иначе — `shortTitle`/`title` экшена. */
    readonly title?: string;
    /** Условие видимости через контекст-ключи (`ContextKeyService.evaluate`). */
    readonly when?: string;
    /** Сужает {@link CommandAction.enablement} для этого размещения (AND). */
    readonly enablement?: string;
    /** Императивная видимость по контексту открытия (см. `IMenuContribution.visible`). */
    readonly visible?: (context: unknown) => boolean;
    /** When-выражение «пункт сейчас включён» — галочка в иконной колонке (см. `IMenuContribution.toggled`). */
    readonly toggled?: string;
    readonly group?: string;
    readonly order?: number;
    readonly icon?: string;
    /** Аргументы для `execute`, резолвятся из контекста открытия меню. */
    readonly args?: (context: unknown) => readonly unknown[];
    /** `false` — не показывать шорткат; строка — литерал; иначе — из `KeybindingRegistry`. */
    readonly shortcut?: string | false;
}

export interface CommandAction {
    readonly id: string;
    readonly title: string;
    /**
     * Короткий label для меню (аналог `shortTitle` VS Code): без категории
     * («File: Copy» → «Copy»). Палитра команд показывает `title`, меню — его.
     */
    readonly shortTitle?: string;
    /** Primary binding. A combination, a chord, or a conditional `{ keys, when }`. */
    readonly keybinding?: KeybindingEntry;
    /** Alternative bindings, each a combination, chord, or conditional `{ keys, when }`. */
    readonly keybindings?: KeybindingEntry[];
    /** Action-wide when, AND-ed with any per-binding when. */
    readonly when?: string;
    /**
     * When-выражение «команду сейчас можно исполнить» (аналог `precondition`
     * VS Code, поле `enablement` в манифесте расширения). Отличие от `when`:
     * тот прячет пункт, а этот его гасит — пункт остаётся на месте, но
     * приглушён и не исполняется. Отсутствие = доступно всегда.
     */
    readonly enablement?: string;
    /** Co-located размещения в меню (см. {@link CommandMenuPlacement}). */
    readonly menus?: readonly CommandMenuPlacement[];
    run(accessor: ServiceAccessor, ...args: unknown[]): unknown;
}

function isConditionalKeybinding(entry: KeybindingEntry): entry is ConditionalKeybinding {
    return !Array.isArray(entry) && "keys" in entry;
}

/** AND-combines the action-wide `when` with a per-binding `when` (either may be absent). */
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

    // Guard доступности — на самой команде: так `enablement` накрывает ВСЕ пути
    // запуска (пункт меню, inline-кнопка, кейбинд, палитра, программный
    // execute), а не только те, что рисуют пункт. Сервис резолвим лениво и
    // только когда `enablement` есть: команды без него не должны требовать его
    // биндинга (минимальные контейнеры тестов экшенов).
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

    // `enablement` складывается в when биндинга — так же, как VS Code кладёт
    // `precondition` в правило кейбинда. Иначе диспетчер нашёл бы биндинг,
    // проглотил клавишу и не сделал ничего; а так она уходит дальше по цепочке.
    const scope = combineWhen(action.when, action.enablement);
    for (const entry of allBindings) {
        const { keys, when } = isConditionalKeybinding(entry)
            ? { keys: entry.keys, when: entry.when }
            : { keys: entry, when: undefined };
        disposables.push(keybindings.register(keys, action.id, combineWhen(scope, when)));
    }

    return {
        dispose() {
            for (let i = disposables.length - 1; i >= 0; i--) {
                disposables[i].dispose();
            }
        },
    };
}
