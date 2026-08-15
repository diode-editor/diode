import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { DialogServiceDIToken } from "../../../services/dialogs/browser/dialogService.ts";
import type { GitOpResult } from "../common/gitProtocol.ts";

import { SCM_CHANGES_VIEW_ID } from "./changesComponent.ts";
import { GitPullPushMenu } from "./gitMenus.ts";
import { runGitOp, showGitNotice } from "./gitOpClient.ts";
import { ScmRepoStateServiceDIToken } from "./repoStateService.ts";

/** Read-only запрос данных пикеров у расширения (зеркалится по значению). */
export const QUERY_COMMAND = "diode.git.query";

const inChangesMenu = viewMenuVisible(SCM_CHANGES_VIEW_ID);

/** Данные запроса у расширения; расширение не активно/деградация — null. */
export async function runGitQuery(accessor: ServiceAccessor, kind: string): Promise<unknown> {
    const commands = accessor.get(CommandRegistryDIToken);
    if (!commands.has(QUERY_COMMAND)) return null;
    return Promise.resolve(commands.execute(QUERY_COMMAND, { kind })).catch(() => null);
}

/** Refs из query (для pull-from и branch-пикеров фазы 9). */
export async function queryRefs(
    accessor: ServiceAccessor,
): Promise<{ name: string; kind: "head" | "remote" | "tag"; sha: string; subject: string }[]> {
    const raw = (await runGitQuery(accessor, "refs")) as { refs?: unknown } | null;
    if (raw === null || !Array.isArray(raw.refs)) return [];
    return raw.refs.filter(
        (r): r is { name: string; kind: "head" | "remote" | "tag"; sha: string; subject: string } =>
            typeof r === "object" && r !== null && typeof (r as { name?: unknown }).name === "string",
    );
}

/**
 * Выбор remote: единственный — сразу, несколько — QuickPick, ноль — notice и
 * null (команды и так спрятаны за `gitHasRemotes`, но палитра не фильтрует).
 */
export async function pickRemote(accessor: ServiceAccessor, title: string): Promise<string | null> {
    const remotes = accessor.get(ScmRepoStateServiceDIToken).state.remotes;
    if (remotes.length === 0) {
        showGitNotice(accessor, "the repository has no remotes");
        return null;
    }
    if (remotes.length === 1) return remotes[0];
    const picked = await accessor.get(QuickInputServiceDIToken).quickPick({
        title,
        placeholder: "Pick a remote",
        items: remotes.map((name) => ({ label: name })),
    });
    return picked?.label ?? null;
}

/** Реакции на классифицированные ошибки сетевых операций (auth/conflict — общие). */
async function reactToFailure(accessor: ServiceAccessor, result: Extract<GitOpResult, { ok: false }>): Promise<void> {
    if (result.kind === "auth") {
        await accessor.get(DialogServiceDIToken).confirm({
            title: "Git: Authentication Failed",
            message: [
                "Git cannot prompt for credentials from inside the editor.",
                "Set up a credential helper or ssh-agent and retry.",
            ],
            confirmLabel: "OK",
            defaultButton: "confirm",
        });
        return;
    }
    if (result.kind === "conflict") {
        showGitNotice(accessor, "operation resulted in conflicts — resolve them in Merge Changes");
        return;
    }
    showGitNotice(accessor, result.message);
}

/** Pull/fetch/sync: одна операция + общие реакции. */
async function runNetworkOp(accessor: ServiceAccessor, op: string, params?: Record<string, unknown>): Promise<void> {
    const result = await runGitOp(accessor, op, params, { silent: true });
    if (result !== null && !result.ok) await reactToFailure(accessor, result);
}

/**
 * Push с VS Code-реакциями: `no-upstream` → предложение опубликовать ветку
 * (`push -u <remote> <branch>`), `push-rejected` → предложение сделать pull.
 */
async function push(accessor: ServiceAccessor, params: Record<string, unknown>): Promise<void> {
    const result = await runGitOp(accessor, "push", params, { silent: true });
    if (result === null || result.ok) return;

    if (result.kind === "no-upstream") {
        const confirmed = await accessor.get(DialogServiceDIToken).confirm({
            title: "Publish Branch",
            message: "The current branch has no upstream branch. Publish it?",
            confirmLabel: "Publish Branch",
            defaultButton: "confirm",
        });
        if (confirmed) await publishBranch(accessor);
        return;
    }
    if (result.kind === "push-rejected") {
        const confirmed = await accessor.get(DialogServiceDIToken).confirm({
            title: "Push Rejected",
            message: ["Push was rejected (non-fast-forward): the remote has new commits.", "Pull now?"],
            confirmLabel: "Pull",
        });
        if (confirmed) await runNetworkOp(accessor, "pull");
        return;
    }
    await reactToFailure(accessor, result);
}

/** `git push -u <remote> <branch>` текущей ветки (git.publish и no-upstream-поток). */
async function publishBranch(accessor: ServiceAccessor): Promise<void> {
    const branch = accessor.get(ScmRepoStateServiceDIToken).state.branch;
    if (branch === null) {
        showGitNotice(accessor, "cannot publish: not on a branch");
        return;
    }
    const remote = await pickRemote(accessor, "Publish Branch");
    if (remote === null) return;
    await runNetworkOp(accessor, "push", { remote, ref: branch, setUpstream: true });
}

/** Push в явно выбранный remote (`git.pushTo` / `git.pushToForce`). */
async function pushTo(accessor: ServiceAccessor, force: boolean): Promise<void> {
    const branch = accessor.get(ScmRepoStateServiceDIToken).state.branch;
    if (branch === null) {
        showGitNotice(accessor, "cannot push: not on a branch");
        return;
    }
    const remote = await pickRemote(accessor, force ? "Push to... (Force)" : "Push to...");
    if (remote === null) return;
    if (force && !(await confirmForcePush(accessor))) return;
    await push(accessor, { remote, ref: branch, forceWithLease: force });
}

function confirmForcePush(accessor: ServiceAccessor): Promise<boolean> {
    return accessor.get(DialogServiceDIToken).confirm({
        title: "Force Push",
        message: ["Force push rewrites history on the remote.", "Proceed with --force-with-lease?"],
        confirmLabel: "Force Push",
        warning: true,
    });
}

export const gitPullAction: CommandAction = {
    id: "git.pull",
    title: "Git: Pull",
    shortTitle: "Pull",
    when: "gitHasRemotes",
    menus: [
        { menuId: MenuId.ViewTitle, group: "2_git_top", order: 10, visible: inChangesMenu, when: "gitHasRemotes" },
        { menuId: GitPullPushMenu, group: "2_pull", order: 10, when: "gitHasRemotes" },
    ],
    run(accessor) {
        return runNetworkOp(accessor, "pull");
    },
};

export const gitPullRebaseAction: CommandAction = {
    id: "git.pullRebase",
    title: "Git: Pull (Rebase)",
    shortTitle: "Pull (Rebase)",
    when: "gitHasRemotes",
    menus: [{ menuId: GitPullPushMenu, group: "2_pull", order: 20, when: "gitHasRemotes" }],
    run(accessor) {
        return runNetworkOp(accessor, "pull", { rebase: true });
    },
};

export const gitPullFromAction: CommandAction = {
    id: "git.pullFrom",
    title: "Git: Pull from...",
    shortTitle: "Pull from...",
    when: "gitHasRemotes",
    menus: [{ menuId: GitPullPushMenu, group: "2_pull", order: 30, when: "gitHasRemotes" }],
    async run(accessor) {
        const remote = await pickRemote(accessor, "Pull from...");
        if (remote === null) return;
        const refs = await queryRefs(accessor);
        const remoteBranches = refs.filter((r) => r.kind === "remote" && r.name.startsWith(`${remote}/`));
        const picked = await accessor.get(QuickInputServiceDIToken).quickPick({
            title: "Pull from...",
            placeholder: "Pick a remote branch",
            items: remoteBranches.map((r) => ({ label: r.name, description: `${r.sha} ${r.subject}` })),
        });
        if (picked === undefined) return;
        const branch = picked.label.slice(remote.length + 1);
        await runNetworkOp(accessor, "pull", { remote, ref: branch });
    },
};

export const gitPushAction: CommandAction = {
    id: "git.push",
    title: "Git: Push",
    shortTitle: "Push",
    when: "gitHasRemotes",
    menus: [
        { menuId: MenuId.ViewTitle, group: "2_git_top", order: 20, visible: inChangesMenu, when: "gitHasRemotes" },
        { menuId: GitPullPushMenu, group: "3_push", order: 10, when: "gitHasRemotes" },
    ],
    run(accessor) {
        return push(accessor, {});
    },
};

export const gitPushForceAction: CommandAction = {
    id: "git.pushForce",
    title: "Git: Push (Force)",
    shortTitle: "Push (Force)",
    when: "gitHasRemotes",
    menus: [{ menuId: GitPullPushMenu, group: "3_push", order: 20, when: "gitHasRemotes" }],
    async run(accessor) {
        if (!(await confirmForcePush(accessor))) return;
        await push(accessor, { forceWithLease: true });
    },
};

export const gitPushToAction: CommandAction = {
    id: "git.pushTo",
    title: "Git: Push to...",
    shortTitle: "Push to...",
    when: "gitHasRemotes",
    menus: [{ menuId: GitPullPushMenu, group: "3_push", order: 30, when: "gitHasRemotes" }],
    run(accessor) {
        return pushTo(accessor, false);
    },
};

export const gitPushToForceAction: CommandAction = {
    id: "git.pushToForce",
    title: "Git: Push to... (Force)",
    shortTitle: "Push to... (Force)",
    when: "gitHasRemotes",
    run(accessor) {
        return pushTo(accessor, true);
    },
};

export const gitPushWithTagsAction: CommandAction = {
    id: "git.pushWithTags",
    title: "Git: Push (Follow Tags)",
    shortTitle: "Push (Follow Tags)",
    when: "gitHasRemotes",
    menus: [{ menuId: GitPullPushMenu, group: "3_push", order: 40, when: "gitHasRemotes" }],
    run(accessor) {
        return push(accessor, { followTags: true });
    },
};

export const gitPushWithTagsForceAction: CommandAction = {
    id: "git.pushWithTagsForce",
    title: "Git: Push (Follow Tags, Force)",
    shortTitle: "Push (Follow Tags, Force)",
    when: "gitHasRemotes",
    async run(accessor) {
        if (!(await confirmForcePush(accessor))) return;
        await push(accessor, { followTags: true, forceWithLease: true });
    },
};

export const gitSyncAction: CommandAction = {
    id: "git.sync",
    title: "Git: Sync",
    shortTitle: "Sync",
    when: "gitHasRemotes && gitHasUpstream",
    menus: [{ menuId: GitPullPushMenu, group: "1_sync", order: 10, when: "gitHasRemotes && gitHasUpstream" }],
    run(accessor) {
        return runNetworkOp(accessor, "sync");
    },
};

export const gitSyncRebaseAction: CommandAction = {
    id: "git.syncRebase",
    title: "Git: Sync (Rebase)",
    shortTitle: "Sync (Rebase)",
    when: "gitHasRemotes && gitHasUpstream",
    menus: [{ menuId: GitPullPushMenu, group: "1_sync", order: 20, when: "gitHasRemotes && gitHasUpstream" }],
    run(accessor) {
        return runNetworkOp(accessor, "sync", { rebase: true });
    },
};

export const gitFetchAction: CommandAction = {
    id: "git.fetch",
    title: "Git: Fetch",
    shortTitle: "Fetch",
    when: "gitHasRemotes",
    menus: [
        { menuId: MenuId.ViewTitle, group: "2_git_top", order: 40, visible: inChangesMenu, when: "gitHasRemotes" },
        { menuId: GitPullPushMenu, group: "4_fetch", order: 10, when: "gitHasRemotes" },
    ],
    run(accessor) {
        return runNetworkOp(accessor, "fetch");
    },
};

export const gitFetchPruneAction: CommandAction = {
    id: "git.fetchPrune",
    title: "Git: Fetch (Prune)",
    shortTitle: "Fetch (Prune)",
    when: "gitHasRemotes",
    menus: [{ menuId: GitPullPushMenu, group: "4_fetch", order: 20, when: "gitHasRemotes" }],
    run(accessor) {
        return runNetworkOp(accessor, "fetch", { prune: true });
    },
};

export const gitFetchAllAction: CommandAction = {
    id: "git.fetchAll",
    title: "Git: Fetch From All Remotes",
    shortTitle: "Fetch From All Remotes",
    when: "gitHasRemotes",
    menus: [{ menuId: GitPullPushMenu, group: "4_fetch", order: 30, when: "gitHasRemotes" }],
    run(accessor) {
        return runNetworkOp(accessor, "fetch", { all: true });
    },
};

export const gitPublishAction: CommandAction = {
    id: "git.publish",
    title: "Git: Publish Branch...",
    shortTitle: "Publish Branch...",
    when: "gitHasRemotes",
    run(accessor) {
        return publishBranch(accessor);
    },
};

export const SYNC_ACTIONS: readonly CommandAction[] = [
    gitPullAction,
    gitPullRebaseAction,
    gitPullFromAction,
    gitPushAction,
    gitPushForceAction,
    gitPushToAction,
    gitPushToForceAction,
    gitPushWithTagsAction,
    gitPushWithTagsForceAction,
    gitSyncAction,
    gitSyncRebaseAction,
    gitFetchAction,
    gitFetchPruneAction,
    gitFetchAllAction,
    gitPublishAction,
];
