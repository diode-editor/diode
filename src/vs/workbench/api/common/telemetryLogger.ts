import type * as vscode from "vscode";

import { EventEmitter } from "./vscodeTypes.ts";

/**
 * `env.createTelemetryLogger` — эталонный логгер (`ExtHostTelemetryLogger` в
 * `extHostTelemetry.ts`) при навсегда выключенной телеметрии.
 *
 * Телеметрии в Diode нет вовсе (см. `env.isTelemetryEnabled`), поэтому это не
 * заглушка, а полный ответ: эталон с выключенными usage/errors тоже ни разу не
 * зовёт `sendEventData`/`sendErrorData` — `logUsage`/`logError` сразу выходят,
 * а `onDidChangeEnableStates` не стреляет, потому что состояние не меняется.
 * От отправителя остаётся только `flush` на первом `dispose`, как в эталоне.
 *
 * Без члена падал `@vscode/extension-telemetry`: его репортер строит логгер в
 * конструкторе, и расширение (`hashicorp.terraform`) умирало на первой строке
 * `activate()`.
 */
export function createTelemetryLogger(
    sender: vscode.TelemetrySender,
    _options?: vscode.TelemetryLoggerOptions,
): vscode.TelemetryLogger {
    validateSender(sender);
    let pending: vscode.TelemetrySender | undefined = sender;
    const onDidChangeEnableStates = new EventEmitter<vscode.TelemetryLogger>();
    return Object.freeze({
        isUsageEnabled: false,
        isErrorsEnabled: false,
        onDidChangeEnableStates: onDidChangeEnableStates.event,
        logUsage: (): void => undefined,
        logError: (): void => undefined,
        dispose: (): void => {
            const flushing = pending;
            pending = undefined;
            // Буфер отправителя сбрасывается без ожидания и без права уронить
            // субпроцесс: эталон тоже не ждёт `flush` и не смотрит в его исход.
            if (flushing?.flush) Promise.resolve(flushing.flush()).catch(() => undefined);
            onDidChangeEnableStates.dispose();
        },
    });
}

/** Проверка отправителя — дословно эталонная (`ExtHostTelemetryLogger.validateSender`). */
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
