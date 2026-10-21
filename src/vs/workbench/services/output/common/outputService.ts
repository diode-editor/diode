import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ILogService, LogEntry } from "../../../../platform/log/common/iLogService.ts";
import { ILogServiceDIToken } from "../../../../platform/log/common/iLogServiceDIToken.ts";
import { logLevelName } from "../../../../platform/log/common/logLevel.ts";

import type { ILogHistory, IOutputChannelDescriptor, IOutputChannelRegistry } from "./output.ts";
import { LogHistoryDIToken, OutputChannelRegistryDIToken } from "./output.ts";

export const OutputServiceDIToken = token<OutputService>("OutputService");

/** Local `HH:MM:SS.mmm` line prefix, as in VS Code logs. */
function formatTimestamp(timestamp: number): string {
    const d = new Date(timestamp);
    const pad = (n: number, width = 2): string => String(n).padStart(width, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** Entry arguments as the line tail. Non-serializable values (cycles, BigInt) go through String(). */
function formatArgs(args: readonly unknown[]): string {
    if (args.length === 0) return "";
    const parts = args.map((arg) => {
        // An error prints as its message, like `format` in upstream loggers
        // (`toErrorMessage`): JSON of an `Error` is `{}` (non-enumerable fields), and of
        // one received over RPC the internal `{"name":…,"message":…}` instead of text.
        if (arg instanceof Error) return arg.message;
        try {
            // JSON.stringify(undefined) returns undefined although the type promises string;
            // print the raw form then.
            const json = JSON.stringify(arg) as string | undefined;
            return json ?? String(arg);
        } catch {
            return String(arg);
        }
    });
    return ` ${parts.join(" ")}`;
}

/** The stock `log` grammar highlights the level only in square brackets, giving colors without our own. */
export function formatOutputLine(entry: LogEntry): string {
    return `${formatTimestamp(entry.timestamp)} [${logLevelName(entry.level)}] ${entry.message}${formatArgs(entry.args)}`;
}

/**
 * Counterpart of `IOutputService`. Channels labeled by the logger creator are copied into the registry from
 * `ILogService` (like vscode `logs.contribution`); an undeclared channel that receives
 * entries is registered with `label = id`: `createLogger` is ad hoc, otherwise the subsystem would be missing from the selector.
 */
export class OutputService extends Disposable {
    public static dependencies = [
        LogHistoryDIToken,
        ILogServiceDIToken,
        OutputChannelRegistryDIToken,
        ContextKeyServiceDIToken,
    ] as const;

    private activeChannelId: string | null = null;
    private readonly onDidChangeActiveChannelEmitter = this.register(new Emitter<string>());
    private readonly onDidAppendToActiveChannelEmitter = this.register(new Emitter<LogEntry>());

    public constructor(
        private readonly history: ILogHistory,
        logService: ILogService,
        private readonly registry: IOutputChannelRegistry,
        private readonly contextKeys: ContextKeyService,
    ) {
        super();
        for (const descriptor of logService.getRegisteredChannels()) this.registry.registerChannel(descriptor);
        this.register(
            logService.onDidRegisterChannel((descriptor) => {
                this.registry.registerChannel(descriptor);
            }),
        );
        // Channels that wrote before the UI came up, but have no label.
        for (const channel of this.history.getChannels()) this.ensureChannel(channel);
        this.setActiveChannel(this.registry.getChannels()[0]?.id ?? null);
        this.register(
            logService.onDidAppend((entry) => {
                this.ensureChannel(entry.channel);
                if (entry.channel !== this.activeChannelId) return;
                this.onDidAppendToActiveChannelEmitter.fire(entry);
            }),
        );
        // A channel may be declared after the service came up (extensions); then
        // it becomes active if there was no active one yet.
        this.register(
            this.registry.onDidRegisterChannel((descriptor) => {
                if (this.activeChannelId === null) this.setActiveChannel(descriptor.id);
            }),
        );
    }

    private ensureChannel(id: string): void {
        if (this.registry.getChannel(id) !== undefined) return;
        this.registry.registerChannel({ id, label: id });
    }

    public getChannels(): readonly IOutputChannelDescriptor[] {
        return this.registry.getChannels();
    }

    public onDidRegisterChannel(listener: (descriptor: IOutputChannelDescriptor) => void): IDisposable {
        return this.registry.onDidRegisterChannel(listener);
    }

    public getActiveChannelId(): string | null {
        return this.activeChannelId;
    }

    /** VS Code `showChannel`. An unknown id is a no-op. */
    public showChannel(id: string): void {
        if (this.registry.getChannel(id) === undefined || this.activeChannelId === id) return;
        this.setActiveChannel(id);
        this.onDidChangeActiveChannelEmitter.fire(id);
    }

    /**
     * The key is set here, not in a subscriber: selector items' `toggled` hangs on it, and
     * a subscriber could run after whoever re-reads the items.
     */
    private setActiveChannel(id: string | null): void {
        this.activeChannelId = id;
        this.contextKeys.set("activeOutputChannel", id ?? "");
    }

    public renderChannel(id: string): string {
        const entries = this.history.getEntries(id);
        if (entries.length === 0) return "";
        return `${entries.map(formatOutputLine).join("\n")}\n`;
    }

    public readonly onDidChangeActiveChannel = this.onDidChangeActiveChannelEmitter.event;

    public readonly onDidAppendToActiveChannel = this.onDidAppendToActiveChannelEmitter.event;
}
