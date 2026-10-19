import type { Uri } from "../../../../base/common/uri.ts";
import type { IEnvironmentService } from "../../../../platform/environment/common/environment.ts";
import { IEnvironmentServiceDIToken } from "../../../../platform/environment/common/environment.ts";
import { type IFileService, IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { IWorkspaceContextServiceDIToken } from "../../../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import type { QuickInputService } from "../../../browser/parts/quickinput/quickInputService.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";

import { type IOpenDialogOptions, type ISaveDialogOptions, SimpleFileDialog } from "./simpleFileDialog.ts";

/**
 * Диалоги выбора файлов — `IFileDialogService` эталона (его `showOpenDialog` /
 * `showSaveDialog`). Нативного диалога в терминале нет, поэтому оба всегда
 * идут через {@link SimpleFileDialog} — у эталона это тот же диалог при
 * `files.simpleDialog.enable`. Без `defaultUri` диалог открывается в папке
 * воркспейса, а без неё — в домашнем каталоге (`defaultFilePath` эталона).
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
    ] as const;

    public constructor(
        private readonly quickInput: QuickInputService,
        private readonly files: IFileService,
        private readonly environment: IEnvironmentService,
        private readonly workspace: IWorkspaceContextService,
    ) {}

    public showOpenDialog(options?: IOpenDialogOptions): Promise<Uri[] | undefined> {
        return this.createDialog().showOpenDialog(options);
    }

    public showSaveDialog(options?: ISaveDialogOptions): Promise<Uri | undefined> {
        return this.createDialog().showSaveDialog(options);
    }

    /** Диалог одноразовый: у каждого показа своё состояние набора и подгрузки. */
    private createDialog(): SimpleFileDialog {
        const userHome = this.environment.userHome;
        return new SimpleFileDialog(this.quickInput, this.files, {
            userHome,
            defaultFolder: () => this.workspace.getWorkspace().folders.at(0)?.uri.fsPath ?? userHome,
        });
    }
}
