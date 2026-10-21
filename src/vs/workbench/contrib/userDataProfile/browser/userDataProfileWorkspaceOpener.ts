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

/** Structurally the files feature's `IWorkspaceFolderOpener`; the type is repeated to avoid pulling in the sibling feature. */
export interface IWrappedWorkspaceOpener {
    setWorkspaceFolder(dirPath: string): void;
    openWorkspaceFile(filePath: string, contents: IWorkspaceFileContents): void;
}

/**
 * The profile is resolved BEFORE changing the folder: if it differs, the folder is untouched, the window reloads with the new
 * workspace in its arguments, and Cancel in "Save changes?" won't leave "a foreign folder in the old profile".
 * The bootstrap folder bypasses this — its profile is chosen in `main.ts` (`resolveActiveProfile`).
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
