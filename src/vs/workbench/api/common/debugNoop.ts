import type * as vscode from "vscode";

import { Uri } from "../../../base/common/uri.ts";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { DisposableImpl, EventEmitter } from "./vscodeTypes.ts";

/**
 * `vscode.debug` как null-объект: дебаггера (DAP) в Diode нет и пока не
 * планируется (решение человека, docs/arch/StockExtensions.md), а отсутствие namespace'а
 * убивало расширение ЦЕЛИКОМ. `golang.go` регистрирует провайдер конфигураций
 * и фабрику адаптера посреди `activate()` — `Cannot read properties of
 * undefined (reading 'registerDebugConfigurationProvider')` обрывал активацию,
 * и ~60 команд `go.*` после этой точки так и не регистрировались (gopls при
 * этом уже жил).
 *
 * Форма — эталонная (`extHostDebugService.ts`), поведение — «сессий нет и не
 * будет»:
 * - `register*` — `Disposable`, провайдеры и фабрики никто не зовёт (у эталона
 *   их зовёт запуск сессии, которого у нас не бывает);
 * - `activeDebugSession`/`activeStackItem` — `undefined`, `breakpoints` — пусто,
 *   события не стреляют, `activeDebugConsole` — консоль, которую некому
 *   показать (эталон с неактивной сессией вывод тоже не показывает);
 * - `startDebugging` — `false` («не удалось начать»), `stopDebugging` —
 *   выполнено (останавливать нечего), `add/removeBreakpoints` — no-op;
 * - `asDebugSourceUri` — честный, по эталону: чистая функция над DAP-`Source`.
 *
 * Человеку — одна warn-строка в Output на тип отладчика за жизнь субпроцесса
 * (и одна — на попытку запуска), иначе единственным следом остался бы
 * `diode.log`. События активации `onDebug*` при этом не стреляют (🕐 в
 * API-COVERAGE).
 */

/** Канал панели Output для отказа: `extensions` уже в реестре ядра (label «Extensions»). */
const OUTPUT_CHANNEL = "extensions";
const OUTPUT_LABEL = "Extensions";

/** Ключ отказа запуска в общем наборе «уже сказали» — не пересекается с типами отладчиков. */
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
        // Трекеры вешают и на чужие типы (`*`) — сами по себе о дебаггере расширения не говорят.
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

/** Эталон `ExtHostDebugServiceBase.asDebugSourceUri` дословно по смыслу. */
function asDebugSourceUri(source: vscode.DebugProtocolSource, session?: vscode.DebugSession): vscode.Uri {
    // DebugProtocolSource — непрозрачный тип: поля DAP-`Source` читаем как есть.
    const { path, sourceReference } = source as { path?: unknown; sourceReference?: unknown };
    const pathText = typeof path === "string" ? path : "";
    if (typeof sourceReference === "number" && sourceReference > 0) {
        // Содержимое достаётся DAP-запросом `source` — `debug:`-uri с ссылкой.
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
