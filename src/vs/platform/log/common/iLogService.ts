import type { IDisposable } from "@tuidom/all/common/disposable";

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

/**
 * Центральный сервис логирования. Создаёт логгеры по каналу, разруливает
 * уровень для канала (каскад по точкам: `a.b.c` → `a.b` → `a` → `*`),
 * фан-аутит записи во все подключённые `ILogSink`.
 */
export interface ILogService {
    createLogger(channel: string): ILogger;
    setLevel(channelOrWildcard: string, level: LogLevel): void;
    getLevel(channel: string): LogLevel;
    addSink(sink: ILogSink): IDisposable;
    onDidAppend(listener: (entry: LogEntry) => void): IDisposable;
}
