import type * as vscode from "vscode";

export interface IWorkspaceFolderToAdd {
    readonly uri: vscode.Uri;
    readonly name?: string;
}

/**
 * Upstream `ExtHostWorkspace.updateWorkspaceFolders` checks; `null` means refusal, including
 * "no-op result". Compares by `fsPath`: we have a single, local file system.
 */
export function simulateWorkspaceFoldersUpdate(
    current: readonly { readonly uri: vscode.Uri }[],
    index: number,
    deleteCount: number,
    toAdd: readonly IWorkspaceFolderToAdd[],
): vscode.Uri[] | null {
    const added: vscode.Uri[] = [];
    for (const folder of toAdd) {
        const uri = (folder as Partial<IWorkspaceFolderToAdd> | undefined)?.uri;
        if (typeof uri?.fsPath !== "string") continue;
        if (!added.some((other) => other.fsPath === uri.fsPath)) added.push(uri);
    }
    if (!isCount(index) || !isCount(deleteCount)) return null;
    if (index + deleteCount > current.length) return null;

    const next = current.map((folder) => folder.uri);
    next.splice(index, deleteCount, ...added);
    const paths = next.map((uri) => uri.fsPath);
    if (new Set(paths).size !== paths.length) return null;
    const unchanged = paths.length === current.length && paths.every((p, i) => p === current[i].uri.fsPath);
    return unchanged ? null : next;
}

function isCount(value: unknown): value is number {
    return typeof value === "number" && value >= 0;
}
