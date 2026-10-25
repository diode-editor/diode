import type { Uri } from "../../../../base/common/uri.ts";
import type { IEnvironmentService } from "../../../../platform/environment/common/environment.ts";
import { IEnvironmentServiceDIToken } from "../../../../platform/environment/common/environment.ts";
import { type IFileService, IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type IProductIconService,
    NERD_FONT_ICONS,
    ProductIconServiceDIToken,
} from "../../../../platform/theme/common/productIconService.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { IWorkspaceContextServiceDIToken } from "../../../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import type { QuickInputService } from "../../../browser/parts/quickinput/quickInputService.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";

import { type IOpenDialogOptions, type ISaveDialogOptions, SimpleFileDialog } from "./simpleFileDialog.ts";

/**
 * Upstream `IFileDialogService`. A terminal has no native dialog, so it is always {@link SimpleFileDialog}
 * (upstream `files.simpleDialog.enable`). Without `defaultUri` starts in the workspace folder, without one in home.
 */
export interface IFileDialogService {
    showOpenDialog(options?: IOpenDialogOptions): Promise<Uri[] | undefined>;
    showSaveDialog(options?: ISaveDialogOptions): Promise<Uri | undefined>;
}

export const FileDialogServiceDIToken = token<IFileDialogService>("FileDialogService");

export class FileDialogService implements IFileDialogService {
    public static dependencies = [
        QuickInputServiceDIToken,
        IFileServiceDIToken,
        IEnvironmentServiceDIToken,
        IWorkspaceContextServiceDIToken,
        ProductIconServiceDIToken,
    ] as const;

    public constructor(
        private readonly quickInput: QuickInputService,
        private readonly files: IFileService,
        private readonly environment: IEnvironmentService,
        private readonly workspace: IWorkspaceContextService,
        private readonly icons: IProductIconService = NERD_FONT_ICONS,
    ) {}

    public showOpenDialog(options?: IOpenDialogOptions): Promise<Uri[] | undefined> {
        return this.createDialog().showOpenDialog(options);
    }

    public showSaveDialog(options?: ISaveDialogOptions): Promise<Uri | undefined> {
        return this.createDialog().showSaveDialog(options);
    }

    /** The dialog is single-use: each show has its own typing and loading state. */
    private createDialog(): SimpleFileDialog {
        const userHome = this.environment.userHome;
        return new SimpleFileDialog(
            this.quickInput,
            this.files,
            {
                userHome,
                defaultFolder: () => this.workspace.getWorkspace().folders.at(0)?.uri.fsPath ?? userHome,
            },
            this.icons,
        );
    }
}
