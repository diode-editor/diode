import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { Uri } from "../../../base/common/uri.ts";

/**
 * Адресует `workspaceStorage/<id>/`. У воркспейса из `.code-workspace` id — от пути ФАЙЛА, так
 * что два файла над одной папкой — два проекта. Вызывающие передают id, а не путь: мульти-рут
 * поменяет одну функцию, а не раскладку на диске.
 */
export type WorkspaceId = string;

export interface IWorkspaceFolder {
    readonly uri: Uri;
    readonly name: string;
    /** Стабилен до смены набора папок. */
    readonly index: number;
}

export interface IWorkspace {
    /** `null` у пустого окна. Эталон даёт id и ему, мы — нет: без папки per-workspace стора нет (`docs/TODO/MultiRoot.md`). */
    readonly id: WorkspaceId | null;
    /** Пока 0 или 1 элемент — мульти-рута нет; «корень» читатели берут явным `folders.at(0)`. */
    readonly folders: readonly IWorkspaceFolder[];
    /** Есть только у окна, открытого через `*.code-workspace`; папка и у него ровно одна. */
    readonly configuration?: Uri;
}

export type WorkbenchState =
    | "empty"
    | "folder"
    /** Настройки воркспейса — блок `settings` файла, а `.diode/settings.json` папки — слой папки. */
    | "workspace";

/** Писателя здесь нет: набор папок ставит владелец через `WorkspaceContextServiceDIToken`, остальные только читают. */
export interface IWorkspaceContextService {
    getWorkspace(): IWorkspace;

    getWorkbenchState(): WorkbenchState;

    /** Совпадение по схеме и префиксу пути; сама папка — тоже «внутри себя», как в эталоне. */
    getWorkspaceFolder(resource: Uri): IWorkspaceFolder | null;

    /** Слушатель НЕ вызывается немедленно. */
    onDidChangeWorkspaceFolders(listener: () => void): IDisposable;
}
