import * as vscode from "vscode";

// The part of upstream's `extensions/references-view` other extensions depend on: `setInput`/`getInput` and the tree
// with its context keys. redhat.java shows its type hierarchy only through this API. References and both hierarchies of
// the core are native (`contrib/references`), so upstream's commands, history, editor highlights and F4 are not here.

interface ISymbolTreeModel {
    readonly provider: vscode.TreeDataProvider<unknown>;
    readonly message?: string;
    readonly navigation?: { nearest(uri: vscode.Uri, position: vscode.Position): unknown };
    dispose?(): void;
}

interface ISymbolTreeInput {
    readonly title: string;
    readonly location: vscode.Location;
    readonly contextValue: string;
    resolve(): Thenable<ISymbolTreeModel | undefined> | ISymbolTreeModel | undefined;
}

const VIEW_ID = "references-view.tree";

const NO_CHILDREN: vscode.TreeDataProvider<unknown> = {
    getTreeItem: () => new vscode.TreeItem(""),
    getChildren: () => [],
};

function setContext(key: string, value: unknown): void {
    void vscode.commands.executeCommand("setContext", key, value);
}

/** Upstream's `TreeDataProviderDelegate`: one tree view over the provider of the current input. */
class TreeDataProviderDelegate implements vscode.TreeDataProvider<unknown> {
    private readonly changed = new vscode.EventEmitter<unknown>();
    private provider: Promise<vscode.TreeDataProvider<unknown>> = Promise.resolve(NO_CHILDREN);
    private subscription: vscode.Disposable | undefined;

    public readonly onDidChangeTreeData = this.changed.event;

    public update(provider: Promise<vscode.TreeDataProvider<unknown>>): void {
        this.subscription?.dispose();
        this.subscription = undefined;
        this.provider = provider;
        this.changed.fire(undefined);
        void provider.then((value) => {
            if (this.provider === provider && value.onDidChangeTreeData !== undefined) {
                this.subscription = value.onDidChangeTreeData((element) => {
                    this.changed.fire(element);
                });
            }
        });
    }

    public async getTreeItem(element: unknown): Promise<vscode.TreeItem> {
        return (await this.provider).getTreeItem(element);
    }

    public async getChildren(parent?: unknown): Promise<unknown[] | null | undefined> {
        return (await this.provider).getChildren(parent);
    }

    public async getParent(element: unknown): Promise<unknown> {
        return (await this.provider).getParent?.(element);
    }
}

class SymbolsTree {
    private readonly provider = new TreeDataProviderDelegate();
    private readonly tree = vscode.window.createTreeView<unknown>(VIEW_ID, {
        treeDataProvider: this.provider,
        showCollapseAll: true,
    });
    private input: ISymbolTreeInput | undefined;
    private model: ISymbolTreeModel | undefined;

    public getInput(): ISymbolTreeInput | undefined {
        return this.input;
    }

    public async setInput(input: ISymbolTreeInput): Promise<void> {
        setContext("reference-list.source", input.contextValue);
        setContext("reference-list.isActive", true);
        setContext("reference-list.hasResult", true);
        void vscode.commands.executeCommand(`${VIEW_ID}.focus`);

        this.input = input;
        this.model?.dispose?.();
        this.model = undefined;
        this.tree.title = input.title;

        const modelPromise = Promise.resolve(input.resolve());
        this.provider.update(modelPromise.then((model) => model?.provider ?? NO_CHILDREN));
        const model = await modelPromise;
        if (this.input !== input) {
            model?.dispose?.();
            return;
        }
        if (model === undefined) {
            this.clearInput();
            return;
        }
        this.model = model;
        this.tree.message = model.message;

        const selection = model.navigation?.nearest(input.location.uri, input.location.range.start);
        if (selection !== undefined && this.tree.visible) {
            await this.tree.reveal(selection, { select: true, focus: true, expand: true });
        }
    }

    private clearInput(): void {
        this.input = undefined;
        setContext("reference-list.hasResult", false);
        setContext("reference-list.source", undefined);
        this.tree.message = "No results.";
        this.provider.update(Promise.resolve(NO_CHILDREN));
    }
}

export function activate(): {
    setInput(input: ISymbolTreeInput): void;
    getInput(): ISymbolTreeInput | undefined;
} {
    const tree = new SymbolsTree();
    return {
        setInput: (input) => {
            void tree.setInput(input);
        },
        getInput: () => tree.getInput(),
    };
}
