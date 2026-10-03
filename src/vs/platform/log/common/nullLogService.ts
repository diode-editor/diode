import type { IDisposable } from "../../../base/common/lifecycle.ts";

import type { ILogger } from "./iLogger.ts";
import type { ILogChannelDescriptor, ILoggerOptions, ILogService, ILogSink, LogEntry } from "./iLogService.ts";
import { LogLevel } from "./logLevel.ts";

const NOOP_DISPOSABLE: IDisposable = {
    /* v8 ignore start -- null-object stub: the no-op disposable returned by addSink/onDidAppend is never disposed in tests */
    dispose: () => {
        /* no-op */
    },
    /* v8 ignore stop */
};

/** Логгер, который ничего не пишет — для потребителей без своего канала. */
export const NULL_LOGGER: ILogger = {
    trace: () => {
        /* no-op */
    },
    debug: () => {
        /* no-op */
    },
    info: () => {
        /* no-op */
    },
    warn: () => {
        /* no-op */
    },
    error: () => {
        /* no-op */
    },
    isEnabled: () => false,
};

/**
 * No-op реализация `ILogService` для тестов и demo. Никаких sinks, никаких
 * аллокаций при логировании, `isEnabled` всегда возвращает false.
 */
export const NULL_LOG_SERVICE: ILogService = {
    createLogger(_channel: string, _options?: ILoggerOptions): ILogger {
        return NULL_LOGGER;
    },
    getRegisteredChannels(): readonly ILogChannelDescriptor[] {
        return [];
    },
    onDidRegisterChannel(_listener: (descriptor: ILogChannelDescriptor) => void): IDisposable {
        return NOOP_DISPOSABLE;
    },
    /* v8 ignore start -- null-object stub: setLevel is a no-op and is never invoked in tests */
    setLevel(_channelOrWildcard: string, _level: LogLevel): void {
        /* no-op */
    },
    /* v8 ignore stop */
    getLevel(_channel: string): LogLevel {
        return LogLevel.Off;
    },
    addSink(_sink: ILogSink): IDisposable {
        return NOOP_DISPOSABLE;
    },
    onDidAppend(_listener: (entry: LogEntry) => void): IDisposable {
        return NOOP_DISPOSABLE;
    },
};
