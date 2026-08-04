import { SCM_GROUP_IDS, type IScmChange, type ScmGroupId } from "./changesService.ts";

/** Заголовки групп — как resource groups в VS Code. */
export const SCM_GROUP_LABELS: Readonly<Record<ScmGroupId, string>> = {
    merge: "Merge Changes",
    index: "Staged Changes",
    worktree: "Changes",
    untracked: "Untracked Changes",
};

/** Непустая группа изменений в порядке показа. */
export interface IScmChangeGroup {
    readonly id: ScmGroupId;
    readonly label: string;
    readonly changes: readonly IScmChange[];
}

/**
 * Раскладывает плоский снимок сервиса по группам в порядке VS Code:
 * Merge → Staged → Changes → Untracked; пустые группы опущены. Порядок записей
 * внутри группы — порядок прихода от расширения (сортирует потребитель).
 */
export function groupChanges(changes: readonly IScmChange[]): readonly IScmChangeGroup[] {
    const byGroup = new Map<ScmGroupId, IScmChange[]>();
    for (const change of changes) {
        let bucket = byGroup.get(change.group);
        if (bucket === undefined) {
            bucket = [];
            byGroup.set(change.group, bucket);
        }
        bucket.push(change);
    }
    return SCM_GROUP_IDS.filter((id) => byGroup.has(id)).map((id) => ({
        id,
        label: SCM_GROUP_LABELS[id],
        changes: byGroup.get(id)!,
    }));
}
