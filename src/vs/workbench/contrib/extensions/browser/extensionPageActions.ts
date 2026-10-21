import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ProgressService } from "../../../../platform/progress/common/progressService.ts";
import { ProgressServiceDIToken } from "../../../../platform/progress/common/progressService.ts";
import type { StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { showTransientNotice } from "../../../services/statusbar/common/transientNotice.ts";
import type {
    IExtensionInstallResult,
    IExtensionOperationResult,
    IExtensionsWorkbenchService,
} from "../common/extensionsWorkbench.ts";
import { ExtensionsWorkbenchServiceDIToken } from "../common/extensionsWorkbench.ts";

// Separate from the service: the service lives in `node/` and knows nothing about the status bar or progress.

/** A single id: a new notice replaces the previous one. */
const NOTICE_ID = "extensions.operation.notice";

export interface IExtensionPageActions {
    install(id: string): Promise<IExtensionInstallResult>;
    uninstall(id: string): Promise<IExtensionOperationResult>;
    reloadWindow(): void;
}

export class ExtensionPageActions implements IExtensionPageActions {
    public static dependencies = [
        ExtensionsWorkbenchServiceDIToken,
        ProgressServiceDIToken,
        StatusBarServiceDIToken,
        CommandRegistryDIToken,
    ] as const;

    public constructor(
        private readonly service: IExtensionsWorkbenchService,
        private readonly progress: ProgressService,
        private readonly statusBar: StatusBarService,
        private readonly commands: CommandRegistry,
    ) {}

    /** Indeterminate progress: artifact download has no percentage channel. */
    public async install(id: string): Promise<IExtensionInstallResult> {
        // Stryker disable next-line StringLiteral: ProgressService only distinguishes "view"; any other location is the window, so replacing the string changes nothing
        const result = await this.progress.withProgress({ location: "window", title: `Installing ${id}` }, () =>
            this.service.install(id),
        );
        if (result.ok) {
            this.notice(`Installed ${id}@${result.version} — reload window to activate`);
        }
        return result;
    }

    public async uninstall(id: string): Promise<IExtensionOperationResult> {
        // Stryker disable next-line StringLiteral: same "window" location, see install above
        const result = await this.progress.withProgress({ location: "window", title: `Uninstalling ${id}` }, () =>
            this.service.uninstall(id),
        );
        if (result.ok) {
            this.notice(`Uninstalled ${id} — reload window to apply`);
        }
        return result;
    }

    /**
     * Via the command, not a seam: the button and the command palette take one path, including the
     * unsaved-tabs prompt.
     */
    public reloadWindow(): void {
        this.commands.execute("workbench.action.reloadWindow");
    }

    private notice(text: string): void {
        showTransientNotice(this.statusBar, NOTICE_ID, text);
    }
}

export const ExtensionPageActionsDIToken = token<IExtensionPageActions>("ExtensionPageActions");
