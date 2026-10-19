import type * as vscode from "vscode";

/** Папка, которую расширение просит добавить (`workspace.updateWorkspaceFolders`). */
export interface IWorkspaceFolderToAdd {
    readonly uri: vscode.Uri;
    readonly name?: string;
}

/**
 * Симуляция `workspace.updateWorkspaceFolders` над текущим набором папок —
 * проверки `ExtHostWorkspace.updateWorkspaceFolders` эталона дословно по смыслу:
 * чужие `uri` и повторы среди добавляемых отбрасываются; отрицательные или не
 * числа, «нечего удалять и добавлять», удаление сверх имеющегося, папка дважды
 * в итоге и итог без изменений — отказ (`null`). Иначе — новый набор папок
 * (только `uri`: имя папки у нас — её basename, как у открытой напрямую).
 *
 * Папки сравниваются по `fsPath` (в эталоне — с учётом регистра ФС; у нас ФС
 * одна — локальная).
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
    if (deleteCount === 0 && added.length === 0) return null;
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
