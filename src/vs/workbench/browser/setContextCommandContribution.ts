import { Disposable } from "../../base/common/lifecycle.ts";
import type { CommandRegistry } from "../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import type { ContextKeyService, ContextKeySettableValue } from "../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../platform/instantiation/common/diContainer.ts";
import type { IWorkbenchContribution } from "../common/iWorkbenchContribution.ts";

export const SetContextCommandContributionDIToken =
    // Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
    token<SetContextCommandContribution>("SetContextCommandContribution");

/** Id встроенной команды VS Code, которой расширения публикуют свои when-ключи. */
export const SET_CONTEXT_COMMAND_ID = "setContext";

/**
 * Нормализует значение из `executeCommand("setContext", key, value)` в наш
 * {@link ContextKeyService}.
 *
 * `null`/`undefined` — «сбросить», то есть `false`: у нас непрописанный
 * boolean-ключ и так читается как `false`, так что это одно и то же состояние.
 * Массив и объект VS Code хранит как есть — под оператор `in`
 * (`resource in ext.supportedFiles`); у нас так же. Из массива остаются только
 * примитивы: с ними `in` и сравнивает.
 */
export function normalizeContextValue(value: unknown): ContextKeySettableValue {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.filter(isPrimitive);
    if (typeof value === "object" && value !== null) return value as Readonly<Record<string, unknown>>;
    // NaN/Infinity как значение ключа бессмысленны — их истинность честнее.
    // Stryker disable next-line ConditionalExpression: эквивалентный мутант — `Number.isFinite` истинен только для number, так что проверка `typeof` рядом с ним ничего не решает; оставлена ради читаемости
    if (typeof value === "number" && Number.isFinite(value)) return value;
    // Сюда же попадает boolean: `Boolean(v)` возвращает его как есть.
    return Boolean(value);
}

function isPrimitive(item: unknown): item is boolean | string | number {
    return typeof item === "string" || typeof item === "number" || typeof item === "boolean";
}

/**
 * Регистрирует встроенную команду `setContext` — ту самую, которой расширения
 * публикуют собственные when-ключи (`commands.executeCommand("setContext",
 * "supermaven.isProUser", true)`). Без неё вызов отклоняется как «команда не
 * найдена», и все `when` расширения остаются мёртвыми.
 *
 * Регистрировать имя не нужно: when-вычислитель читает любой ключ целиком,
 * в том числе точечный (`publisher.thing`) или с дефисом.
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
                contextKeys.setRaw(key, normalizeContextValue(value));
                return undefined;
            }),
        );
    }
}
