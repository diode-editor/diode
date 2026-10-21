import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { DisposableImpl, EventEmitter } from "./vscodeTypes.ts";

/**
 * Заглушка до честного дерева (Phase 8b в docs/TODO/Extensions.md): без члена `activate()`
 * падал на `is not a function` и уносил команды и задачи. Форма эталонная (`extHostTreeViews.ts`).
 *
 * Отступление: незаконтрибьюченный view эталон встречает тостом-ошибкой, у нас — одна warn-строка
 * в Output на `viewId` за жизнь субпроцесса.
 */

const OUTPUT_CHANNEL = "extensions";
const OUTPUT_LABEL = "Extensions";

export interface ITreeViewNoopMembers {
    registerTreeDataProvider: <T>(viewId: string, treeDataProvider: vscode.TreeDataProvider<T>) => vscode.Disposable;
    createTreeView: <T>(viewId: string, options: vscode.TreeViewOptions<T>) => vscode.TreeView<T>;
}

/** `title`/`message`/`description`/`badge` записываемые: расширения присваивают их на каждый рефреш. */
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
            // Эталон в dispose освобождает view; у инертного нечего — честная проводка вернёт сюда `treeView.dispose()`.
            createTreeView(viewId, { treeDataProvider });
            return new DisposableImpl(() => undefined);
        },
        createTreeView,
    };
}
