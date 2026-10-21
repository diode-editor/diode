import { Uri } from "../../../../base/common/uri.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { scmHasAnyGroup, scmUrisArg } from "../../../browser/actions/menuContexts.ts";
import type { ConfirmDialogOptions } from "../../../browser/parts/dialogs/confirmDialog.ts";
import { DialogServiceDIToken } from "../../../services/dialogs/browser/dialogService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";

import { ChangesComponentDIToken } from "./changesComponent.ts";
import { ScmChangesServiceDIToken, type ScmGroupId } from "./changesService.ts";
import { GitChangesMenu } from "./gitMenus.ts";
import { withGitProgress } from "./gitOpClient.ts";

/**
 * `git.*` commands live in the core (menus, selection, pickers); the extension runs git via
 * `diode.git.*` transports; strings are duplicated by value — there are no shared imports.
 */
export const STAGE_TRANSPORT_COMMAND = "diode.git.stage";
export const UNSTAGE_TRANSPORT_COMMAND = "diode.git.unstage";
export const CLEAN_TRANSPORT_COMMAND = "diode.git.clean";

/** Applicability by group: stage takes everything unstaged, unstage takes the index. */
const STAGEABLE_GROUPS: readonly ScmGroupId[] = ["worktree", "untracked", "merge"];
const UNSTAGEABLE_GROUPS: readonly ScmGroupId[] = ["index"];

const FAILURE_NOTICE_MS = 5000;

/** Staging has its own transport, not `diode.git.op`: the operation name comes from the command id. */
function transportOp(commandId: string): string {
    return commandId.slice(commandId.lastIndexOf(".") + 1);
}

/**
 * Explicit uris from the menu or the Changes selection; targets are filtered by group applicability
 * (mixed selection as in VS Code) and deduplicated (an MM file is two entries, one uri).
 */
export function resolveScmTargets(accessor: ServiceAccessor, raw: unknown, applicable: readonly ScmGroupId[]): Uri[] {
    const changes = accessor.get(ScmChangesServiceDIToken).changes;
    const applicableUris = new Set(changes.filter((c) => applicable.includes(c.group)).map((c) => c.uri.toString()));

    const candidates: string[] =
        Array.isArray(raw) && raw.every((item): item is string => typeof item === "string")
            ? raw
            : accessor
                  .get(ChangesComponentDIToken)
                  .getSelectedChanges()
                  .map((c) => c.uri.toString());

    const seen = new Set<string>();
    const targets: Uri[] = [];
    for (const uri of candidates) {
        if (!applicableUris.has(uri) || seen.has(uri)) continue;
        seen.add(uri);
        targets.push(Uri.parse(uri));
    }
    return targets;
}

function allTargets(accessor: ServiceAccessor, applicable: readonly ScmGroupId[]): Uri[] {
    return resolveScmTargets(
        accessor,
        accessor.get(ScmChangesServiceDIToken).changes.map((c) => c.uri.toString()),
        applicable,
    );
}

/**
 * Inactive extension or empty targets is a silent no-op; a git error is a transient notice
 * in the status bar (no toasts), the list converges on refresh.
 */
export async function runGitTransport(accessor: ServiceAccessor, commandId: string, uris: Uri[]): Promise<void> {
    if (uris.length === 0) return;
    const commands = accessor.get(CommandRegistryDIToken);
    if (!commands.has(commandId)) return;
    const result = (await withGitProgress(accessor, transportOp(commandId), () =>
        Promise.resolve(
            commands.execute(
                commandId,
                uris.map((u) => u.toString()),
            ),
        ).catch(() => null),
    )) as { ok?: boolean; message?: string } | null;
    if (result?.ok === true) return;

    const message = typeof result?.message === "string" && result.message !== "" ? result.message : "git failed";
    const handle = accessor.get(StatusBarServiceDIToken).addEntry({
        id: "scm.staging.notice",
        text: `Git: ${message}`,
        alignment: "left",
        priority: 100,
    });
    setTimeout(() => {
        handle.dispose();
    }, FAILURE_NOTICE_MS);
}

export const gitStageAction: CommandAction = {
    id: "git.stage",
    title: "Git: Stage Changes",
    shortTitle: "Stage Changes",
    menus: [
        {
            menuId: MenuId.ScmContext,
            group: "2_stage",
            order: 10,
            args: scmUrisArg,
            visible: scmHasAnyGroup(...STAGEABLE_GROUPS),
        },
        {
            menuId: MenuId.ScmResourceGroupContext,
            title: "Stage All Changes",
            group: "1_actions",
            order: 10,
            args: scmUrisArg,
            visible: scmHasAnyGroup(...STAGEABLE_GROUPS),
        },
    ],
    run(accessor, rawUris) {
        return runGitTransport(
            accessor,
            STAGE_TRANSPORT_COMMAND,
            resolveScmTargets(accessor, rawUris, STAGEABLE_GROUPS),
        );
    },
};

export const gitUnstageAction: CommandAction = {
    id: "git.unstage",
    title: "Git: Unstage Changes",
    shortTitle: "Unstage Changes",
    menus: [
        {
            menuId: MenuId.ScmContext,
            group: "2_stage",
            order: 20,
            args: scmUrisArg,
            visible: scmHasAnyGroup(...UNSTAGEABLE_GROUPS),
        },
        {
            menuId: MenuId.ScmResourceGroupContext,
            title: "Unstage All Changes",
            group: "1_actions",
            order: 10,
            args: scmUrisArg,
            visible: scmHasAnyGroup(...UNSTAGEABLE_GROUPS),
        },
    ],
    run(accessor, rawUris) {
        return runGitTransport(
            accessor,
            UNSTAGE_TRANSPORT_COMMAND,
            resolveScmTargets(accessor, rawUris, UNSTAGEABLE_GROUPS),
        );
    },
};

export const gitStageAllAction: CommandAction = {
    id: "git.stageAll",
    title: "Git: Stage All Changes",
    shortTitle: "Stage All Changes",
    menus: [{ menuId: GitChangesMenu, group: "1_changes", order: 10 }],
    run(accessor) {
        return runGitTransport(accessor, STAGE_TRANSPORT_COMMAND, allTargets(accessor, STAGEABLE_GROUPS));
    },
};

export const gitUnstageAllAction: CommandAction = {
    id: "git.unstageAll",
    title: "Git: Unstage All Changes",
    shortTitle: "Unstage All Changes",
    menus: [{ menuId: GitChangesMenu, group: "1_changes", order: 20 }],
    run(accessor) {
        return runGitTransport(accessor, UNSTAGE_TRANSPORT_COMMAND, allTargets(accessor, UNSTAGEABLE_GROUPS));
    },
};

function basenameOf(uri: Uri): string {
    return uri.path.slice(uri.path.lastIndexOf("/") + 1);
}

/**
 * VS Code semantics: reverting tracked files is reversible, deleting untracked ones is not, hence
 * the warning and caps. ConfirmDialog sets Cancel as the default button.
 */
export function buildDiscardConfirm(tracked: readonly Uri[], untracked: readonly Uri[]): ConfirmDialogOptions {
    if (untracked.length === 0) {
        return {
            title: "Discard Changes",
            message:
                tracked.length === 1
                    ? `Are you sure you want to discard changes in ${basenameOf(tracked[0])}?`
                    : `Are you sure you want to discard changes in ${tracked.length} files?`,
            confirmLabel: "Discard Changes",
        };
    }
    if (tracked.length === 0) {
        return {
            title: untracked.length === 1 ? "Delete File" : "Delete Files",
            message: [
                untracked.length === 1
                    ? `Are you sure you want to DELETE ${basenameOf(untracked[0])}?`
                    : `Are you sure you want to DELETE ${untracked.length} files?`,
                "This is IRREVERSIBLE! The files will be FOREVER LOST if you proceed.",
            ],
            confirmLabel: untracked.length === 1 ? "Delete File" : "Delete Files",
            warning: true,
        };
    }
    return {
        title: "Discard All Changes",
        message: [
            `Are you sure you want to discard changes in ${tracked.length} tracked ` +
                `${tracked.length === 1 ? "file" : "files"} and DELETE ${untracked.length} untracked ` +
                `${untracked.length === 1 ? "file" : "files"}?`,
            "Deleting untracked files is IRREVERSIBLE!",
        ],
        confirmLabel: "Discard All Changes",
        warning: true,
    };
}

async function discard(accessor: ServiceAccessor, rawUris: unknown): Promise<void> {
    const tracked = resolveScmTargets(accessor, rawUris, ["worktree"]);
    const untracked = resolveScmTargets(accessor, rawUris, ["untracked"]);
    if (tracked.length === 0 && untracked.length === 0) return;

    const confirmed = await accessor.get(DialogServiceDIToken).confirm(buildDiscardConfirm(tracked, untracked));
    if (!confirmed) return;
    await runGitTransport(accessor, CLEAN_TRANSPORT_COMMAND, [...tracked, ...untracked]);
}

/** Destructive, so always confirmed; untracked files are deleted from disk. */
export const gitCleanAction: CommandAction = {
    id: "git.clean",
    title: "Git: Discard Changes",
    shortTitle: "Discard Changes",
    menus: [
        {
            menuId: MenuId.ScmContext,
            group: "3_discard",
            order: 10,
            args: scmUrisArg,
            visible: scmHasAnyGroup("worktree", "untracked"),
        },
        {
            menuId: MenuId.ScmResourceGroupContext,
            title: "Discard All Changes",
            group: "1_actions",
            order: 20,
            args: scmUrisArg,
            visible: scmHasAnyGroup("worktree", "untracked"),
        },
    ],
    run(accessor, rawUris) {
        return discard(accessor, rawUris);
    },
};

export const gitCleanAllAction: CommandAction = {
    id: "git.cleanAll",
    title: "Git: Discard All Changes",
    shortTitle: "Discard All Changes",
    menus: [{ menuId: GitChangesMenu, group: "1_changes", order: 30 }],
    run(accessor) {
        return discard(
            accessor,
            accessor.get(ScmChangesServiceDIToken).changes.map((c) => c.uri.toString()),
        );
    },
};
