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

export interface ILoggerOptions {
    /** Подпись в селекторе Output; без неё канал виден под сырым id, когда в него впервые напишут. */
    readonly label?: string;
}

export interface ILogChannelDescriptor {
    readonly id: string;
    readonly label: string;
}

/** Уровень канала — каскадом по точкам: `a.b.c` → `a.b` → `a` → `*`. */
export interface ILogService {
    /** Метку канала регистрирует первый вызов, который её передал. */
    createLogger(channel: string, options?: ILoggerOptions): ILogger;
    /** В порядке регистрации. */
    getRegisteredChannels(): readonly ILogChannelDescriptor[];
    onDidRegisterChannel(listener: (descriptor: ILogChannelDescriptor) => void): IDisposable;
    setLevel(channelOrWildcard: string, level: LogLevel): void;
    getLevel(channel: string): LogLevel;
    addSink(sink: ILogSink): IDisposable;
    onDidAppend(listener: (entry: LogEntry) => void): IDisposable;
}
