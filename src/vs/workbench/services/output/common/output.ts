import type { IDisposable } from "@tuidom/core/common/disposable";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { LogEntry } from "../../../../platform/log/common/iLogService.ts";

/** VS Code view id вкладки Output в нижней Panel. */
export const OUTPUT_VIEW_ID = "workbench.panel.output";

/** Язык, которым подсвечивается содержимое Output (стоковое расширение `log`). */
export const OUTPUT_LANGUAGE_ID = "log";

/** Схема синтетического ресурса канала: `output:<id>` — как в VS Code. */
export const OUTPUT_URI_SCHEME = "output";

/**
 * Описание канала Output (аналог `IOutputChannelDescriptor`). `id` — это канал
 * логов (`extensions.host.stdout`), `label` — то, что видит пользователь в
 * селекторе («Extension Host (stdout)»).
 */
export interface IOutputChannelDescriptor {
    readonly id: string;
    readonly label: string;
}

/**
 * Реестр каналов Output — аналог `IOutputChannelRegistry` VS Code. Отдельный от
 * `ILogService` по той же причине, что и в оригинале: логгер заводится ad hoc по
 * строке-каналу, а у канала Output должно быть человекочитаемое имя. Каналы, о
 * которых никто не объявил, реестр добирает сам (см. `OutputService`), иначе
 * подсистема была бы невидима в селекторе.
 */
export interface IOutputChannelRegistry {
    registerChannel(descriptor: IOutputChannelDescriptor): void;
    getChannels(): readonly IOutputChannelDescriptor[];
    getChannel(id: string): IOutputChannelDescriptor | undefined;
    onDidRegisterChannel(listener: (descriptor: IOutputChannelDescriptor) => void): IDisposable;
}

/**
 * История записей по каналам — минимальный порт `RingBufferSink` (структурно ему
 * соответствует, связывание делает DI-модуль). Живой хвост приходит отдельно,
 * через `ILogService.onDidAppend`.
 */
export interface ILogHistory {
    getChannels(): readonly string[];
    getEntries(channel: string): readonly LogEntry[];
}

export const LogHistoryDIToken = token<ILogHistory>("LogHistory");
export const OutputChannelRegistryDIToken = token<IOutputChannelRegistry>("OutputChannelRegistry");
