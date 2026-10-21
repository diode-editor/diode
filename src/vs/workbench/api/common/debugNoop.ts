import type * as vscode from "vscode";

import { Uri } from "../../../base/common/uri.ts";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { DisposableImpl, EventEmitter } from "./vscodeTypes.ts";

/**
 * Дебаггера нет (docs/arch/StockExtensions.md), но без namespace'а `golang.go`
 * падал посреди `activate()` на `registerDebugConfigurationProvider`, и ~60
 * команд `go.*` не регистрировались. Форма — эталонная, поведение — «сессий нет
 * и не будет»; человеку — одна warn-строка в Output на тип отладчика.
 */

const OUTPUT_CHANNEL = "extensions";
const OUTPUT_LABEL = "Extensions";

/** Не пересекается с типами отладчиков. */
const START_KEY = "\0start";

export function createDebugNoop(rpc: SubprocessRpc): typeof vscode.debug {
    const reported = new Set<string>();

    // Главное — первым: строка Output обрезается шириной панели.
    function report(key: string, value: string): void {
        if (reported.has(key)) return;
        reported.add(key);
        rpc.notify("output.append", { channel: OUTPUT_CHANNEL, label: OUTPUT_LABEL, level: "warn", value });
    }

    function reportDebugType(debugType: string): void {
        report(
            debugType,
            `отладка "${debugType}" в TUI пока не поддержана — сессий не будет, остальное расширение работает`,
        );
    }

    const noopDisposable = (): vscode.Disposable => new DisposableImpl(() => undefined);

    return {
        activeDebugSession: undefined,
        activeDebugConsole: { append: (): void => undefined, appendLine: (): void => undefined },
        breakpoints: [],
        activeStackItem: undefined,
        onDidChangeActiveDebugSession: new EventEmitter<vscode.DebugSession | undefined>().event,
        onDidStartDebugSession: new EventEmitter<vscode.DebugSession>().event,
        onDidReceiveDebugSessionCustomEvent: new EventEmitter<vscode.DebugSessionCustomEvent>().event,
        onDidTerminateDebugSession: new EventEmitter<vscode.DebugSession>().event,
        onDidChangeBreakpoints: new EventEmitter<vscode.BreakpointsChangeEvent>().event,
        onDidChangeActiveStackItem: new EventEmitter<vscode.DebugThread | vscode.DebugStackFrame | undefined>().event,
        registerDebugConfigurationProvider: (debugType: string): vscode.Disposable => {
            reportDebugType(debugType);
            return noopDisposable();
        },
        registerDebugAdapterDescriptorFactory: (debugType: string): vscode.Disposable => {
            reportDebugType(debugType);
            return noopDisposable();
        },
        // Трекеры вешают и на чужие типы (`*`) — о дебаггере расширения не говорят.
        registerDebugAdapterTrackerFactory: noopDisposable,
        startDebugging: (): Promise<boolean> => {
            report(START_KEY, "запуск отладки в TUI пока не поддержан — сессия не начата");
            return Promise.resolve(false);
        },
        stopDebugging: (): Promise<void> => Promise.resolve(),
        addBreakpoints: (): void => undefined,
        removeBreakpoints: (): void => undefined,
        asDebugSourceUri,
    };
}

/** Как `ExtHostDebugServiceBase.asDebugSourceUri` эталона. */
function asDebugSourceUri(source: vscode.DebugProtocolSource, session?: vscode.DebugSession): vscode.Uri {
    const { path, sourceReference } = source as { path?: unknown; sourceReference?: unknown };
    const pathText = typeof path === "string" ? path : "";
    if (typeof sourceReference === "number" && sourceReference > 0) {
        let debug = `debug:${encodeURIComponent(pathText)}`;
        let sep = "?";
        if (session !== undefined) {
            debug += `${sep}session=${encodeURIComponent(session.id)}`;
            sep = "&";
        }
        debug += `${sep}ref=${String(sourceReference)}`;
        return Uri.parse(debug);
    }
    if (pathText !== "") return Uri.file(pathText);
    throw new Error(
        "cannot create uri from DAP 'source' object; properties 'path' and 'sourceReference' are both missing.",
    );
}
