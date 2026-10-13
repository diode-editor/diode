import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import {
    type IUserDataProfilesService,
    profileForWorkspace,
    type ProfileWorkspaceKey,
    profileWorkspaceKeyOf,
} from "../../../../platform/userDataProfile/common/userDataProfile.ts";
import type { IWorkspaceFileContents } from "../../../../platform/workspace/common/workspaceFile.ts";
import { reloadWindow } from "../../../browser/actions/appActions.ts";
import type { IUserDataProfileService } from "../../../services/userDataProfile/common/userDataProfile.ts";

/**
 * Опенер воркспейса под обёрткой — структурно `IWorkspaceFolderOpener` фичи
 * files (`contrib/files/browser/fileActions.ts`); тип повторён, чтобы фича
 * профилей не тянула соседнюю фичу.
 */
export interface IWrappedWorkspaceOpener {
    setWorkspaceFolder(dirPath: string): void;
    openWorkspaceFile(filePath: string, contents: IWorkspaceFileContents): void;
}

/**
 * Смена воркспейса на живом окне (Open Folder, Open Workspace from File) с
 * оглядкой на профиль: у нового воркспейса своя привязка (или её нет —
 * Default), а профиль окна фиксирован на процесс. Профиль решается ДО смены
 * папки: он другой — папка не трогается, окно перезагружается уже с новым
 * воркспейсом в аргументах; Cancel в «Save changes?» оставляет окно в прежней
 * папке и прежнем профиле, и состояния «чужая папка в старом профиле» не
 * бывает. Профиль тот же — смена папки идёт как есть. У эталона смена
 * воркспейса и есть перезагрузка окна, профиль резолвится заново в
 * `windowsMainService`.
 *
 * Обёртка над опенером `WorkbenchComponent` (биндинг `WorkspaceFolderOpenerDIToken`
 * в `workbenchModule`); бутстрапная папка идёт мимо неё — её профиль уже
 * выбран в `main.ts` (`resolveActiveProfile`).
 */
export class UserDataProfileWorkspaceOpener implements IWrappedWorkspaceOpener {
    public constructor(
        private readonly inner: IWrappedWorkspaceOpener,
        private readonly profiles: IUserDataProfilesService,
        private readonly profileService: IUserDataProfileService,
        private readonly accessor: ServiceAccessor,
        private readonly logger: ILogger,
    ) {}

    public setWorkspaceFolder(dirPath: string): void {
        if (this.reloadsInto(profileWorkspaceKeyOf(dirPath))) return;
        this.inner.setWorkspaceFolder(dirPath);
    }

    public openWorkspaceFile(filePath: string, contents: IWorkspaceFileContents): void {
        if (this.reloadsInto(profileWorkspaceKeyOf(filePath))) return;
        this.inner.openWorkspaceFile(filePath, contents);
    }

    /**
     * Профиль воркспейса другой — перезагрузка в него запущена (с воркспейсом
     * в аргументах следующего окна), и папку этого окна менять нельзя.
     */
    private reloadsInto(workspace: ProfileWorkspaceKey): boolean {
        const target = profileForWorkspace(this.profiles, workspace);
        if (target.id === this.profileService.currentProfile.id) return false;
        this.logger.info(`workspace is associated with profile "${target.name}" — reloading window`);
        reloadWindow(this.accessor, { profile: target.name, workspace }).catch((err: unknown) => {
            this.logger.error("profile switch on workspace change failed", err);
        });
        return true;
    }
}
