import * as path from "node:path";

import { Emitter } from "../../../base/common/event.ts";
import { Uri } from "../../../base/common/uri.ts";
import { token } from "../../instantiation/common/diContainer.ts";

import type {
    IWorkspace,
    IWorkspaceContextService,
    IWorkspaceFolder,
    WorkbenchState,
    WorkspaceId,
} from "./iWorkspaceContextService.ts";
import type { IWorkspaceFileContents } from "./workspaceFile.ts";
import { computeWorkspaceId } from "./workspaceId.ts";

/** Токен владельца набора папок; читатели берут `IWorkspaceContextServiceDIToken` — интерфейс без писателя. */
export const WorkspaceContextServiceDIToken = token<WorkspaceContextService>("WorkspaceContextServiceOwner");

const EMPTY_WORKSPACE: IWorkspace = { id: null, folders: [] };

/** «Закрыть папку» нет, поэтому обратного перехода в `empty` тоже нет. Мульти-рут расширит {@link setWorkspaceFolder}: читатели уже смотрят на массив. */
export class WorkspaceContextService implements IWorkspaceContextService {
    private workspace: IWorkspace = EMPTY_WORKSPACE;
    private readonly onDidChangeWorkspaceFoldersEmitter = new Emitter<void>();
    public readonly onDidChangeWorkspaceFolders = this.onDidChangeWorkspaceFoldersEmitter.event;

    public getWorkspace(): IWorkspace {
        return this.workspace;
    }

    public getWorkbenchState(): WorkbenchState {
        if (this.workspace.configuration !== undefined) return "workspace";
        return this.workspace.folders.length === 0 ? "empty" : "folder";
    }

    public getWorkspaceFolder(resource: Uri): IWorkspaceFolder | null {
        for (const folder of this.workspace.folders) {
            if (resource.scheme !== folder.uri.scheme) continue;
            const base = folder.uri.path;
            const prefix = base.endsWith("/") ? base : `${base}/`;
            if (resource.path === base || resource.path.startsWith(prefix)) return folder;
        }
        return null;
    }

    /**
     * Открывает папку как воркспейс и оповещает подписчиков. Зовёт единственный
     * владелец — `WorkbenchComponent.setWorkspaceFolder`: из бутстрапа `main.ts`
     * и из команды Open Folder.
     *
     * Возвращает {@link WorkspaceId} открытого воркспейса — тот же, что лежит в
     * `getWorkspace().id`, но уже без `null`: владельцу он нужен сразу, чтобы
     * открыть per-workspace сторы, и проверять «а вдруг пусто» ему незачем.
     *
     * Путь поднимается в `Uri` здесь — это та самая «одна точка на слой» с
     * `path.resolve` вплотную перед `Uri.file` (docs/ARCHITECTURE.md);
     * идентичность считается от того же абсолютного пути.
     */
    public setWorkspaceFolder(folderPath: string): WorkspaceId {
        const resolved = path.resolve(folderPath);
        const id = computeWorkspaceId(resolved);
        this.workspace = {
            id,
            folders: [{ uri: Uri.file(resolved), name: path.basename(resolved), index: 0 }],
        };
        this.onDidChangeWorkspaceFoldersEmitter.fire();
        return id;
    }

    /**
     * Открывает воркспейс из файла `.code-workspace` (уже разобранного —
     * `parseWorkspaceFile`) и оповещает подписчиков. Идентичность — от пути
     * ФАЙЛА, а не папки: два файла над одним каталогом — два проекта со своими
     * сторами, и оба отличны от той же папки, открытой напрямую.
     */
    public setWorkspaceFile(filePath: string, contents: IWorkspaceFileContents): WorkspaceId {
        const resolvedFile = path.resolve(filePath);
        const folder = path.resolve(contents.folder);
        const id = computeWorkspaceId(resolvedFile);
        this.workspace = {
            id,
            folders: [{ uri: Uri.file(folder), name: contents.folderName ?? path.basename(folder), index: 0 }],
            configuration: Uri.file(resolvedFile),
        };
        this.onDidChangeWorkspaceFoldersEmitter.fire();
        return id;
    }
}
