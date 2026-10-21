import { describeRejection } from "../../../../base/common/describeRejection.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import { LogLevel } from "../../../../platform/log/common/logLevel.ts";

/** trace/debug/info молчат: трассу RPC пишет хост, дубль каждого сообщения в stderr — шум. */
export function createStderrLogger(
    write: (line: string) => void = (line) => {
        console.error(line);
    },
): ILogger {
    const emit = (message: string, args: unknown[]): void => {
        write(["[ext-host] " + message, ...args.map(describeRejection)].join(": "));
    };
    const silent = (): void => undefined;
    return {
        trace: silent,
        debug: silent,
        info: silent,
        warn: (message, ...args) => {
            emit(message, args);
        },
        error: (message, ...args) => {
            emit(message, args);
        },
        isEnabled: (level) => level >= LogLevel.Warn,
    };
}
