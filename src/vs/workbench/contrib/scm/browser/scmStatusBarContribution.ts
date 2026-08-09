import { Disposable } from "../../../../../../tuidom/common/disposable.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStatusBarEntryHandle, StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";

import type { ScmRepoStateService } from "./repoStateService.ts";
import { ScmRepoStateServiceDIToken } from "./repoStateService.ts";

/** nf-dev-git_branch. */
export const BRANCH_GLYPH = "";

export const ScmStatusBarContributionDIToken = token<ScmStatusBarContribution>("ScmStatusBarContribution");

/**
 * Левый сегмент статус-бара с состоянием репозитория — как в VS Code:
 * ` main` (+ `*` при merge/rebase) и счётчики `↓N ↑M` при расхождении с
 * upstream. Клик по ветке — `git.checkout`, по счётчикам — `git.sync` (или
 * Publish-поток `git.publish`, когда upstream ещё нет). Появляется с первой
 * публикацией repo-state (то есть только в git-репозитории).
 */
export class ScmStatusBarContribution extends Disposable {
    public static dependencies = [StatusBarServiceDIToken, ScmRepoStateServiceDIToken, CommandRegistryDIToken] as const;

    private branchHandle: IStatusBarEntryHandle | null = null;
    private syncHandle: IStatusBarEntryHandle | null = null;

    public constructor(
        private readonly statusBar: StatusBarService,
        private readonly repoState: ScmRepoStateService,
        private readonly commands: CommandRegistry,
    ) {
        super();
        this.register(repoState.onDidChangeState(() => this.update()));
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
        const branchText = `${BRANCH_GLYPH} ${branchLabel}${opSuffix}`;
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

        // Sync-сегмент: расхождение с upstream (или publish-подсказка без него).
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
