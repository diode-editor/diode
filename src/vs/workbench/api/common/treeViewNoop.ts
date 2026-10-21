import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { DisposableImpl, EventEmitter } from "./vscodeTypes.ts";

/**
 * Stub until a real tree (Phase 8b in docs/TODO/Extensions.md): without this member `activate()`
 * failed with `is not a function` and took commands and tasks down with it. The shape follows upstream (`extHostTreeViews.ts`).
 *
 * Deviation: upstream greets a non-contributed view with an error toast; we log one warn line
 * in Output per `viewId` for the subprocess lifetime.
 */

const OUTPUT_CHANNEL = "extensions";
const OUTPUT_LABEL = "Extensions";

export interface ITreeViewNoopMembers {
    registerTreeDataProvider: <T>(viewId: string, treeDataProvider: vscode.TreeDataProvider<T>) => vscode.Disposable;
    createTreeView: <T>(viewId: string, options: vscode.TreeViewOptions<T>) => vscode.TreeView<T>;
}

/** `title`/`message`/`description`/`badge` are writable: extensions assign them on every refresh. */
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

    // The key part first: the Output line is cut off at the panel width.
    function reportUnsupported(viewId: string): void {
        if (reported.has(viewId)) return;
        reported.add(viewId);
        rpc.notify("output.append", {
            channel: OUTPUT_CHANNEL,
            label: OUTPUT_LABEL,
            level: "warn",
            value: `tree view "${viewId}" is not rendered in TUI yet — no panel, the rest of the extension works`,
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
            // Upstream frees the view on dispose; an inert one has nothing to free — real wiring will put `treeView.dispose()` back here.
            createTreeView(viewId, { treeDataProvider });
            return new DisposableImpl(() => undefined);
        },
        createTreeView,
    };
}
