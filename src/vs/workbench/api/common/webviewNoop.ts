import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { DisposableImpl, EventEmitter } from "./vscodeTypes.ts";

/**
 * Webview в Diode не будет by design, но отсутствующий член убивал расширение
 * целиком: `activate()` чат-панели падал на `is not a function` вместе с
 * не-webview частью. Вызовы возвращают инертный объект и пишут ОДНУ строку в Output.
 */

const OUTPUT_CHANNEL = "extensions";
const OUTPUT_LABEL = "Extensions";

/** Главное — первым: строка Output обрезается шириной панели. */
function reportUnsupported(rpc: SubprocessRpc, member: string, id: string): void {
    rpc.notify("output.append", {
        channel: OUTPUT_CHANNEL,
        label: OUTPUT_LABEL,
        level: "warn",
        value: `webview в TUI не поддерживается: window.${member}("${id}") — панели не будет, остальное расширение работает`,
    });
}

/** `html` расширение пишет сразу после создания — свойство обязано быть записываемым. */
interface IInertWebview {
    options: object;
    html: string;
    readonly cspSource: string;
    readonly onDidReceiveMessage: vscode.Event<unknown>;
    postMessage: (message: unknown) => Thenable<boolean>;
    asWebviewUri: (localResource: vscode.Uri) => vscode.Uri;
}

/** `dispose()` идемпотентен (панель кладут и в `context.subscriptions`, и закрывают сами) и стреляет `onDidDispose`. */
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
        // Вшивается в CSP никогда не рисуемого html — произвольное, но непустое.
        cspSource: "diode-webview:",
        // postMessage отвечает «не доставлено» — так же отвечает скрытая панель vscode.
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
            /* показывать нечего: панели нет */
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

        // У `redhat.java` на нём редактор настроек форматтера: регистрация идёт в
        // `activate()` первой строкой и обязана не падать.
        registerCustomEditorProvider: (viewType: string): vscode.Disposable => {
            reportUnsupported(rpc, "registerCustomEditorProvider", viewType);
            return new DisposableImpl(() => undefined);
        },
    };
}
