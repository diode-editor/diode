import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { LogEntry } from "../../../../platform/log/common/iLogService.ts";

export const OUTPUT_VIEW_ID = "workbench.panel.output";

export const OUTPUT_LANGUAGE_ID = "log";

/** `output:<id>`, as in VS Code. */
export const OUTPUT_URI_SCHEME = "output";

/** `id` is the log channel (`extensions.host.stdout`), `label` the name in the selector. */
export interface IOutputChannelDescriptor {
    readonly id: string;
    readonly label: string;
}

/**
 * Separate from `ILogService`, as in VS Code: a logger is created ad hoc from a string, while an
 * Output channel needs a human-readable name.
 */
export interface IOutputChannelRegistry {
    registerChannel(descriptor: IOutputChannelDescriptor): void;
    getChannels(): readonly IOutputChannelDescriptor[];
    getChannel(id: string): IOutputChannelDescriptor | undefined;
    onDidRegisterChannel(listener: (descriptor: IOutputChannelDescriptor) => void): IDisposable;
}

/** Structurally a `RingBufferSink`; the live tail comes separately via `ILogService.onDidAppend`. */
export interface ILogHistory {
    getChannels(): readonly string[];
    getEntries(channel: string): readonly LogEntry[];
}

export const LogHistoryDIToken = token<ILogHistory>("LogHistory");
export const OutputChannelRegistryDIToken = token<IOutputChannelRegistry>("OutputChannelRegistry");
