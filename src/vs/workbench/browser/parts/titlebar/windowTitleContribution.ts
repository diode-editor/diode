import { Disposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type ITerminalTitleSink,
    TerminalTitleSinkDIToken,
} from "../../../../platform/terminal/common/terminalTitleSink.ts";
import type { IUserDataProfile } from "../../../../platform/userDataProfile/common/userDataProfile.ts";
import type {
    IWorkspace,
    IWorkspaceContextService,
} from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { IWorkspaceContextServiceDIToken } from "../../../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import { workspaceFileLabel } from "../../../../platform/workspace/common/workspaceFile.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";
import {
    type IUserDataProfileService,
    IUserDataProfileServiceDIToken,
} from "../../../services/userDataProfile/common/userDataProfile.ts";

export const WindowTitleContributionDIToken = token<WindowTitleContribution>("WindowTitleContribution");

/** `${appName}` эталона. */
export const APP_NAME = "Diode";
/** Дефолт `window.titleSeparator` эталона. */
const TITLE_SEPARATOR = " - ";

/**
 * Подмножество дефолта `window.title` эталона (`windowTitle.ts`): без активного
 * файла и грязности, без самого ключа `window.title` (docs/TODO/Profiles.md).
 * Пустые части схлопываются вместе с разделителем.
 */
export function windowTitle(workspace: IWorkspace, profile: IUserDataProfile): string {
    const rootName =
        workspace.configuration !== undefined
            ? `${workspaceFileLabel(workspace.configuration.fsPath)} (Workspace)`
            : (workspace.folders.at(0)?.name ?? "");
    const profileName = profile.isDefault ? "" : profile.name;
    return [rootName, profileName, APP_NAME].filter((part) => part !== "").join(TITLE_SEPARATOR);
}

/** Профиль фиксирован на процесс: его смена — новое окно со своим заголовком. */
export class WindowTitleContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [
        IWorkspaceContextServiceDIToken,
        IUserDataProfileServiceDIToken,
        TerminalTitleSinkDIToken,
    ] as const;

    public constructor(
        private readonly workspaceContext: IWorkspaceContextService,
        private readonly profileService: IUserDataProfileService,
        private readonly setTitle: ITerminalTitleSink,
    ) {
        super();
        this.update();
        this.register(
            this.workspaceContext.onDidChangeWorkspaceFolders(() => {
                this.update();
            }),
        );
    }

    private update(): void {
        this.setTitle(windowTitle(this.workspaceContext.getWorkspace(), this.profileService.currentProfile));
    }
}
