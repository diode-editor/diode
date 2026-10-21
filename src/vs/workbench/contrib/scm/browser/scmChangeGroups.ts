import { type IScmChange, type ScmGroupId } from "./changesService.ts";

/**
 * Untracked gets no header of its own — like VS Code `git.untrackedChanges: mixed`.
 * The `untracked` id stays in the protocol: discard uses it to pick `git clean` over
 * `git checkout`, and the row gets its own color.
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

/** Order within a group is arrival order from the extension (the consumer sorts). */
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
