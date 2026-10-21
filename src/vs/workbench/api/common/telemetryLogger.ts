import type * as vscode from "vscode";

import { EventEmitter } from "./vscodeTypes.ts";

/**
 * Upstream's `ExtHostTelemetryLogger` with telemetry permanently off — not a stub but the complete
 * answer: upstream with usage/errors disabled does not call `send*Data` either. Without this member
 * `@vscode/extension-telemetry` crashed `activate()` (`hashicorp.terraform`).
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
            // Upstream does not await `flush` or check its outcome either.
            if (flushing?.flush) Promise.resolve(flushing.flush()).catch(() => undefined);
        },
    });
}

/** Verbatim upstream `ExtHostTelemetryLogger.validateSender`. */
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
