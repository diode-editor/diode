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
    /** Label in the Output selector; without it the channel shows under its raw id once first written to. */
    readonly label?: string;
}

export interface ILogChannelDescriptor {
    readonly id: string;
    readonly label: string;
}

/** A channel's level cascades by dots: `a.b.c` → `a.b` → `a` → `*`. */
export interface ILogService {
    /** The channel label is registered by the first call that passes one. */
    createLogger(channel: string, options?: ILoggerOptions): ILogger;
    /** In registration order. */
    getRegisteredChannels(): readonly ILogChannelDescriptor[];
    onDidRegisterChannel(listener: (descriptor: ILogChannelDescriptor) => void): IDisposable;
    setLevel(channelOrWildcard: string, level: LogLevel): void;
    getLevel(channel: string): LogLevel;
    addSink(sink: ILogSink): IDisposable;
    onDidAppend(listener: (entry: LogEntry) => void): IDisposable;
}
