import type { IDisposable } from "../../../base/common/lifecycle.ts";

import type { ILogger } from "./iLogger.ts";
import type { LogLevel } from "./logLevel.ts";

export interface LogEntry {
    /** Unix epoch milliseconds. */
    readonly timestamp: number;
    readonly channel: string;
    readonly level: LogLevel;
    readonly message: string;
    readonly args: readonly unknown[];
}

export interface ILogSink {
    append(entry: LogEntry): void;
    dispose(): void;
}

/** Параметры канала, которые знает только тот, кто его заводит. */
export interface ILoggerOptions {
    /**
     * Человекочитаемое имя канала — подпись в селекторе Output («Extension Host»
     * вместо `extensions.host`). Аналог `ILoggerOptions.name` vscode. Без него
     * канал всё равно виден — под сырым id, когда в него впервые напишут.
     */
    readonly label?: string;
}

/** Канал, которому создатель логгера дал имя ({@link ILoggerOptions.label}). */
export interface ILogChannelDescriptor {
    readonly id: string;
    readonly label: string;
}

/**
 * Центральный сервис логирования. Создаёт логгеры по каналу, разруливает
 * уровень для канала (каскад по точкам: `a.b.c` → `a.b` → `a` → `*`),
 * фан-аутит записи во все подключённые `ILogSink`.
 */
export interface ILogService {
    /**
     * Логгер канала. Метку канала регистрирует первый вызов, который её передал;
     * повторные вызовы по тому же каналу её не меняют.
     */
    createLogger(channel: string, options?: ILoggerOptions): ILogger;
    /** Каналы с метками — в порядке регистрации (аналог `getRegisteredLoggers` vscode). */
    getRegisteredChannels(): readonly ILogChannelDescriptor[];
    onDidRegisterChannel(listener: (descriptor: ILogChannelDescriptor) => void): IDisposable;
    setLevel(channelOrWildcard: string, level: LogLevel): void;
    getLevel(channel: string): LogLevel;
    addSink(sink: ILogSink): IDisposable;
    onDidAppend(listener: (entry: LogEntry) => void): IDisposable;
}
