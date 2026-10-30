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
import { workspaceLabel } from "../../../../platform/workspace/common/workspaceLabel.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";
import {
    type IUserDataProfileService,
    IUserDataProfileServiceDIToken,
} from "../../../services/userDataProfile/common/userDataProfile.ts";

export const WindowTitleContributionDIToken = token<WindowTitleContribution>("WindowTitleContribution");

/** Upstream `${appName}`. */
export const APP_NAME = "Diode";
/** Upstream default of `window.titleSeparator`. */
const TITLE_SEPARATOR = " - ";

/**
 * Subset of the upstream default `window.title` (`windowTitle.ts`): no active file or dirty
 * state, and no `window.title` setting itself (docs/TODO/Profiles.md).
 * Empty parts collapse together with their separator.
 */
export function windowTitle(workspace: IWorkspace, profile: IUserDataProfile): string {
    const rootName = workspaceLabel(workspace);
    const profileName = profile.isDefault ? "" : profile.name;
    return [rootName, profileName, APP_NAME].filter((part) => part !== "").join(TITLE_SEPARATOR);
}

/** The profile is fixed per process: switching it opens a new window with its own title. */
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
