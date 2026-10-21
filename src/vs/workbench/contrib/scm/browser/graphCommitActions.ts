import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { ClipboardDIToken } from "../../../../platform/clipboard/common/iClipboard.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { scmGraphShaArg, scmGraphSubjectArg } from "../../../browser/actions/menuContexts.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { DialogServiceDIToken } from "../../../services/dialogs/browser/dialogService.ts";

import { createBranch, inputRefName } from "./branchActions.ts";
import { runGitOp, showGitNotice } from "./gitOpClient.ts";

/**
 * Группы — как VS Code `scm/historyItem/context`; сверх него Reset и Revert: без них
 * история в TUI — смотровая площадка. Из палитры sha не подставится — без аргумента
 * команды выходят тихо, как прочие resource-команды SCM.
 */

const WHEN_IDLE_REPO = "gitHasRepo && !gitMerging && !gitRebasing";

/** Описания — по `git reset --help`. */
const RESET_MODES = [
    { label: "Mixed", mode: "mixed", description: "Keep working tree, reset index (default)" },
    { label: "Soft", mode: "soft", description: "Keep working tree and index" },
    { label: "Hard", mode: "hard", description: "Discard all changes in the working tree" },
] as const;

function shaArg(arg: unknown): string | null {
    return typeof arg === "string" && arg !== "" ? arg : null;
}

export const graphCheckoutDetachedAction: CommandAction = {
    id: "git.graph.checkoutDetached",
    title: "Git: Checkout Commit (Detached)",
    shortTitle: "Checkout (Detached)",
    when: "gitHasRepo",
    menus: [
        { menuId: MenuId.ScmGraphContext, group: "1_checkout", order: 10, args: scmGraphShaArg, when: "gitHasRepo" },
    ],
    async run(accessor, sha) {
        const ref = shaArg(sha);
        if (ref === null) return;
        await runGitOp(accessor, "checkout", { ref, detach: true });
    },
};

export const graphBranchAction: CommandAction = {
    id: "git.graph.branch",
    title: "Git: Create Branch from Commit...",
    shortTitle: "Create Branch...",
    when: "gitHasRepo",
    menus: [{ menuId: MenuId.ScmGraphContext, group: "2_branch", order: 10, args: scmGraphShaArg, when: "gitHasRepo" }],
    async run(accessor, sha) {
        const ref = shaArg(sha);
        if (ref === null) return;
        await createBranch(accessor, ref, ref.slice(0, 8));
    },
};

export const graphCreateTagAction: CommandAction = {
    id: "git.graph.createTag",
    title: "Git: Create Tag at Commit...",
    shortTitle: "Create Tag...",
    when: "gitHasRepo",
    menus: [{ menuId: MenuId.ScmGraphContext, group: "3_tag", order: 10, args: scmGraphShaArg, when: "gitHasRepo" }],
    async run(accessor, sha) {
        const ref = shaArg(sha);
        if (ref === null) return;
        const name = await inputRefName(accessor, "Create Tag", "Tag name");
        if (name === undefined || name.trim() === "") return;
        await runGitOp(accessor, "tagCreate", { name: name.trim(), ref });
    },
};

export const graphCherryPickAction: CommandAction = {
    id: "git.graph.cherryPick",
    title: "Git: Cherry Pick Commit",
    shortTitle: "Cherry Pick",
    when: WHEN_IDLE_REPO,
    menus: [
        { menuId: MenuId.ScmGraphContext, group: "4_modify", order: 10, args: scmGraphShaArg, when: WHEN_IDLE_REPO },
    ],
    async run(accessor, sha) {
        const ref = shaArg(sha);
        if (ref === null) return;
        const result = await runGitOp(accessor, "cherryPick", { sha: ref }, { silent: true });
        if (result !== null && !result.ok) {
            showGitNotice(
                accessor,
                result.kind === "conflict"
                    ? "cherry pick resulted in conflicts — resolve them in Merge Changes"
                    : result.message,
            );
        }
    },
};

export const graphRevertAction: CommandAction = {
    id: "git.graph.revert",
    title: "Git: Revert Commit",
    shortTitle: "Revert Commit",
    when: WHEN_IDLE_REPO,
    menus: [
        { menuId: MenuId.ScmGraphContext, group: "4_modify", order: 20, args: scmGraphShaArg, when: WHEN_IDLE_REPO },
    ],
    async run(accessor, sha) {
        const ref = shaArg(sha);
        if (ref === null) return;
        const result = await runGitOp(accessor, "revert", { ref }, { silent: true });
        if (result !== null && !result.ok) {
            showGitNotice(
                accessor,
                result.kind === "conflict"
                    ? "revert resulted in conflicts — resolve them in Merge Changes"
                    : result.message,
            );
        }
    },
};

/** `--hard` теряет правки рабочего дерева — с подтверждением, как Delete Branch и Discard. */
export const graphResetAction: CommandAction = {
    id: "git.graph.reset",
    title: "Git: Reset to Commit...",
    shortTitle: "Reset to Commit...",
    when: WHEN_IDLE_REPO,
    menus: [
        { menuId: MenuId.ScmGraphContext, group: "5_reset", order: 10, args: scmGraphShaArg, when: WHEN_IDLE_REPO },
    ],
    async run(accessor, sha) {
        const ref = shaArg(sha);
        if (ref === null) return;

        const picked = await accessor.get(QuickInputServiceDIToken).quickPick({
            title: "Reset to Commit",
            placeholder: "Pick a reset mode",
            items: RESET_MODES.map((m) => ({ label: m.label, description: m.description })),
        });
        if (picked === undefined) return;
        const mode = RESET_MODES.find((m) => m.label === picked.label);
        if (mode === undefined) return;

        if (mode.mode === "hard" && !(await confirmHardReset(accessor, ref))) return;
        await runGitOp(accessor, "reset", { ref, mode: mode.mode });
    },
};

function confirmHardReset(accessor: ServiceAccessor, ref: string): Promise<boolean> {
    return accessor.get(DialogServiceDIToken).confirm({
        title: "Reset to Commit",
        message: [
            `Hard reset to ${ref.slice(0, 8)} will discard all changes in the working tree.`,
            "This is irreversible.",
        ],
        confirmLabel: "Discard Changes and Reset",
        warning: true,
    });
}

export const graphCopyCommitIdAction: CommandAction = {
    id: "git.graph.copyCommitId",
    title: "Git: Copy Commit ID",
    shortTitle: "Copy Commit ID",
    when: "gitHasRepo",
    menus: [{ menuId: MenuId.ScmGraphContext, group: "9_copy", order: 10, args: scmGraphShaArg, when: "gitHasRepo" }],
    async run(accessor, sha) {
        const ref = shaArg(sha);
        if (ref === null) return;
        await accessor.get(ClipboardDIToken).writeText(ref);
    },
};

export const graphCopyCommitMessageAction: CommandAction = {
    id: "git.graph.copyCommitMessage",
    title: "Git: Copy Commit Message",
    shortTitle: "Copy Commit Message",
    when: "gitHasRepo",
    menus: [
        { menuId: MenuId.ScmGraphContext, group: "9_copy", order: 20, args: scmGraphSubjectArg, when: "gitHasRepo" },
    ],
    async run(accessor, subject) {
        if (typeof subject !== "string" || subject === "") return;
        await accessor.get(ClipboardDIToken).writeText(subject);
    },
};

export const GRAPH_COMMIT_ACTIONS: readonly CommandAction[] = [
    graphCheckoutDetachedAction,
    graphBranchAction,
    graphCreateTagAction,
    graphCherryPickAction,
    graphRevertAction,
    graphResetAction,
    graphCopyCommitIdAction,
    graphCopyCommitMessageAction,
];
