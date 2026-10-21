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

/** Структурно `IWorkspaceFolderOpener` фичи files; тип повторён, чтобы не тянуть соседнюю фичу. */
export interface IWrappedWorkspaceOpener {
    setWorkspaceFolder(dirPath: string): void;
    openWorkspaceFile(filePath: string, contents: IWorkspaceFileContents): void;
}

/**
 * Профиль решается ДО смены папки: другой — папка не трогается, окно перезагружается с новым
 * воркспейсом в аргументах, и Cancel в «Save changes?» не оставит «чужую папку в старом профиле».
 * Бутстрапная папка идёт мимо — её профиль выбран в `main.ts` (`resolveActiveProfile`).
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
