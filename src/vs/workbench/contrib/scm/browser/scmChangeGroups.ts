import { type IScmChange, type ScmGroupId } from "./changesService.ts";

/**
 * Группа, под заголовком которой показывается запись. Untracked своего
 * заголовка не получает: для пользователя «новый файл» и «правка» — одна мысль
 * «ещё не в индексе», и делить их на две секции значит дробить один список
 * надвое. Так же умеет VS Code (`git.untrackedChanges: mixed`). Сам id
 * `untracked` в протоколе остаётся: по нему стейджинг и discard выбирают
 * `git clean` вместо `git checkout`, а строка красится своим цветом.
 */
function displayGroupOf(group: ScmGroupId): ScmGroupId {
    return group === "untracked" ? "worktree" : group;
}

/** Заголовки групп — как resource groups в VS Code. */
export const SCM_GROUP_LABELS: Readonly<Partial<Record<ScmGroupId, string>>> = {
    merge: "Merge Changes",
    index: "Staged Changes",
    worktree: "Changes",
};

/**
 * Порядок показа непустых групп. `untracked` здесь нет намеренно — он
 * приезжает под заголовком «Changes» (см. {@link displayGroupOf}).
 */
const DISPLAY_ORDER: readonly ScmGroupId[] = ["merge", "index", "worktree"];

/** Непустая группа изменений в порядке показа. */
export interface IScmChangeGroup {
    readonly id: ScmGroupId;
    readonly label: string;
    readonly changes: readonly IScmChange[];
}

/**
 * Раскладывает плоский снимок сервиса по группам в порядке VS Code:
 * Merge → Staged → Changes; пустые группы опущены. Порядок записей внутри
 * группы — порядок прихода от расширения (сортирует потребитель).
 */
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
    return DISPLAY_ORDER.filter((id) => byGroup.has(id)).map((id) => ({
        id,
        label: SCM_GROUP_LABELS[id]!,
        changes: byGroup.get(id)!,
    }));
}
