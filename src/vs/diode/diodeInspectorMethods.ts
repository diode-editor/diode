import type { ICommandSnapshot } from "../platform/commands/common/commandRegistry.ts";
import type { IOutputChannelDescriptor } from "../workbench/services/output/common/output.ts";

/**
 * `Diode.*` on top of the `TUIDom.*` protocol: what an agent needs to know about the editor rather than the tree.
 * Client: `npm run drive`. Services come in as ports, without DI, so the methods are testable without a container.
 */
export const DiodeInspectorMethod = {
    /** `{timeoutMs?}` → `{ready, pid}`; `pid` tells a new window after `reloadWindow` (same port) from the old one. */
    whenReady: "Diode.whenReady",
    /** `{id, args?, timeoutMs?}` → `{settled, result?}`: run a command by id. */
    executeCommand: "Diode.executeCommand",
    /** `{}` → `{commands}`: commands with a title (what the command palette shows). */
    listCommands: "Diode.listCommands",
    /** `{}` → `{channels}`: Output panel channels. */
    listOutputChannels: "Diode.listOutputChannels",
    /** `{channel}` (id or label) → `{id, label, text}`: Output channel contents. */
    getOutput: "Diode.getOutput",
    /** `{key}` → `{value}`: context key value (`undefined` — not set). */
    getContextKey: "Diode.getContextKey",
    /** `{expr}` → `{value}`: a when-expression over the current context keys. */
    evaluateWhen: "Diode.evaluateWhen",
} as const;

export interface IDiodeInspectorPorts {
    readonly commands: {
        has(id: string): boolean;
        execute(id: string, ...args: unknown[]): unknown;
        listCommands(): ICommandSnapshot[];
    };
    readonly output: {
        getChannels(): readonly IOutputChannelDescriptor[];
        renderChannel(id: string): string;
    };
    readonly contextKeys: {
        getRaw(key: string): unknown;
        evaluate(when: string): boolean;
    };
    /** Resolves once startup has finished; never rejects. */
    readonly ready: Promise<void>;
    readonly pid: number;
}

export type RegisterInspectorMethod = (method: string, handler: (params: unknown) => unknown) => void;

/** A command may block until a dialog is closed. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;
export const DEFAULT_READY_TIMEOUT_MS = 60_000;

export function registerDiodeInspectorMethods(register: RegisterInspectorMethod, ports: IDiodeInspectorPorts): void {
    register(DiodeInspectorMethod.whenReady, async (params) => {
        const timeoutMs = optionalNumber(params, "timeoutMs") ?? DEFAULT_READY_TIMEOUT_MS;
        const ready = await settleWithin(ports.ready, timeoutMs);
        return { ready: ready.settled, pid: ports.pid };
    });

    register(DiodeInspectorMethod.executeCommand, async (params) => {
        const id = requiredString(params, "id");
        const args = optionalArray(params, "args") ?? [];
        const timeoutMs = optionalNumber(params, "timeoutMs") ?? DEFAULT_COMMAND_TIMEOUT_MS;
        if (!ports.commands.has(id)) throw new Error(`unknown command: ${id}`);
        // Don't wait past the timeout: a quick pick resolves only on an answer, and the answer can only
        // come with the next call.
        const outcome = await settleWithin(Promise.resolve(ports.commands.execute(id, ...args)), timeoutMs);
        return outcome.settled ? { settled: true, result: toWire(outcome.value) } : { settled: false };
    });

    register(DiodeInspectorMethod.listCommands, () => ({ commands: ports.commands.listCommands() }));

    register(DiodeInspectorMethod.listOutputChannels, () => ({
        channels: ports.output.getChannels().map(({ id, label }) => ({ id, label })),
    }));

    register(DiodeInspectorMethod.getOutput, (params) => {
        const wanted = requiredString(params, "channel");
        const channels = ports.output.getChannels();
        const lower = wanted.toLowerCase();
        const channel = channels.find((c) => c.id === wanted) ?? channels.find((c) => c.label.toLowerCase() === lower);
        if (channel === undefined) {
            const known = channels.map((c) => `${c.id} (${c.label})`).join(", ");
            throw new Error(`unknown output channel: ${wanted}; known: ${known}`);
        }
        return { id: channel.id, label: channel.label, text: ports.output.renderChannel(channel.id) };
    });

    register(DiodeInspectorMethod.getContextKey, (params) => ({
        value: toWire(ports.contextKeys.getRaw(requiredString(params, "key"))),
    }));

    register(DiodeInspectorMethod.evaluateWhen, (params) => ({
        value: ports.contextKeys.evaluate(requiredString(params, "expr")),
    }));
}

type Settled<T> = { settled: true; value: T } | { settled: false };

/** A rejection propagates: it is a protocol error response, not a timeout. */
async function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<Settled<T>> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<Settled<T>>((resolve) => {
        timer = setTimeout(() => {
            resolve({ settled: false });
        }, timeoutMs);
    });
    try {
        return await Promise.race([promise.then((value): Settled<T> => ({ settled: true, value })), timeout]);
    } finally {
        clearTimeout(timer);
    }
}

/** The response goes through `JSON.stringify`: a cycle would break sending, and `undefined` would silently vanish. */
export function toWire(value: unknown): unknown {
    if (value === undefined) return null;
    try {
        return JSON.parse(JSON.stringify(value)) as unknown;
    } catch {
        return typeof value === "bigint" ? value.toString() : `<несериализуемо: ${typeof value}>`;
    }
}

function field(params: unknown, name: string): unknown {
    if (typeof params !== "object" || params === null) return undefined;
    return (params as Record<string, unknown>)[name];
}

function requiredString(params: unknown, name: string): string {
    const value = field(params, name);
    if (typeof value !== "string" || value.length === 0) throw new Error(`'${name}' must be a non-empty string`);
    return value;
}

function optionalNumber(params: unknown, name: string): number | undefined {
    const value = field(params, name);
    if (value === undefined) return undefined;
    // `Number.isFinite` already rejects non-numbers — a separate `typeof` check would be an unreachable branch.
    if (!Number.isFinite(value) || (value as number) < 0) throw new Error(`'${name}' must be a non-negative number`);
    return value as number;
}

function optionalArray(params: unknown, name: string): unknown[] | undefined {
    const value = field(params, name);
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) throw new Error(`'${name}' must be an array`);
    return value as unknown[];
}
