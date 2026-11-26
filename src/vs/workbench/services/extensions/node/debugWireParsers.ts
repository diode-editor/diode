import type { SerializedError } from "../../../../base/common/errorSerialization.ts";
import {
    type IWireDebugAdapterError,
    type IWireDebugAdapterExit,
    type IWireDebugAdapterMessage,
    type IWireDebugBreakpointBase,
    type IWireDebugConfigurationProvider,
    type IWireDebugConsoleAppend,
    type IWireDebugCustomRequest,
    type IWireDebugFunctionBreakpoint,
    type IWireDebugProtocolBreakpointRequest,
    type IWireDebugProviderHandle,
    type IWireDebugRegisterBreakpoints,
    type IWireDebugSetSessionName,
    type IWireDebugSourceLine,
    type IWireDebugSourceMultiBreakpoint,
    type IWireDebugStartDebugging,
    type IWireDebugStartOptions,
    type IWireDebugStopDebugging,
    type IWireDebugUnregisterBreakpoints,
    type WireDebugConfiguration,
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
        testRun: parseTestRunReference(p.testRun),
    };
}

function parseTestRunReference(raw: unknown): IWireDebugStartOptions["testRun"] {
    const p = fields(raw);
    return typeof p?.runId === "string" && typeof p.taskId === "string"
        ? { runId: p.runId, taskId: p.taskId }
        : undefined;
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

/** Upstream `$registerDebugTypes`: entries that are not strings are dropped. */
export function parseWireDebugTypes(raw: unknown): string[] {
    return stringList(fields(raw)?.types);
}

/** A DAP message is any object with a `type`; the session checks the rest, as upstream's. */
export function parseWireDebugAdapterMessage(raw: unknown): IWireDebugAdapterMessage | null {
    const p = fields(raw);
    const message = fields(p?.message);
    if (!isFiniteNumber(p?.handle) || typeof message?.type !== "string") return null;
    return { handle: p.handle, message };
}

/** The error must look serialized (`$isError`, string name and message, a stack if any); the rest is its own. */
export function parseWireDebugAdapterError(raw: unknown): IWireDebugAdapterError | null {
    const p = fields(raw);
    const error = fields(p?.error);
    if (
        !isFiniteNumber(p?.handle) ||
        error?.$isError !== true ||
        typeof error.name !== "string" ||
        typeof error.message !== "string" ||
        !["string", "undefined"].includes(typeof error.stack)
    ) {
        return null;
    }
    return { handle: p.handle, error: error as unknown as SerializedError };
}

export function parseWireDebugAdapterExit(raw: unknown): IWireDebugAdapterExit | null {
    const p = fields(raw);
    if (!isFiniteNumber(p?.handle)) return null;
    return { handle: p.handle, ...(isFiniteNumber(p.code) ? { code: p.code } : {}) };
}

/** `args` is whatever the extension passed: the adapter checks it. */
export function parseWireDebugCustomRequest(raw: unknown): IWireDebugCustomRequest | null {
    const p = fields(raw);
    if (typeof p?.sessionId !== "string" || typeof p.command !== "string") return null;
    return { sessionId: p.sessionId, command: p.command, args: p.args };
}

export function parseWireDebugProtocolBreakpointRequest(raw: unknown): IWireDebugProtocolBreakpointRequest | null {
    const p = fields(raw);
    if (typeof p?.sessionId !== "string" || typeof p.breakpointId !== "string") return null;
    return { sessionId: p.sessionId, breakpointId: p.breakpointId };
}

export function parseWireDebugSetSessionName(raw: unknown): IWireDebugSetSessionName | null {
    const p = fields(raw);
    if (typeof p?.sessionId !== "string" || typeof p.name !== "string") return null;
    return { sessionId: p.sessionId, name: p.name };
}

export function parseWireDebugConsoleAppend(raw: unknown): IWireDebugConsoleAppend | null {
    const value = fields(raw)?.value;
    return typeof value === "string" ? { value } : null;
}

/** `null` — not a breakpoint: no string id or no boolean `enabled`; optional fields of another type are dropped. */
function parseBreakpointBase(p: Fields): IWireDebugBreakpointBase | null {
    if (typeof p.id !== "string" || typeof p.enabled !== "boolean") return null;
    return {
        id: p.id,
        enabled: p.enabled,
        condition: optionalString(p.condition),
        hitCondition: optionalString(p.hitCondition),
        logMessage: optionalString(p.logMessage),
        mode: optionalString(p.mode),
    };
}

function parseSourceLine(raw: unknown): IWireDebugSourceLine | null {
    const p = fields(raw);
    if (p === null) return null;
    const base = parseBreakpointBase(p);
    if (base === null || !isFiniteNumber(p.line) || !isFiniteNumber(p.character)) return null;
    return { ...base, line: p.line, character: p.character };
}

type RegisteredBreakpoint = IWireDebugSourceMultiBreakpoint | IWireDebugFunctionBreakpoint;

function parseRegisteredBreakpoint(raw: unknown): RegisteredBreakpoint | null {
    const p = fields(raw);
    if (p?.type === "sourceMulti" && typeof p.uri === "string" && Array.isArray(p.lines)) {
        const lines = (p.lines as readonly unknown[])
            .map(parseSourceLine)
            .filter((line): line is IWireDebugSourceLine => line !== null);
        return { type: "sourceMulti", uri: p.uri, lines };
    }
    if (p?.type !== "function" || typeof p.functionName !== "string") return null;
    const base = parseBreakpointBase(p);
    return base === null ? null : { type: "function", ...base, functionName: p.functionName };
}

/** Upstream `$registerBreakpoints`: malformed entries (and lines) are dropped. */
export function parseWireDebugRegisterBreakpoints(raw: unknown): IWireDebugRegisterBreakpoints {
    const list = fields(raw)?.breakpoints;
    if (!Array.isArray(list)) return { breakpoints: [] };
    return {
        breakpoints: (list as readonly unknown[])
            .map(parseRegisteredBreakpoint)
            .filter((bp): bp is RegisteredBreakpoint => bp !== null),
    };
}

function stringList(raw: unknown): string[] {
    return Array.isArray(raw) ? (raw as readonly unknown[]).filter((id) => typeof id === "string") : [];
}

/** Upstream `$unregisterBreakpoints`: ids that are not strings are dropped. */
export function parseWireDebugUnregisterBreakpoints(raw: unknown): IWireDebugUnregisterBreakpoints {
    const p = fields(raw);
    return { breakpointIds: stringList(p?.breakpointIds), functionBreakpointIds: stringList(p?.functionBreakpointIds) };
}
