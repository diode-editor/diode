import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { LogEntry } from "../../../../platform/log/common/iLogService.ts";

export const OUTPUT_VIEW_ID = "workbench.panel.output";

export const OUTPUT_LANGUAGE_ID = "log";

/** `output:<id>` — как в VS Code. */
export const OUTPUT_URI_SCHEME = "output";

/** `id` — канал логов (`extensions.host.stdout`), `label` — имя в селекторе. */
export interface IOutputChannelDescriptor {
    readonly id: string;
    readonly label: string;
}

/**
 * Отдельно от `ILogService`, как в VS Code: логгер заводится ad hoc по строке, а у канала
 * Output должно быть человекочитаемое имя.
 */
export interface IOutputChannelRegistry {
    registerChannel(descriptor: IOutputChannelDescriptor): void;
    getChannels(): readonly IOutputChannelDescriptor[];
    getChannel(id: string): IOutputChannelDescriptor | undefined;
    onDidRegisterChannel(listener: (descriptor: IOutputChannelDescriptor) => void): IDisposable;
}

/** Структурно — `RingBufferSink`; живой хвост — отдельно, через `ILogService.onDidAppend`. */
export interface ILogHistory {
    getChannels(): readonly string[];
    getEntries(channel: string): readonly LogEntry[];
}

export const LogHistoryDIToken = token<ILogHistory>("LogHistory");
export const OutputChannelRegistryDIToken = token<IOutputChannelRegistry>("OutputChannelRegistry");
