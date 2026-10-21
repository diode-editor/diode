import { Disposable } from "../../base/common/lifecycle.ts";
import type { CommandRegistry } from "../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import type { ContextKeyService, ContextKeySettableValue } from "../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../platform/instantiation/common/diContainer.ts";
import type { IWorkbenchContribution } from "../common/iWorkbenchContribution.ts";

export const SetContextCommandContributionDIToken =
    // Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by reference to it; the string inside is only a debug label
    token<SetContextCommandContribution>("SetContextCommandContribution");

export const SET_CONTEXT_COMMAND_ID = "setContext";

/**
 * `null`/`undefined` mean "reset", i.e. `false`: an unset boolean key reads
 * as `false` anyway. Arrays and objects are stored as is for the `in` operator
 * (`resource in ext.supportedFiles`); arrays keep only primitives.
 */
export function normalizeContextValue(value: unknown): ContextKeySettableValue {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.filter(isPrimitive);
    if (typeof value === "object" && value !== null) return value as Readonly<Record<string, unknown>>;
    // NaN/Infinity make no sense as a key value; their truthiness is more honest.
    // Stryker disable next-line ConditionalExpression: equivalent mutant — `Number.isFinite` is true only for numbers, so the `typeof` check next to it decides nothing; kept for readability
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return Boolean(value);
}

function isPrimitive(item: unknown): item is boolean | string | number {
    return typeof item === "string" || typeof item === "number" || typeof item === "boolean";
}

/**
 * Without it `executeCommand("setContext", …)` is rejected as "command not
 * found" and every extension `when` is dead. No `title`: VS Code keeps it out of the palette too.
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
