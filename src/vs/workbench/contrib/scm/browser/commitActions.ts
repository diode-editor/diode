import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { DialogServiceDIToken } from "../../../services/dialogs/browser/dialogService.ts";

import { ScmChangesServiceDIToken } from "./changesService.ts";
import { GitCommitMenu } from "./gitMenus.ts";
import { runGitOp, showGitNotice } from "./gitOpClient.ts";
import { ScmInputComponentDIToken } from "./scmInputComponent.ts";

/** Флаги commit-семейства (номенклатура VS Code: git.commit / Staged / All × Amend × NoVerify). */
interface ICommitFlags {
    readonly amend?: boolean;
    readonly all?: boolean;
    readonly noVerify?: boolean;
    readonly allowEmpty?: boolean;
    /** Smart commit `git.commit`: пустой индекс → предложение закоммитить всё. */
    readonly smart?: boolean;
}

/**
 * Общий поток коммита: сообщение из commit input box (пустое допустимо только
 * с amend — `--no-edit`); smart-режим при пустом индексе спрашивает «Commit all
 * changes?» (упрощение VS Code `git.enableSmartCommit`, без Always/Never);
 * успех очищает input (refresh списка придёт от расширения сам).
 */
export async function commit(accessor: ServiceAccessor, flags: ICommitFlags): Promise<void> {
    const input = accessor.get(ScmInputComponentDIToken);
    const message = input.message.trim();
    if (message === "" && flags.amend !== true) {
        showGitNotice(accessor, "commit message is empty — type it in the Source Control input box");
        return;
    }

    let all = flags.all === true;
    if (flags.smart === true && !all) {
        const changes = accessor.get(ScmChangesServiceDIToken).changes;
        const hasStaged = changes.some((c) => c.group === "index");
        if (!hasStaged) {
            // `--all` берёт только tracked-правки — untracked не в счёт.
            const hasTracked = changes.some((c) => c.group === "worktree" || c.group === "merge");
            if (!hasTracked) {
                showGitNotice(accessor, "no changes to commit");
                return;
            }
            const confirmed = await accessor.get(DialogServiceDIToken).confirm({
                title: "Commit",
                message: ["There are no staged changes to commit.", "Commit all tracked changes instead?"],
                confirmLabel: "Commit All",
            });
            if (!confirmed) return;
            all = true;
        }
    }

    const result = await runGitOp(accessor, "commit", {
        message,
        amend: flags.amend === true,
        all,
        noVerify: flags.noVerify === true,
        allowEmpty: flags.allowEmpty === true,
    });
    if (result?.ok === true) input.setMessage("");
}

function commitAction(
    id: string,
    title: string,
    shortTitle: string,
    flags: ICommitFlags,
    menu?: { group: string; order: number },
): CommandAction {
    return {
        id,
        title,
        shortTitle,
        menus: menu === undefined ? undefined : [{ menuId: GitCommitMenu, group: menu.group, order: menu.order }],
        run(accessor) {
            return commit(accessor, flags);
        },
    };
}

/** Smart commit: индекс, а при пустом индексе — предложение закоммитить всё. Ctrl+Enter в input box. */
export const gitCommitAction: CommandAction = {
    ...commitAction("git.commit", "Git: Commit", "Commit", { smart: true }, { group: "1_commit", order: 10 }),
    keybinding: { keys: parseKeybinding("ctrl+enter"), when: "scmInputFocus" },
};

export const gitCommitStagedAction = commitAction("git.commitStaged", "Git: Commit Staged", "Commit Staged", {}, { group: "2_staged", order: 10 });
export const gitCommitAllAction = commitAction("git.commitAll", "Git: Commit All", "Commit All", { all: true }, { group: "3_all", order: 10 });
export const gitCommitAmendAction = commitAction(
    "git.commitAmend",
    "Git: Commit (Amend)",
    "Commit (Amend)",
    { smart: true, amend: true },
    { group: "1_commit", order: 20 },
);
export const gitCommitStagedAmendAction = commitAction(
    "git.commitStagedAmend",
    "Git: Commit Staged (Amend)",
    "Commit Staged (Amend)",
    { amend: true },
    { group: "2_staged", order: 20 },
);
export const gitCommitAllAmendAction = commitAction(
    "git.commitAllAmend",
    "Git: Commit All (Amend)",
    "Commit All (Amend)",
    { all: true, amend: true },
    { group: "3_all", order: 20 },
);
export const gitCommitNoVerifyAction = commitAction(
    "git.commitNoVerify",
    "Git: Commit (No Verify)",
    "Commit (No Verify)",
    { smart: true, noVerify: true },
);
export const gitCommitStagedNoVerifyAction = commitAction(
    "git.commitStagedNoVerify",
    "Git: Commit Staged (No Verify)",
    "Commit Staged (No Verify)",
    { noVerify: true },
);
export const gitCommitAllNoVerifyAction = commitAction(
    "git.commitAllNoVerify",
    "Git: Commit All (No Verify)",
    "Commit All (No Verify)",
    { all: true, noVerify: true },
);
export const gitCommitEmptyAction = commitAction("git.commitEmpty", "Git: Commit Empty", "Commit Empty", {
    allowEmpty: true,
});

/** Undo Last Commit: `reset --soft HEAD~`, сообщение возвращается в input box. */
export const gitUndoCommitAction: CommandAction = {
    id: "git.undoCommit",
    title: "Git: Undo Last Commit",
    shortTitle: "Undo Last Commit",
    menus: [{ menuId: GitCommitMenu, group: "5_undo", order: 10 }],
    async run(accessor) {
        const result = await runGitOp(accessor, "undoCommit");
        if (result?.ok !== true) return;
        const message = result.data?.message;
        if (typeof message === "string" && message !== "") {
            accessor.get(ScmInputComponentDIToken).setMessage(message);
        }
    },
};

export const COMMIT_ACTIONS: readonly CommandAction[] = [
    gitCommitAction,
    gitCommitStagedAction,
    gitCommitAllAction,
    gitCommitAmendAction,
    gitCommitStagedAmendAction,
    gitCommitAllAmendAction,
    gitCommitNoVerifyAction,
    gitCommitStagedNoVerifyAction,
    gitCommitAllNoVerifyAction,
    gitCommitEmptyAction,
    gitUndoCommitAction,
];
