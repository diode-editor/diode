import type {
    IWireDebugConfigurationProvider,
    IWireDebugProviderHandle,
    IWireDebugStartDebugging,
    IWireDebugStartOptions,
    IWireDebugStopDebugging,
    WireDebugConfiguration,
} from "../../../api/common/debugWireTypes.ts";
import { isFiniteNumber } from "../../../api/common/wireTypes.ts";

// Debug messages from the subprocess (`debug.*`); `null` — a malformed message, ignored (a request: rejected).

type Fields = Readonly<Record<string, unknown>>;

function fields(raw: unknown): Fields | null {
    // `typeof null` is "object" too: null comes back as null.
    return typeof raw === "object" && !Array.isArray(raw) ? (raw as Fields | null) : null;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined;
}

/** A launch configuration is any JSON object; the core checks `type`, `name` and `request` itself. */
export function parseWireDebugConfiguration(raw: unknown): WireDebugConfiguration | null {
    return fields(raw);
}

/** Entries that are not objects are dropped. */
export function parseWireDebugConfigurations(raw: unknown): WireDebugConfiguration[] {
    if (!Array.isArray(raw)) return [];
    return (raw as readonly unknown[])
        .map(parseWireDebugConfiguration)
        .filter((config): config is WireDebugConfiguration => config !== null);
}

/** A provider's answer: no `config` (or a malformed one) — `undefined`, `null` — `null`. */
export function parseWireDebugResolveResult(raw: unknown): WireDebugConfiguration | null | undefined {
    const p = fields(raw);
    if (p?.config === null) return null;
    return parseWireDebugConfiguration(p?.config) ?? undefined;
}

export function parseWireDebugConfigurationProvider(raw: unknown): IWireDebugConfigurationProvider | null {
    const p = fields(raw);
    if (
        p === null ||
        !isFiniteNumber(p.handle) ||
        typeof p.type !== "string" ||
        (p.triggerKind !== 1 && p.triggerKind !== 2) ||
        typeof p.extensionId !== "string"
    ) {
        return null;
    }
    return {
        handle: p.handle,
        type: p.type,
        triggerKind: p.triggerKind,
        hasProvide: p.hasProvide === true,
        hasResolve: p.hasResolve === true,
        hasResolveWithSubstitutedVariables: p.hasResolveWithSubstitutedVariables === true,
        extensionId: p.extensionId,
    };
}

export function parseWireDebugProviderHandle(raw: unknown): IWireDebugProviderHandle | null {
    const p = fields(raw);
    return isFiniteNumber(p?.handle) ? { handle: p.handle } : null;
}

function parseStartOptions(raw: unknown): IWireDebugStartOptions {
    const p = fields(raw) ?? {};
    return {
        parentSessionId: optionalString(p.parentSessionId),
        lifecycleManagedByParent: optionalBoolean(p.lifecycleManagedByParent),
        consoleMode: isFiniteNumber(p.consoleMode) ? p.consoleMode : undefined,
        noDebug: optionalBoolean(p.noDebug),
        compact: optionalBoolean(p.compact),
        suppressSaveBeforeStart: optionalBoolean(p.suppressSaveBeforeStart),
        suppressDebugStatusbar: optionalBoolean(p.suppressDebugStatusbar),
        suppressDebugToolbar: optionalBoolean(p.suppressDebugToolbar),
        suppressDebugView: optionalBoolean(p.suppressDebugView),
    };
}

export function parseWireDebugStartDebugging(raw: unknown): IWireDebugStartDebugging | null {
    const p = fields(raw);
    if (p === null) return null;
    const nameOrConfig = typeof p.nameOrConfig === "string" ? p.nameOrConfig : fields(p.nameOrConfig);
    if (nameOrConfig === null) return null;
    const folder = optionalString(p.folder);
    return { ...(folder === undefined ? {} : { folder }), nameOrConfig, options: parseStartOptions(p.options) };
}

export function parseWireDebugStopDebugging(raw: unknown): IWireDebugStopDebugging {
    return { sessionId: optionalString(fields(raw)?.sessionId) };
}
