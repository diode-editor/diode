import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { DisposableImpl, EventEmitter } from "./vscodeTypes.ts";

/**
 * Деревья расширений (`window.registerTreeDataProvider` / `createTreeView`)
 * как заглушка до честного дерева (Phase 8b в docs/TODO/Extensions.md).
 *
 * Отсутствие члена убивало расширение ЦЕЛИКОМ: типовое «дерево целей сборки»
 * регистрирует провайдер второй строкой `activate()`, ловит `is not a function`
 * и уносит с собой команды и задачи. Поэтому регистрация принимается, а
 * провайдер никто не зовёт: дерева не будет, остальное расширение работает.
 *
 * Форма — эталонная (`extHostTreeViews.ts`): `registerTreeDataProvider` —
 * это `createTreeView` + dispose, а `createTreeView` без `treeDataProvider`
 * бросает. Честная проводка заменит эту заглушку без смены поверхности.
 *
 * Отступление от эталона: незаконтрибьюченный view эталон встречает тостом-
 * ошибкой (`mainThreadTreeViews.ts`), а у нас view законтрибьючен, но не
 * рисуется — человеку уходит одна warn-строка в Output на каждый `viewId` за
 * жизнь субпроцесса (иначе единственным следом остался бы `diode.log`).
 */

/** Канал панели Output для отказа: `extensions` уже в реестре ядра (label «Extensions»). */
const OUTPUT_CHANNEL = "extensions";
const OUTPUT_LABEL = "Extensions";

/** Члены `vscode.window` про деревья; подмешиваются в неймспейс окна. */
export interface ITreeViewNoopMembers {
    registerTreeDataProvider: <T>(viewId: string, treeDataProvider: vscode.TreeDataProvider<T>) => vscode.Disposable;
    createTreeView: <T>(viewId: string, options: vscode.TreeViewOptions<T>) => vscode.TreeView<T>;
}

/**
 * Инертный `TreeView`: дерева нет, поэтому `visible` — честный `false`,
 * выделение пустое, события не стреляют, `reveal` резолвится сразу (показывать
 * нечего). `title`/`message`/`description`/`badge` записываемые — расширения
 * обновляют их на каждый рефреш, и присваивание не должно падать.
 */
function createInertTreeView<T>(): vscode.TreeView<T> {
    return {
        onDidExpandElement: new EventEmitter<vscode.TreeViewExpansionEvent<T>>().event,
        onDidCollapseElement: new EventEmitter<vscode.TreeViewExpansionEvent<T>>().event,
        selection: [],
        onDidChangeSelection: new EventEmitter<vscode.TreeViewSelectionChangeEvent<T>>().event,
        visible: false,
        onDidChangeVisibility: new EventEmitter<vscode.TreeViewVisibilityChangeEvent>().event,
        onDidChangeCheckboxState: new EventEmitter<vscode.TreeCheckboxChangeEvent<T>>().event,
        message: undefined,
        title: undefined,
        description: undefined,
        badge: undefined,
        reveal: (): Thenable<void> => Promise.resolve(),
        // Отписываться не от чего — повторный dispose (subscriptions + сам) безвреден.
        dispose: (): void => undefined,
    };
}

export function createTreeViewNoopMembers(rpc: SubprocessRpc): ITreeViewNoopMembers {
    const reported = new Set<string>();

    // Главное — первым: строка Output обрезается шириной панели.
    function reportUnsupported(viewId: string): void {
        if (reported.has(viewId)) return;
        reported.add(viewId);
        rpc.notify("output.append", {
            channel: OUTPUT_CHANNEL,
            label: OUTPUT_LABEL,
            level: "warn",
            value: `дерево "${viewId}" в TUI пока не рисуется — панели не будет, остальное расширение работает`,
        });
    }

    function createTreeView<T>(viewId: string, options: vscode.TreeViewOptions<T>): vscode.TreeView<T> {
        // Расширение без типов может прийти без опций — эталон бросает так же.
        const provider = (options as { treeDataProvider?: unknown } | null | undefined)?.treeDataProvider;
        if (provider === undefined || provider === null) throw new Error("Options with treeDataProvider is mandatory");
        reportUnsupported(viewId);
        return createInertTreeView<T>();
    }

    return {
        registerTreeDataProvider: <T>(
            viewId: string,
            treeDataProvider: vscode.TreeDataProvider<T>,
        ): vscode.Disposable => {
            const treeView = createTreeView(viewId, { treeDataProvider });
            return new DisposableImpl(() => {
                treeView.dispose();
            });
        },
        createTreeView,
    };
}
