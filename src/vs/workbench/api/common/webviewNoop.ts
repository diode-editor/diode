import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { DisposableImpl, EventEmitter } from "./vscodeTypes.ts";

/**
 * Diode will not have webviews by design, but a missing member killed the whole
 * extension: a chat panel's `activate()` failed on `is not a function` together with
 * the non-webview part. Calls return an inert object and write ONE line to Output.
 */

const OUTPUT_CHANNEL = "extensions";
const OUTPUT_LABEL = "Extensions";

/** Key part first: the Output line is cut at the panel width. */
function reportUnsupported(rpc: SubprocessRpc, member: string, id: string): void {
    rpc.notify("output.append", {
        channel: OUTPUT_CHANNEL,
        label: OUTPUT_LABEL,
        level: "warn",
        value: `webview is not supported in TUI: window.${member}("${id}") — no panel, the rest of the extension works`,
    });
}

/** Extensions write `html` right after creation — the property must be writable. */
interface IInertWebview {
    options: object;
    html: string;
    readonly cspSource: string;
    readonly onDidReceiveMessage: vscode.Event<unknown>;
    postMessage: (message: unknown) => Thenable<boolean>;
    asWebviewUri: (localResource: vscode.Uri) => vscode.Uri;
}

/** `dispose()` is idempotent (the panel goes into `context.subscriptions` and is also closed by hand) and fires `onDidDispose`. */
interface IInertWebviewPanel {
    readonly viewType: string;
    title: string;
    iconPath: undefined;
    readonly webview: IInertWebview;
    readonly options: object;
    readonly viewColumn: undefined;
    readonly active: boolean;
    readonly visible: boolean;
    readonly onDidChangeViewState: vscode.Event<unknown>;
    readonly onDidDispose: vscode.Event<void>;
    reveal: (viewColumn?: unknown, preserveFocus?: boolean) => void;
    dispose: () => void;
}

export interface IWebviewNoopMembers {
    createWebviewPanel: (
        viewType: string,
        title: string,
        showOptions?: unknown,
        options?: unknown,
    ) => IInertWebviewPanel;
    registerWebviewViewProvider: (viewId: string, provider: unknown, options?: unknown) => vscode.Disposable;
    registerWebviewPanelSerializer: (viewType: string, serializer: unknown) => vscode.Disposable;
    registerCustomEditorProvider: (viewType: string, provider: unknown, options?: unknown) => vscode.Disposable;
}

function createInertWebview(): IInertWebview {
    return {
        options: {},
        html: "",
        // Embedded into the CSP of html that is never rendered — arbitrary, but non-empty.
        cspSource: "diode-webview:",
        // postMessage answers "not delivered" — the same as a hidden vscode panel.
        onDidReceiveMessage: new EventEmitter<unknown>().event,
        postMessage: (): Thenable<boolean> => Promise.resolve(false),
        asWebviewUri: (localResource: vscode.Uri): vscode.Uri => localResource,
    };
}

function createInertPanel(viewType: string, title: string): IInertWebviewPanel {
    const onDidDispose = new EventEmitter<void>();
    let disposed = false;
    return {
        viewType,
        title,
        iconPath: undefined,
        webview: createInertWebview(),
        options: {},
        viewColumn: undefined,
        active: false,
        visible: false,
        onDidChangeViewState: new EventEmitter<unknown>().event,
        onDidDispose: onDidDispose.event,
        reveal: (): void => {
            /* nothing to show: there is no panel */
        },
        dispose: (): void => {
            if (disposed) return;
            disposed = true;
            onDidDispose.fire();
        },
    };
}

export function createWebviewNoopMembers(rpc: SubprocessRpc): IWebviewNoopMembers {
    return {
        createWebviewPanel: (viewType: string, title: string): IInertWebviewPanel => {
            reportUnsupported(rpc, "createWebviewPanel", viewType);
            return createInertPanel(viewType, title);
        },

        registerWebviewViewProvider: (viewId: string): vscode.Disposable => {
            reportUnsupported(rpc, "registerWebviewViewProvider", viewId);
            return new DisposableImpl(() => undefined);
        },

        registerWebviewPanelSerializer: (viewType: string): vscode.Disposable => {
            reportUnsupported(rpc, "registerWebviewPanelSerializer", viewType);
            return new DisposableImpl(() => undefined);
        },

        // `redhat.java` hosts its formatter settings editor on it: registration runs as the
        // first line of `activate()` and must not throw.
        registerCustomEditorProvider: (viewType: string): vscode.Disposable => {
            reportUnsupported(rpc, "registerCustomEditorProvider", viewType);
            return new DisposableImpl(() => undefined);
        },
    };
}
