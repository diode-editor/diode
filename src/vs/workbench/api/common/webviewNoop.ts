import type * as vscode from "vscode";

import type { RpcEndpoint } from "./rpcEndpoint.ts";
import { DisposableImpl, EventEmitter } from "./vscodeTypes.ts";

/**
 * Webview-часть `vscode.window` как честный no-op.
 *
 * Webview в Diode не будет **by design** (терминал не рисует браузер, см.
 * матрицу готовности API) — но отсутствие члена в шиме убивало расширение
 * ЦЕЛИКОМ: `activate()` типовой чат-панели поднимает панель первой строкой,
 * ловит `is not a function` и умирает вместе со своей не-webview частью
 * (команды, провайдеры, призрачные подсказки). Пользователь получал не
 * «расширение без панели», а мёртвое расширение.
 *
 * Поэтому три точки входа существуют и ничего не делают (по образцу наивных
 * `tasks`/`extensions` в `vscodeNamespace.ts`): вызов возвращает
 * инертный объект, панель не появляется, а в панель Output уходит ОДНА внятная
 * строка про неподдерживаемый webview — иначе единственным следом остаётся
 * `diode.log`, которого пользователь не видит.
 *
 * Декларации в `vscode.d.ts` при этом остаются закомментированными: статус
 * webview — ⛔ «не будет by design», рантайм-заглушка его не меняет.
 */

/** Канал панели Output для отказа: `extensions` уже в реестре ядра (label «Extensions»). */
const OUTPUT_CHANNEL = "extensions";
const OUTPUT_LABEL = "Extensions";

/**
 * Одна строка в Output на каждый webview-вызов: что позвали и что из этого
 * вышло. Главное — первым, а не в хвосте: строка Output обрезается шириной
 * панели, и «не поддерживается» обязано быть видно без горизонтальной прокрутки.
 */
function reportUnsupported(rpc: RpcEndpoint, member: string, id: string): void {
    rpc.notify("output.append", {
        channel: OUTPUT_CHANNEL,
        label: OUTPUT_LABEL,
        level: "warn",
        value: `webview в TUI не поддерживается: window.${member}("${id}") — панели не будет, остальное расширение работает`,
    });
}

/**
 * Инертный `Webview`: форма upstream без поведения. `html` расширение пишет
 * сразу после создания панели — свойство обязано быть записываемым, иначе
 * `activate()` падает на первом же присваивании.
 */
interface IInertWebview {
    options: object;
    html: string;
    readonly cspSource: string;
    readonly onDidReceiveMessage: vscode.Event<unknown>;
    postMessage: (message: unknown) => Thenable<boolean>;
    asWebviewUri: (localResource: vscode.Uri) => vscode.Uri;
}

/**
 * Инертный `WebviewPanel`: панели нет, поэтому `visible`/`active` — честные
 * `false`, `viewColumn` — `undefined` (панель не занимает колонку), а
 * `onDidChangeViewState` никогда не стреляет. `dispose()` стреляет
 * `onDidDispose` (расширения держат на нём сброс своей ссылки на панель) и
 * идемпотентен — панель кладут и в `context.subscriptions`, и закрывают сами.
 */
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

/** Три webview-члена `vscode.window`; подмешиваются в неймспейс окна. */
export interface IWebviewNoopMembers {
    createWebviewPanel: (
        viewType: string,
        title: string,
        showOptions?: unknown,
        options?: unknown,
    ) => IInertWebviewPanel;
    registerWebviewViewProvider: (viewId: string, provider: unknown, options?: unknown) => vscode.Disposable;
    registerWebviewPanelSerializer: (viewType: string, serializer: unknown) => vscode.Disposable;
}

function createInertWebview(): IInertWebview {
    return {
        options: {},
        html: "",
        // Расширения вшивают cspSource в `<meta http-equiv="Content-Security-Policy">`
        // никогда не рисуемого html — значение произвольное, но непустое.
        cspSource: "diode-webview:",
        // Сообщений из панели не будет — событие не стреляет; postMessage честно
        // отвечает «не доставлено» (в vscode так же отвечает скрытая панель).
        onDidReceiveMessage: new EventEmitter<unknown>().event,
        postMessage: (): Thenable<boolean> => Promise.resolve(false),
        // Локальные ресурсы никуда не проксируются — uri возвращается как есть.
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

export function createWebviewNoopMembers(rpc: RpcEndpoint): IWebviewNoopMembers {
    return {
        createWebviewPanel: (viewType: string, title: string): IInertWebviewPanel => {
            reportUnsupported(rpc, "createWebviewPanel", viewType);
            return createInertPanel(viewType, title);
        },

        // `resolveWebviewView` провайдера никто не позовёт — вьюлета webview в
        // TUI нет; disposable честный (отписываться не от чего).
        registerWebviewViewProvider: (viewId: string): vscode.Disposable => {
            reportUnsupported(rpc, "registerWebviewViewProvider", viewId);
            return new DisposableImpl(() => undefined) as unknown as vscode.Disposable;
        },

        // Сериализатор восстанавливает панели прошлой сессии; панелей не бывает,
        // поэтому `deserializeWebviewPanel` тоже никто не позовёт.
        registerWebviewPanelSerializer: (viewType: string): vscode.Disposable => {
            reportUnsupported(rpc, "registerWebviewPanelSerializer", viewType);
            return new DisposableImpl(() => undefined) as unknown as vscode.Disposable;
        },
    };
}
