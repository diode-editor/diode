import { LogLevel } from "./vscodeTypes.ts";
import type { IWireEnvInitialize, IWireEnvLogLevel } from "./wireTypes.ts";

// The `env.*` seeds are parsed only in the extension host: out of `wireTypes.ts`, which the main bundle shares.

/** A non-string becomes an empty string, like upstream's "unknown". */
export function parseWireEnvInitialize(raw: unknown): IWireEnvInitialize {
    const { machineId, shell, appRoot, logLevel } = (typeof raw === "object" && raw !== null ? raw : {}) as {
        machineId?: unknown;
        shell?: unknown;
        appRoot?: unknown;
        logLevel?: unknown;
    };
    return {
        machineId: typeof machineId === "string" ? machineId : "",
        shell: typeof shell === "string" ? shell : "",
        appRoot: typeof appRoot === "string" ? appRoot : "",
        logLevel: parseApiLogLevel(logLevel),
    };
}

export function parseWireEnvLogLevel(raw: unknown): IWireEnvLogLevel {
    const { logLevel } = (typeof raw === "object" && raw !== null ? raw : {}) as { logLevel?: unknown };
    return { logLevel: parseApiLogLevel(logLevel) };
}

const API_LOG_LEVELS: ReadonlySet<unknown> = new Set([
    LogLevel.Off,
    LogLevel.Trace,
    LogLevel.Debug,
    LogLevel.Info,
    LogLevel.Warning,
    LogLevel.Error,
]);

/** Anything but an API `LogLevel` (Off 0 … Error 5) becomes upstream's default, Info. */
function parseApiLogLevel(raw: unknown): LogLevel {
    return API_LOG_LEVELS.has(raw) ? (raw as LogLevel) : LogLevel.Info;
}
