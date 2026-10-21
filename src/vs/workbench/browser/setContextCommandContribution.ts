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

export const SET_CONTEXT_COMMAND_ID = "setContext";

/**
 * `null`/`undefined` — «сбросить», то есть `false`: непрописанный boolean-ключ
 * и так читается как `false`. Массив и объект хранятся как есть — под оператор
 * `in` (`resource in ext.supportedFiles`); из массива остаются только примитивы.
 */
export function normalizeContextValue(value: unknown): ContextKeySettableValue {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.filter(isPrimitive);
    if (typeof value === "object" && value !== null) return value as Readonly<Record<string, unknown>>;
    // NaN/Infinity как значение ключа бессмысленны — их истинность честнее.
    // Stryker disable next-line ConditionalExpression: эквивалентный мутант — `Number.isFinite` истинен только для number, так что проверка `typeof` рядом с ним ничего не решает; оставлена ради читаемости
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return Boolean(value);
}

function isPrimitive(item: unknown): item is boolean | string | number {
    return typeof item === "string" || typeof item === "number" || typeof item === "boolean";
}

/**
 * Без неё `executeCommand("setContext", …)` отклоняется как «команда не
 * найдена», и все `when` расширений мертвы. Без `title`: в палитре её нет и в VS Code.
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
