import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { DialogServiceDIToken } from "../../../services/dialogs/browser/dialogService.ts";

import { GitStashMenu } from "./gitMenus.ts";
import { runGitOp, showGitNotice } from "./gitOpClient.ts";
import { runGitQuery } from "./syncActions.ts";

/** Стэши из query для пикеров; расширение не активно/деградация — пусто. */
export async function queryStashes(
    accessor: ServiceAccessor,
): Promise<{ index: string; description: string }[]> {
    const raw = (await runGitQuery(accessor, "stashes")) as { stashes?: unknown } | null;
    if (raw === null || !Array.isArray(raw.stashes)) return [];
    return raw.stashes.filter(
        (s): s is { index: string; description: string } =>
            typeof s === "object" && s !== null && typeof (s as { index?: unknown }).index === "string",
    );
}

/** Пикер стэша; пустой список — notice. */
async function pickStash(accessor: ServiceAccessor, title: string): Promise<string | null> {
    const stashes = await queryStashes(accessor);
    if (stashes.length === 0) {
        showGitNotice(accessor, "there are no stashes");
        return null;
    }
    const picked = await accessor.get(QuickInputServiceDIToken).quickPick({
        title,
        placeholder: "Pick a stash",
        items: stashes.map((s) => ({ label: s.index, description: s.description })),
    });
    return picked?.label ?? null;
}

/** Общий поток `git stash push`: опциональное сообщение → op. */
async function stashPush(accessor: ServiceAccessor, flags: { includeUntracked?: boolean; staged?: boolean }): Promise<void> {
    const message = await accessor.get(QuickInputServiceDIToken).input({
        title: "Stash",
        placeholder: "Stash message (optional)",
    });
    if (message === undefined) return; // Escape — отмена
    await runGitOp(accessor, "stashPush", {
        message,
        includeUntracked: flags.includeUntracked === true,
        staged: flags.staged === true,
    });
}

/** Pop/apply с общим уведомлением о конфликте (git при конфликте pop стэш не удаляет). */
async function stashRestore(accessor: ServiceAccessor, op: "stashPop" | "stashApply", index?: string): Promise<void> {
    const result = await runGitOp(accessor, op, index === undefined ? undefined : { index }, { silent: true });
    if (result === null || result.ok) return;
    showGitNotice(
        accessor,
        result.kind === "conflict"
            ? "stash restore resulted in conflicts (the stash entry is kept) — resolve them in Merge Changes"
            : result.message,
    );
}

export const gitStashAction: CommandAction = {
    id: "git.stash",
    title: "Git: Stash",
    shortTitle: "Stash",
    when: "gitHasRepo",
    menus: [{ menuId: GitStashMenu, group: "1_push", order: 10, when: "gitHasRepo" }],
    run(accessor) {
        return stashPush(accessor, {});
    },
};

export const gitStashIncludeUntrackedAction: CommandAction = {
    id: "git.stashIncludeUntracked",
    title: "Git: Stash (Include Untracked)",
    shortTitle: "Stash (Include Untracked)",
    when: "gitHasRepo",
    menus: [{ menuId: GitStashMenu, group: "1_push", order: 20, when: "gitHasRepo" }],
    run(accessor) {
        return stashPush(accessor, { includeUntracked: true });
    },
};

export const gitStashStagedAction: CommandAction = {
    id: "git.stashStaged",
    title: "Git: Stash Staged",
    shortTitle: "Stash Staged",
    when: "gitHasRepo",
    menus: [{ menuId: GitStashMenu, group: "1_push", order: 30, when: "gitHasRepo" }],
    run(accessor) {
        // git < 2.35 не знает --staged — ошибка придёт понятным notice-ом.
        return stashPush(accessor, { staged: true });
    },
};

export const gitStashApplyLatestAction: CommandAction = {
    id: "git.stashApplyLatest",
    title: "Git: Apply Latest Stash",
    shortTitle: "Apply Latest Stash",
    when: "gitHasRepo",
    menus: [{ menuId: GitStashMenu, group: "2_apply", order: 10, when: "gitHasRepo" }],
    run(accessor) {
        return stashRestore(accessor, "stashApply");
    },
};

export const gitStashApplyAction: CommandAction = {
    id: "git.stashApply",
    title: "Git: Apply Stash...",
    shortTitle: "Apply Stash...",
    when: "gitHasRepo",
    menus: [{ menuId: GitStashMenu, group: "2_apply", order: 20, when: "gitHasRepo" }],
    async run(accessor) {
        const index = await pickStash(accessor, "Apply Stash...");
        if (index !== null) await stashRestore(accessor, "stashApply", index);
    },
};

export const gitStashPopLatestAction: CommandAction = {
    id: "git.stashPopLatest",
    title: "Git: Pop Latest Stash",
    shortTitle: "Pop Latest Stash",
    when: "gitHasRepo",
    menus: [{ menuId: GitStashMenu, group: "2_apply", order: 30, when: "gitHasRepo" }],
    run(accessor) {
        return stashRestore(accessor, "stashPop");
    },
};

export const gitStashPopAction: CommandAction = {
    id: "git.stashPop",
    title: "Git: Pop Stash...",
    shortTitle: "Pop Stash...",
    when: "gitHasRepo",
    menus: [{ menuId: GitStashMenu, group: "2_apply", order: 40, when: "gitHasRepo" }],
    async run(accessor) {
        const index = await pickStash(accessor, "Pop Stash...");
        if (index !== null) await stashRestore(accessor, "stashPop", index);
    },
};

export const gitStashDropAction: CommandAction = {
    id: "git.stashDrop",
    title: "Git: Drop Stash...",
    shortTitle: "Drop Stash...",
    when: "gitHasRepo",
    menus: [{ menuId: GitStashMenu, group: "3_drop", order: 10, when: "gitHasRepo" }],
    async run(accessor) {
        const index = await pickStash(accessor, "Drop Stash...");
        if (index === null) return;
        const confirmed = await accessor.get(DialogServiceDIToken).confirm({
            title: "Drop Stash",
            message: [`Are you sure you want to drop ${index}?`, "This is IRREVERSIBLE!"],
            confirmLabel: "Drop Stash",
            warning: true,
        });
        if (confirmed) await runGitOp(accessor, "stashDrop", { index });
    },
};

export const gitStashDropAllAction: CommandAction = {
    id: "git.stashDropAll",
    title: "Git: Drop All Stashes...",
    shortTitle: "Drop All Stashes...",
    when: "gitHasRepo",
    menus: [{ menuId: GitStashMenu, group: "3_drop", order: 20, when: "gitHasRepo" }],
    async run(accessor) {
        const stashes = await queryStashes(accessor);
        if (stashes.length === 0) {
            showGitNotice(accessor, "there are no stashes");
            return;
        }
        const confirmed = await accessor.get(DialogServiceDIToken).confirm({
            title: "Drop All Stashes",
            message: [
                `Are you sure you want to drop ${stashes.length} ${stashes.length === 1 ? "stash" : "stashes"}?`,
                "This is IRREVERSIBLE!",
            ],
            confirmLabel: "Drop All Stashes",
            warning: true,
        });
        if (confirmed) await runGitOp(accessor, "stashClear");
    },
};

export const STASH_ACTIONS: readonly CommandAction[] = [
    gitStashAction,
    gitStashIncludeUntrackedAction,
    gitStashStagedAction,
    gitStashApplyLatestAction,
    gitStashApplyAction,
    gitStashPopLatestAction,
    gitStashPopAction,
    gitStashDropAction,
    gitStashDropAllAction,
];
