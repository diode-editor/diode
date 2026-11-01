import type * as vscode from "vscode";

import { Uri } from "../../../base/common/uri.ts";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { createMessageApi } from "./messageNamespace.ts";
import { DisposableImpl, EventEmitter } from "./vscodeTypes.ts";

/**
 * There is no debugger (docs/arch/StockExtensions.md), but without the namespace `golang.go`
 * crashed midway through `activate()` on `registerDebugConfigurationProvider`, and ~60
 * `go.*` commands never got registered. Shape follows upstream, behavior is "no sessions now
 * or ever"; the user gets one warn line in Output per debugger type and a toast per start attempt.
 */

const OUTPUT_CHANNEL = "extensions";
const OUTPUT_LABEL = "Extensions";

/** Never collides with a debugger type. */
const START_KEY = "\0start";

const START_REFUSED = "starting a debug session is not supported in TUI yet — no session started";

export function createDebugNoop(rpc: SubprocessRpc): typeof vscode.debug {
    const reported = new Set<string>();

    // The essential part first: an Output line is clipped to the panel width.
    function report(key: string, value: string): void {
        if (reported.has(key)) return;
        reported.add(key);
        rpc.notify("output.append", { channel: OUTPUT_CHANNEL, label: OUTPUT_LABEL, level: "warn", value });
    }

    function reportDebugType(debugType: string): void {
        report(
            debugType,
            `debugging "${debugType}" is not supported in TUI yet — no sessions, the rest of the extension works`,
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
        // Trackers are also registered for other types (`*`); they say nothing about the extension's debugger.
        registerDebugAdapterTrackerFactory: noopDisposable,
        startDebugging: (): Promise<boolean> => {
            report(START_KEY, START_REFUSED);
            // A user's gesture (`debug test` lens of golang.go) must not end in silence; every attempt gets its toast.
            // Not awaited: extensions await `startDebugging`, and a toast stays until it is dismissed.
            void createMessageApi(rpc)
                .showWarningMessage(START_REFUSED)
                .then(undefined, () => undefined);
            return Promise.resolve(false);
        },
        stopDebugging: (): Promise<void> => Promise.resolve(),
        addBreakpoints: (): void => undefined,
        removeBreakpoints: (): void => undefined,
        asDebugSourceUri,
    };
}

/** Like upstream's `ExtHostDebugServiceBase.asDebugSourceUri`. */
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
