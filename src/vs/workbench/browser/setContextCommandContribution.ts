import { Disposable } from "@tuidom/core/common/disposable";

import type { CommandRegistry } from "../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import { registerContextKeys } from "../../platform/contextkey/common/contextKeys.ts";
import type { ContextKeyService } from "../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../platform/instantiation/common/diContainer.ts";
import type { IWorkbenchContribution } from "../common/iWorkbenchContribution.ts";

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const SetContextCommandContributionDIToken = token<SetContextCommandContribution>(
    "SetContextCommandContribution",
);

/** Id встроенной команды VS Code, которой расширения публикуют свои when-ключи. */
export const SET_CONTEXT_COMMAND_ID = "setContext";

/**
 * Нормализует значение из `executeCommand("setContext", key, value)` в наш
 * {@link ContextKeyService} (`boolean | string | number`).
 *
 * `null`/`undefined` — «сбросить», то есть `false`: у нас непрописанный
 * boolean-ключ и так читается как `false`, так что это одно и то же состояние.
 * Массивы и объекты VS Code хранит как есть (под оператор `in`), у нас
 * вычислитель работает только с примитивами — сохраняем их истинность, чтобы
 * простое `when: "ext.something"` вело себя ожидаемо.
 */
export function normalizeContextValue(value: unknown): boolean | string | number {
    if (typeof value === "string") return value;
    // NaN/Infinity как значение ключа бессмысленны — их истинность честнее.
    // Stryker disable next-line ConditionalExpression: эквивалентный мутант — `Number.isFinite` истинен только для number, так что проверка `typeof` рядом с ним ничего не решает; оставлена ради читаемости
    if (typeof value === "number" && Number.isFinite(value)) return value;
    // Сюда же попадает boolean: `Boolean(v)` возвращает его как есть.
    return Boolean(value);
}

/**
 * Регистрирует встроенную команду `setContext` — ту самую, которой расширения
 * публикуют собственные when-ключи (`commands.executeCommand("setContext",
 * "supermaven.isProUser", true)`). Без неё вызов отклоняется как «команда не
 * найдена», и все `when` расширения остаются мёртвыми.
 *
 * Ключ регистрируется в when-вычислителе (`registerContextKeys`) ДО записи
 * значения: иначе выражение, которое его упоминает, вычислялось бы по
 * неизвестному имени. Имена расширений точечные (`publisher.thing`) — как
 * вычислитель их раскрывает, см. `ContextKeyService.buildScope`.
 *
 * Без `title` — в палитре команд `setContext` быть не должно (её там нет и в
 * VS Code): это программный шов, а не действие пользователя.
 */
export class SetContextCommandContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [CommandRegistryDIToken, ContextKeyServiceDIToken] as const;

    public constructor(commands: CommandRegistry, contextKeys: ContextKeyService) {
        super();
        this.register(
            commands.register(SET_CONTEXT_COMMAND_ID, (key: unknown, value: unknown) => {
                if (typeof key !== "string" || key === "") return undefined;
                registerContextKeys([key]);
                contextKeys.setRaw(key, normalizeContextValue(value));
                return undefined;
            }),
        );
    }
}
