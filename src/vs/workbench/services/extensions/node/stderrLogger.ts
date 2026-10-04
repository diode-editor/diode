import { describeRejection } from "../../../../base/common/describeRejection.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import { LogLevel } from "../../../../platform/log/common/logLevel.ts";

/**
 * Логгер субпроцесса extension host'а: warn/error — строкой в stderr с
 * префиксом `[ext-host]` (host зеркалит stderr в канал `extensions.host.stderr`).
 * trace/debug/info молчат: уровня в субпроцессе нет, а трассу RPC пишет хост
 * (`extensions.host.rpc`) — дублировать каждое сообщение в stderr было бы шумом.
 * Аргументы дописываются через `: `, ошибка — со стеком.
 */
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
