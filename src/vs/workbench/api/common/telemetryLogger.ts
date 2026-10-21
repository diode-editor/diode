import type * as vscode from "vscode";

import { EventEmitter } from "./vscodeTypes.ts";

/**
 * `ExtHostTelemetryLogger` эталона при навсегда выключенной телеметрии — не заглушка, а полный
 * ответ: эталон с выключенными usage/errors тоже не зовёт `send*Data`. Без члена
 * `@vscode/extension-telemetry` ронял `activate()` (`hashicorp.terraform`).
 */
export function createTelemetryLogger(
    sender: vscode.TelemetrySender,
    _options?: vscode.TelemetryLoggerOptions,
): vscode.TelemetryLogger {
    validateSender(sender);
    let pending: vscode.TelemetrySender | undefined = sender;
    return Object.freeze({
        isUsageEnabled: false,
        isErrorsEnabled: false,
        onDidChangeEnableStates: new EventEmitter<vscode.TelemetryLogger>().event,
        logUsage: (): void => undefined,
        logError: (): void => undefined,
        dispose: (): void => {
            const flushing = pending;
            pending = undefined;
            // Эталон тоже не ждёт `flush` и не смотрит в его исход.
            if (flushing?.flush) Promise.resolve(flushing.flush()).catch(() => undefined);
        },
    });
}

/** Дословно `ExtHostTelemetryLogger.validateSender`. */
function validateSender(sender: vscode.TelemetrySender): void {
    const candidate = sender as Partial<vscode.TelemetrySender> | null;
    if (typeof candidate !== "object") {
        throw new TypeError("TelemetrySender argument is invalid");
    }
    if (typeof candidate?.sendEventData !== "function") {
        throw new TypeError("TelemetrySender.sendEventData must be a function");
    }
    if (typeof candidate.sendErrorData !== "function") {
        throw new TypeError("TelemetrySender.sendErrorData must be a function");
    }
    if (typeof candidate.flush !== "undefined" && typeof candidate.flush !== "function") {
        throw new TypeError("TelemetrySender.flush must be a function or undefined");
    }
}
