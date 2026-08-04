import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { DialogServiceDIToken } from "../../../services/dialogs/browser/dialogService.ts";

import { SCM_CHANGES_VIEW_ID } from "./changesComponent.ts";
import { GitBranchMenu } from "./gitMenus.ts";
import { runGitOp, showGitNotice } from "./gitOpClient.ts";
import { ScmRepoStateServiceDIToken } from "./repoStateService.ts";
import { queryRefs } from "./syncActions.ts";

const inChangesMenu = viewMenuVisible(SCM_CHANGES_VIEW_ID);

/** Спец-пункты ref-пикера checkout (как в VS Code). */
export const CREATE_BRANCH_LABEL = "＋ Create new branch...";
export const CREATE_BRANCH_FROM_LABEL = "＋ Create new branch from...";
export const CHECKOUT_DETACHED_LABEL = "⇢ Checkout detached...";

type RefKind = "head" | "remote" | "tag";

/** Пикер ref'ов (ветки/remote-ветки/теги — сорт по свежести делает расширение). */
async function pickRef(
    accessor: ServiceAccessor,
    title: string,
    kinds: readonly RefKind[],
): Promise<{ name: string; kind: RefKind } | null> {
    const refs = (await queryRefs(accessor)).filter((r) => kinds.includes(r.kind));
    if (refs.length === 0) {
        showGitNotice(accessor, "no refs to pick from");
        return null;
    }
    const picked = await accessor.get(QuickInputServiceDIToken).quickPick({
        title,
        placeholder: "Pick a ref",
        items: refs.map((r) => ({ label: r.name, description: `${r.sha} ${r.subject}` })),
    });
    if (picked === undefined) return null;
    const ref = refs.find((r) => r.name === picked.label);
    return ref === undefined ? null : { name: ref.name, kind: ref.kind };
}

/** Ввод имени новой ветки (валидацию имени делает git — ошибка придёт notice-ом). */
function inputBranchName(accessor: ServiceAccessor, title: string, value?: string): Promise<string | undefined> {
    return accessor.get(QuickInputServiceDIToken).input({
        title,
        placeholder: "Branch name",
        value,
        validateInput: (v) => (v.trim() === "" ? "Branch name is empty" : null),
    });
}

/** Создание ветки: ввод имени → `checkout -b <name> [<base>]`. */
async function createBranch(accessor: ServiceAccessor, base?: string): Promise<void> {
    const name = await inputBranchName(accessor, base === undefined ? "Create Branch" : `Create Branch From ${base}`);
    if (name === undefined || name.trim() === "") return;
    await runGitOp(accessor, "branchCreate", base === undefined ? { name: name.trim() } : { name: name.trim(), base });
}

/**
 * Checkout to... — пикер VS Code: спец-пункты create/create-from/detached +
 * локальные ветки, remote-ветки (DWIM создаст трекающую локальную) и теги.
 */
export const gitCheckoutAction: CommandAction = {
    id: "git.checkout",
    title: "Git: Checkout to...",
    shortTitle: "Checkout to...",
    when: "gitHasRepo",
    menus: [
        { menuId: MenuId.ViewMoreActions, group: "2_git_top", order: 30, visible: inChangesMenu, when: "gitHasRepo" },
    ],
    async run(accessor) {
        const refs = await queryRefs(accessor);
        const picked = await accessor.get(QuickInputServiceDIToken).quickPick({
            title: "Checkout to...",
            placeholder: "Pick a branch or tag to checkout",
            items: [
                { label: CREATE_BRANCH_LABEL },
                { label: CREATE_BRANCH_FROM_LABEL },
                { label: CHECKOUT_DETACHED_LABEL },
                ...refs.map((r) => ({
                    label: r.name,
                    description: `${r.kind === "tag" ? "tag · " : r.kind === "remote" ? "remote · " : ""}${r.sha} ${r.subject}`,
                })),
            ],
        });
        if (picked === undefined) return;

        if (picked.label === CREATE_BRANCH_LABEL) {
            await createBranch(accessor);
            return;
        }
        if (picked.label === CREATE_BRANCH_FROM_LABEL) {
            const base = await pickRef(accessor, "Create Branch From...", ["head", "remote", "tag"]);
            if (base !== null) await createBranch(accessor, base.name);
            return;
        }
        if (picked.label === CHECKOUT_DETACHED_LABEL) {
            const ref = await pickRef(accessor, "Checkout to (Detached)...", ["head", "remote", "tag"]);
            if (ref !== null) await runGitOp(accessor, "checkout", { ref: ref.name, detach: true });
            return;
        }

        const ref = refs.find((r) => r.name === picked.label);
        if (ref === undefined) return;
        // Remote-ветка чекаутится коротким именем: git DWIM создаст локальную
        // трекающую; тег — как есть (HEAD станет detached сам).
        const target = ref.kind === "remote" ? ref.name.slice(ref.name.indexOf("/") + 1) : ref.name;
        await runGitOp(accessor, "checkout", { ref: target });
    },
};

export const gitCheckoutDetachedAction: CommandAction = {
    id: "git.checkoutDetached",
    title: "Git: Checkout to (Detached)...",
    shortTitle: "Checkout to (Detached)...",
    when: "gitHasRepo",
    async run(accessor) {
        const ref = await pickRef(accessor, "Checkout to (Detached)...", ["head", "remote", "tag"]);
        if (ref !== null) await runGitOp(accessor, "checkout", { ref: ref.name, detach: true });
    },
};

export const gitBranchAction: CommandAction = {
    id: "git.branch",
    title: "Git: Create Branch...",
    shortTitle: "Create Branch...",
    when: "gitHasRepo",
    menus: [{ menuId: GitBranchMenu, group: "2_branch", order: 10, when: "gitHasRepo" }],
    run(accessor) {
        return createBranch(accessor);
    },
};

export const gitBranchFromAction: CommandAction = {
    id: "git.branchFrom",
    title: "Git: Create Branch From...",
    shortTitle: "Create Branch From...",
    when: "gitHasRepo",
    menus: [{ menuId: GitBranchMenu, group: "2_branch", order: 20, when: "gitHasRepo" }],
    async run(accessor) {
        const base = await pickRef(accessor, "Create Branch From...", ["head", "remote", "tag"]);
        if (base !== null) await createBranch(accessor, base.name);
    },
};

export const gitRenameBranchAction: CommandAction = {
    id: "git.renameBranch",
    title: "Git: Rename Branch...",
    shortTitle: "Rename Branch...",
    when: "gitHasRepo && !gitDetached",
    menus: [{ menuId: GitBranchMenu, group: "2_branch", order: 30, when: "gitHasRepo && !gitDetached" }],
    async run(accessor) {
        const current = accessor.get(ScmRepoStateServiceDIToken).state.branch;
        const name = await inputBranchName(accessor, "Rename Branch", current ?? undefined);
        if (name === undefined || name.trim() === "" || name.trim() === current) return;
        await runGitOp(accessor, "branchRename", { name: name.trim() });
    },
};

export const gitDeleteBranchAction: CommandAction = {
    id: "git.deleteBranch",
    title: "Git: Delete Branch...",
    shortTitle: "Delete Branch...",
    when: "gitHasRepo",
    menus: [{ menuId: GitBranchMenu, group: "2_branch", order: 40, when: "gitHasRepo" }],
    async run(accessor) {
        const current = accessor.get(ScmRepoStateServiceDIToken).state.branch;
        const heads = (await queryRefs(accessor)).filter((r) => r.kind === "head" && r.name !== current);
        if (heads.length === 0) {
            showGitNotice(accessor, "no other local branches to delete");
            return;
        }
        const picked = await accessor.get(QuickInputServiceDIToken).quickPick({
            title: "Delete Branch...",
            placeholder: "Pick a branch to delete",
            items: heads.map((r) => ({ label: r.name, description: `${r.sha} ${r.subject}` })),
        });
        if (picked === undefined) return;

        const result = await runGitOp(accessor, "branchDelete", { name: picked.label }, { silent: true });
        if (result === null || result.ok) return;
        if (result.kind === "not-merged") {
            const confirmed = await accessor.get(DialogServiceDIToken).confirm({
                title: "Delete Branch",
                message: [`Branch "${picked.label}" is not fully merged.`, "Delete anyway?"],
                confirmLabel: "Delete Branch",
                warning: true,
            });
            if (confirmed) await runGitOp(accessor, "branchDelete", { name: picked.label, force: true });
            return;
        }
        showGitNotice(accessor, result.message);
    },
};

export const gitDeleteRemoteBranchAction: CommandAction = {
    id: "git.deleteRemoteBranch",
    title: "Git: Delete Remote Branch...",
    shortTitle: "Delete Remote Branch...",
    when: "gitHasRemotes",
    menus: [{ menuId: GitBranchMenu, group: "2_branch", order: 50, when: "gitHasRemotes" }],
    async run(accessor) {
        const ref = await pickRef(accessor, "Delete Remote Branch...", ["remote"]);
        if (ref === null) return;
        const slash = ref.name.indexOf("/");
        await runGitOp(accessor, "pushDelete", {
            remote: ref.name.slice(0, slash),
            ref: ref.name.slice(slash + 1),
        });
    },
};

export const gitMergeAction: CommandAction = {
    id: "git.merge",
    title: "Git: Merge...",
    shortTitle: "Merge...",
    when: "gitHasRepo && !gitMerging",
    menus: [{ menuId: GitBranchMenu, group: "1_integrate", order: 10, when: "gitHasRepo && !gitMerging" }],
    async run(accessor) {
        const ref = await pickRef(accessor, "Merge...", ["head", "remote", "tag"]);
        if (ref === null) return;
        const result = await runGitOp(accessor, "merge", { ref: ref.name }, { silent: true });
        if (result !== null && !result.ok) {
            showGitNotice(
                accessor,
                result.kind === "conflict"
                    ? "merge resulted in conflicts — resolve them in Merge Changes"
                    : result.message,
            );
        }
    },
};

export const gitMergeAbortAction: CommandAction = {
    id: "git.mergeAbort",
    title: "Git: Abort Merge",
    shortTitle: "Abort Merge",
    when: "gitMerging",
    menus: [{ menuId: GitBranchMenu, group: "1_integrate", order: 15, when: "gitMerging" }],
    run(accessor) {
        return runGitOp(accessor, "mergeAbort");
    },
};

export const gitRebaseAction: CommandAction = {
    id: "git.rebase",
    title: "Git: Rebase Branch...",
    shortTitle: "Rebase Branch...",
    when: "gitHasRepo && !gitRebasing",
    menus: [{ menuId: GitBranchMenu, group: "1_integrate", order: 20, when: "gitHasRepo && !gitRebasing" }],
    async run(accessor) {
        const ref = await pickRef(accessor, "Rebase Branch...", ["head", "remote"]);
        if (ref === null) return;
        const result = await runGitOp(accessor, "rebase", { ref: ref.name }, { silent: true });
        if (result !== null && !result.ok) {
            showGitNotice(
                accessor,
                result.kind === "conflict"
                    ? "rebase resulted in conflicts — resolve them in Merge Changes"
                    : result.message,
            );
        }
    },
};

export const gitRebaseAbortAction: CommandAction = {
    id: "git.rebaseAbort",
    title: "Git: Abort Rebase",
    shortTitle: "Abort Rebase",
    when: "gitRebasing",
    menus: [{ menuId: GitBranchMenu, group: "1_integrate", order: 25, when: "gitRebasing" }],
    run(accessor) {
        return runGitOp(accessor, "rebaseAbort");
    },
};

export const gitCherryPickAction: CommandAction = {
    id: "git.cherryPick",
    title: "Git: Cherry Pick...",
    shortTitle: "Cherry Pick...",
    when: "gitHasRepo",
    async run(accessor) {
        const sha = await accessor.get(QuickInputServiceDIToken).input({
            title: "Cherry Pick",
            placeholder: "Commit hash to cherry pick",
            validateInput: (v) => (v.trim() === "" ? "Commit hash is empty" : null),
        });
        if (sha === undefined || sha.trim() === "") return;
        await runGitOp(accessor, "cherryPick", { sha: sha.trim() });
    },
};

export const BRANCH_ACTIONS: readonly CommandAction[] = [
    gitCheckoutAction,
    gitCheckoutDetachedAction,
    gitBranchAction,
    gitBranchFromAction,
    gitRenameBranchAction,
    gitDeleteBranchAction,
    gitDeleteRemoteBranchAction,
    gitMergeAction,
    gitMergeAbortAction,
    gitRebaseAction,
    gitRebaseAbortAction,
    gitCherryPickAction,
];
