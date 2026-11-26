import {
    type IWireTerminalActive,
    type IWireTerminalClosed,
    type IWireTerminalCommandLine,
    type IWireTerminalInteraction,
    type IWireTerminalLaunch,
    type IWireTerminalOpened,
    type IWireTerminalPtyDimensions,
    type IWireTerminalPtyInput,
    type IWireTerminalShellExecutionData,
    type IWireTerminalShellExecutionEnd,
    type IWireTerminalShellExecutionStart,
    type IWireTerminalShellIntegration,
    type IWireTerminalShellIntegrationCwd,
    type IWireTerminalShellIntegrationEnv,
    type IWireTerminalTitleChanged,
    parseWireStringArray,
    parseWireStringRecord,
    type WireTerminalExitReason,
} from "./wireTypes.ts";

// Parsers of the terminal messages only the extension subprocess reads. They live outside `wireTypes.ts` on
// purpose: that module is shared with the core bundle, and the extension host role has a budget for the code it
// shares with the core (`scripts/build-lazy-chunks.mjs`).

const WIRE_TERMINAL_EXIT_REASONS: readonly WireTerminalExitReason[] = [
    "unknown",
    "shutdown",
    "process",
    "user",
    "extension",
];

/** Fields are read via optional chaining: a primitive lacks them just like `null` does. */
type WireEnvelope = Readonly<Record<string, unknown>> | null | undefined;

function parseWireTerminalLaunch(raw: unknown): IWireTerminalLaunch {
    const p = raw as WireEnvelope;
    const shellArgs = parseWireStringArray(p?.shellArgs);
    const env = parseWireStringRecord(p?.env);
    return {
        ...(typeof p?.name === "string" ? { name: p.name } : {}),
        ...(typeof p?.shellPath === "string" ? { shellPath: p.shellPath } : {}),
        ...(shellArgs !== undefined ? { shellArgs } : {}),
        ...(typeof p?.cwd === "string" ? { cwd: p.cwd } : {}),
        ...(env !== undefined ? { env } : {}),
        ...(typeof p?.hideFromUser === "boolean" ? { hideFromUser: p.hideFromUser } : {}),
    };
}

export function parseWireTerminalOpened(raw: unknown): IWireTerminalOpened | null {
    const p = raw as WireEnvelope;
    if (typeof p?.id !== "number" || typeof p.name !== "string") return null;
    return {
        id: p.id,
        name: p.name,
        ...(typeof p.extHostId === "number" ? { extHostId: p.extHostId } : {}),
        ...(typeof p.pid === "number" ? { pid: p.pid } : {}),
        ...(typeof p.shellType === "string" ? { shellType: p.shellType } : {}),
        ...(p.isInteractedWith === true ? { isInteractedWith: true } : {}),
        launch: parseWireTerminalLaunch(p.launch),
    };
}

/** An unfamiliar reason (newer host) becomes `unknown`. */
export function parseWireTerminalClosed(raw: unknown): IWireTerminalClosed | null {
    const p = raw as WireEnvelope;
    if (typeof p?.id !== "number") return null;
    const reason = WIRE_TERMINAL_EXIT_REASONS.find((r) => r === p.reason) ?? "unknown";
    return { id: p.id, ...(typeof p.code === "number" ? { code: p.code } : {}), reason };
}

export function parseWireTerminalPtyDimensions(raw: unknown): IWireTerminalPtyDimensions | null {
    const p = raw as WireEnvelope;
    if (typeof p?.id !== "number" || !isPositiveInteger(p.cols) || !isPositiveInteger(p.rows)) return null;
    return { id: p.id, cols: p.cols, rows: p.rows };
}

function isPositiveInteger(v: unknown): v is number {
    return Number.isInteger(v) && (v as number) > 0;
}

export function parseWireTerminalPtyInput(raw: unknown): IWireTerminalPtyInput | null {
    const p = raw as WireEnvelope;
    if (typeof p?.id !== "number" || typeof p.data !== "string") return null;
    return { id: p.id, data: p.data };
}

export function parseWireTerminalActive(raw: unknown): IWireTerminalActive {
    const id = (raw as WireEnvelope)?.id;
    return { id: typeof id === "number" ? id : null };
}

export function parseWireTerminalTitleChanged(raw: unknown): IWireTerminalTitleChanged | null {
    const p = raw as WireEnvelope;
    if (typeof p?.id !== "number" || typeof p.name !== "string") return null;
    return { id: p.id, name: p.name };
}

export function parseWireTerminalInteraction(raw: unknown): IWireTerminalInteraction | null {
    const id = (raw as WireEnvelope)?.id;
    return typeof id === "number" ? { id } : null;
}

export function parseWireTerminalShellIntegration(raw: unknown): IWireTerminalShellIntegration | null {
    const p = raw as WireEnvelope;
    if (typeof p?.id !== "number" || typeof p.supportsExecuteCommand !== "boolean") return null;
    return { id: p.id, supportsExecuteCommand: p.supportsExecuteCommand };
}

export function parseWireTerminalShellIntegrationCwd(raw: unknown): IWireTerminalShellIntegrationCwd | null {
    const p = raw as WireEnvelope;
    if (typeof p?.id !== "number" || typeof p.cwd !== "string") return null;
    return { id: p.id, cwd: p.cwd };
}

/** Values that are not strings are dropped. */
export function parseWireTerminalShellIntegrationEnv(raw: unknown): IWireTerminalShellIntegrationEnv | null {
    const p = raw as WireEnvelope;
    if (typeof p?.id !== "number" || typeof p.env !== "object" || p.env === null || typeof p.isTrusted !== "boolean")
        return null;
    const env = Object.fromEntries(
        Object.entries(p.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
    return { id: p.id, env, isTrusted: p.isTrusted };
}

/** An unknown confidence is `Low`. */
function parseWireTerminalCommandLine(raw: unknown): IWireTerminalCommandLine | null {
    const p = raw as WireEnvelope;
    if (typeof p?.value !== "string" || typeof p.isTrusted !== "boolean") return null;
    const confidence = p.confidence === 1 || p.confidence === 2 ? p.confidence : 0;
    return { value: p.value, confidence, isTrusted: p.isTrusted };
}

export function parseWireTerminalShellExecutionStart(raw: unknown): IWireTerminalShellExecutionStart | null {
    const p = raw as WireEnvelope;
    const commandLine = parseWireTerminalCommandLine(p?.commandLine);
    if (typeof p?.id !== "number" || typeof p.supportsExecuteCommand !== "boolean" || commandLine === null) return null;
    return {
        id: p.id,
        supportsExecuteCommand: p.supportsExecuteCommand,
        commandLine,
        ...(typeof p.cwd === "string" ? { cwd: p.cwd } : {}),
    };
}

export function parseWireTerminalShellExecutionData(raw: unknown): IWireTerminalShellExecutionData | null {
    const p = raw as WireEnvelope;
    if (typeof p?.id !== "number" || typeof p.data !== "string") return null;
    return { id: p.id, data: p.data };
}

export function parseWireTerminalShellExecutionEnd(raw: unknown): IWireTerminalShellExecutionEnd | null {
    const p = raw as WireEnvelope;
    const commandLine = parseWireTerminalCommandLine(p?.commandLine);
    if (typeof p?.id !== "number" || commandLine === null) return null;
    return { id: p.id, commandLine, ...(typeof p.exitCode === "number" ? { exitCode: p.exitCode } : {}) };
}
