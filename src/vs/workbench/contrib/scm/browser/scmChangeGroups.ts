import { type IScmChange, type ScmGroupId } from "./changesService.ts";

/**
 * Untracked своего заголовка не получает — как VS Code `git.untrackedChanges: mixed`.
 * Id `untracked` в протоколе остаётся: по нему discard выбирает `git clean` вместо
 * `git checkout`, а строка красится своим цветом.
 */
function displayGroupOf(group: ScmGroupId): ScmGroupId {
    return group === "untracked" ? "worktree" : group;
}

export type ScmDisplayGroupId = Exclude<ScmGroupId, "untracked">;

export const SCM_GROUP_LABELS: Readonly<Record<ScmDisplayGroupId, string>> = {
    merge: "Merge Changes",
    index: "Staged Changes",
    worktree: "Changes",
};

const DISPLAY_ORDER: readonly ScmDisplayGroupId[] = ["merge", "index", "worktree"];

export interface IScmChangeGroup {
    readonly id: ScmGroupId;
    readonly label: string;
    readonly changes: readonly IScmChange[];
}

/** Порядок внутри группы — порядок прихода от расширения (сортирует потребитель). */
export function groupChanges(changes: readonly IScmChange[]): readonly IScmChangeGroup[] {
    const byGroup = new Map<ScmGroupId, IScmChange[]>();
    for (const change of changes) {
        const id = displayGroupOf(change.group);
        let bucket = byGroup.get(id);
        if (bucket === undefined) {
            bucket = [];
            byGroup.set(id, bucket);
        }
        bucket.push(change);
    }
    return DISPLAY_ORDER.flatMap((id) => {
        const changes = byGroup.get(id);
        if (changes === undefined) return [];
        return [{ id, label: SCM_GROUP_LABELS[id], changes }];
    });
}
