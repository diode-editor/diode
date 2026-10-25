import type { IProductIcon } from "../../../../base/common/codicons.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type IProductIconService,
    NERD_FONT_ICONS,
    ProductIconServiceDIToken,
} from "../../../../platform/theme/common/productIconService.ts";
import type { IStatusBarEntryHandle, StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";

import type { ScmRepoStateService } from "./repoStateService.ts";
import { ScmRepoStateServiceDIToken } from "./repoStateService.ts";

/** nf-dev-git_branch, as before the Unicode fallback (not the codicon). */
export const BRANCH_ICON: IProductIcon = { nerdFont: "\ue725", unicode: "\u2387" }; // ⎇

export const ScmStatusBarContributionDIToken = token<ScmStatusBarContribution>("ScmStatusBarContribution");

/** Appears with the first repo-state publish — only in a git repository. */
export class ScmStatusBarContribution extends Disposable {
    public static dependencies = [
        StatusBarServiceDIToken,
        ScmRepoStateServiceDIToken,
        CommandRegistryDIToken,
        ProductIconServiceDIToken,
    ] as const;

    private branchHandle: IStatusBarEntryHandle | null = null;
    private syncHandle: IStatusBarEntryHandle | null = null;

    public constructor(
        private readonly statusBar: StatusBarService,
        private readonly repoState: ScmRepoStateService,
        private readonly commands: CommandRegistry,
        private readonly icons: IProductIconService = NERD_FONT_ICONS,
    ) {
        super();
        this.register(
            icons.onDidChange(() => {
                this.update();
            }),
        );
        this.register(
            repoState.onDidChangeState(() => {
                this.update();
            }),
        );
        this.register({
            dispose: () => {
                this.branchHandle?.dispose();
                this.syncHandle?.dispose();
            },
        });
        this.update();
    }

    private update(): void {
        if (!this.repoState.hasRepository) return;
        const state = this.repoState.state;

        const branchLabel = state.detached ? "detached" : (state.branch ?? "unborn");
        const opSuffix = state.state === "idle" ? "" : ` (${state.state})`;
        const branchText = `${this.icons.glyph(BRANCH_ICON)} ${branchLabel}${opSuffix}`;
        if (this.branchHandle === null) {
            this.branchHandle = this.statusBar.addEntry({
                id: "status.scm.branch",
                name: "Source Control",
                text: branchText,
                alignment: "left",
                priority: 1000,
                onClick: () => {
                    this.commands.execute("git.checkout");
                },
            });
        } else {
            this.branchHandle.update({ text: branchText });
        }

        if (state.remotes.length === 0) {
            this.syncHandle?.dispose();
            this.syncHandle = null;
            return;
        }
        const syncText = state.upstream === null ? "☁ publish" : `↓${state.behind} ↑${state.ahead}`;
        const syncCommand = state.upstream === null ? "git.publish" : "git.sync";
        if (this.syncHandle === null) {
            this.syncHandle = this.statusBar.addEntry({
                id: "status.scm.sync",
                name: "Source Control Sync",
                text: syncText,
                alignment: "left",
                priority: 999,
                onClick: () => {
                    this.commands.execute(syncCommand);
                },
            });
        } else {
            this.syncHandle.update({
                text: syncText,
                onClick: () => {
                    this.commands.execute(syncCommand);
                },
            });
        }
    }
}
