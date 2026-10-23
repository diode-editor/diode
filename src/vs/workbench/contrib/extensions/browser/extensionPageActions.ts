import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ProgressService } from "../../../../platform/progress/common/progressService.ts";
import { ProgressServiceDIToken } from "../../../../platform/progress/common/progressService.ts";
import type { QuickInputService } from "../../../browser/parts/quickinput/quickInputService.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import type { NotificationService } from "../../../services/notification/browser/notificationService.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";
import type { StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { showTransientNotice } from "../../../services/statusbar/common/transientNotice.ts";
import type {
    IExtensionInstallOptions,
    IExtensionInstallResult,
    IExtensionOperationResult,
    IExtensionsWorkbenchService,
} from "../common/extensionsWorkbench.ts";
import { ExtensionsWorkbenchServiceDIToken } from "../common/extensionsWorkbench.ts";
import type { ExtensionUpdateScheduler } from "../common/extensionUpdateScheduler.ts";
import { ExtensionUpdateSchedulerDIToken } from "../common/extensionUpdateScheduler.ts";

import { describeVersionPicks } from "./extensionVersionPicks.ts";

// Separate from the service: the service lives in `node/` and knows nothing about the status bar or progress.

/** A single id: a new notice replaces the previous one. */
const NOTICE_ID = "extensions.operation.notice";

/** Upstream `InstallAnotherVersionAction` strings. */
export const SELECT_VERSION_PLACEHOLDER = "Select Version to Install";
export const NO_OTHER_VERSIONS_MESSAGE = "This extension has no other versions.";

/** The two methods this needs from quick input and notifications. */
export type IExtensionPageActionsHost = Pick<QuickInputService, "quickPick"> & Pick<NotificationService, "show">;

export interface IExtensionPageActions {
    install(id: string, options?: IExtensionInstallOptions): Promise<IExtensionInstallResult>;
    /**
     * The version picker of upstream `InstallAnotherVersionAction`. `undefined`: nothing to do (Escape, the
     * installed version, or no versions — then an info message says so). A registry failure is thrown.
     */
    pickVersion(id: string): Promise<string | undefined>;
    uninstall(id: string): Promise<IExtensionOperationResult>;
    reloadWindow(): void;
    /** The page's `Auto Update` toggle (decision J2): unchecked pins the entry; checked unpins it and auto-updates. */
    setAutoUpdate(id: string, enabled: boolean): Promise<IExtensionOperationResult>;
    /** `extensions.autoUpdate` is `on`: otherwise the toggle is disabled. */
    isAutoUpdateEnabled(): boolean;
    onDidChangeAutoUpdate(listener: () => void): IDisposable;
}

/** What the page needs from the scheduler. */
export type IExtensionAutoUpdateControl = Pick<
    ExtensionUpdateScheduler,
    "eventuallyAutoUpdate" | "isAutoUpdateEnabled" | "onDidChangeAutoUpdate"
>;

export class ExtensionPageActions implements IExtensionPageActions {
    public static dependencies = [
        ExtensionsWorkbenchServiceDIToken,
        ProgressServiceDIToken,
        StatusBarServiceDIToken,
        CommandRegistryDIToken,
        QuickInputServiceDIToken,
        NotificationServiceDIToken,
        ExtensionUpdateSchedulerDIToken,
    ] as const;

    /** The clock for the picker's "2 days ago": a field, not module state (the V8 snapshot has no clock). */
    public now: () => number = Date.now;

    public constructor(
        private readonly service: IExtensionsWorkbenchService,
        private readonly progress: ProgressService,
        private readonly statusBar: StatusBarService,
        private readonly commands: CommandRegistry,
        private readonly quickInput: Pick<IExtensionPageActionsHost, "quickPick">,
        private readonly notifications: Pick<IExtensionPageActionsHost, "show">,
        private readonly autoUpdate: IExtensionAutoUpdateControl,
    ) {}

    /** Indeterminate progress: artifact download has no percentage channel. */
    public async install(id: string, options?: IExtensionInstallOptions): Promise<IExtensionInstallResult> {
        // Stryker disable next-line StringLiteral: ProgressService only distinguishes "view"; any other location is the window, so replacing the string changes nothing
        const result = await this.progress.withProgress({ location: "window", title: `Installing ${id}` }, () =>
            this.service.install(id, options),
        );
        if (result.ok) {
            this.notice(`Installed ${id}@${result.version} — reload window to activate`);
        }
        return result;
    }

    public async pickVersion(id: string): Promise<string | undefined> {
        const versions = await this.service.getCompatibleVersions(id);
        if (versions.length === 0) {
            // Upstream `dialogService.info`: a modal with OK.
            this.notifications.show({ severity: "info", message: NO_OTHER_VERSIONS_MESSAGE, modal: true, items: [] });
            return undefined;
        }
        const installed = this.service.getEntries().find((e) => e.id === id)?.installedVersion ?? null;
        const pick = await this.quickInput.quickPick({
            placeholder: SELECT_VERSION_PLACEHOLDER,
            items: describeVersionPicks(versions, installed, this.now()),
        });
        // Upstream: `if (local.manifest.version === pick.id) return`.
        return pick === undefined || pick.label === installed ? undefined : pick.label;
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
     * Upstream `updateAutoUpdateEnablementFor` + `eventuallyAutoUpdateExtensions`: the pass goes through the same
     * rules as any other (the publish delay included), not a direct install.
     */
    public async setAutoUpdate(id: string, enabled: boolean): Promise<IExtensionOperationResult> {
        const result = await this.service.setPinned(id, !enabled);
        if (result.ok && enabled) this.autoUpdate.eventuallyAutoUpdate();
        return result;
    }

    public isAutoUpdateEnabled(): boolean {
        return this.autoUpdate.isAutoUpdateEnabled();
    }

    public onDidChangeAutoUpdate(listener: () => void): IDisposable {
        return this.autoUpdate.onDidChangeAutoUpdate(listener);
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
