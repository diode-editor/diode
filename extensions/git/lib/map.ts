/** A resource decoration: a single-letter badge plus a theme color id. */
export interface IStatusDecoration {
    badge: string;
    colorId: string;
}

// Effective single-status letter → badge + `gitDecoration.*` color id.
const DECORATION_BY_STATUS: Record<string, IStatusDecoration> = {
    M: { badge: "M", colorId: "gitDecoration.modifiedResourceForeground" },
    A: { badge: "A", colorId: "gitDecoration.addedResourceForeground" },
    D: { badge: "D", colorId: "gitDecoration.deletedResourceForeground" },
    R: { badge: "R", colorId: "gitDecoration.renamedResourceForeground" },
    C: { badge: "C", colorId: "gitDecoration.renamedResourceForeground" },
    "?": { badge: "U", colorId: "gitDecoration.untrackedResourceForeground" },
    "!": { badge: "I", colorId: "gitDecoration.ignoredResourceForeground" },
    U: { badge: "U", colorId: "gitDecoration.conflictingResourceForeground" },
};

// Porcelain `XY` codes that denote an unmerged (conflicting) path.
const UNMERGED_CODES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

/**
 * Map a porcelain `XY` status to a resource decoration. Untracked (`??`),
 * ignored (`!!`) and unmerged combinations are recognised first; otherwise the
 * index status wins over the working-tree status. Unknown codes fall back to
 * "modified".
 */
export function statusToDecoration(xy: string): IStatusDecoration {
    const code = primaryStatusChar(xy);
    return DECORATION_BY_STATUS[code] ?? DECORATION_BY_STATUS.M;
}

/** Reduce a two-character `XY` code to the single status letter that drives the badge. */
function primaryStatusChar(xy: string): string {
    if (xy === "??") return "?";
    if (xy === "!!") return "!";
    if (UNMERGED_CODES.has(xy)) return "U";
    const x = xy[0];
    return x !== " " ? x : xy[1];
}

/** Группа ресурсов SCM-вьюлета — как resource groups в VS Code. */
export type ScmGroupId = "merge" | "index" | "worktree" | "untracked";

/** Одна запись для вкладки Changes: группа + буква-бейдж + цвет. */
export interface IScmResourceState {
    readonly group: ScmGroupId;
    readonly badge: string;
    readonly colorId: string;
}

/**
 * Раскладывает porcelain `XY` в записи по группам (0..2): конфликт — одна запись
 * `merge`, untracked — `untracked`, иначе `X` даёт запись `index`, `Y` — запись
 * `worktree` (файл `MM` попадает в обе, как в VS Code). Ignored (`!!`) не
 * публикуется вовсе. Буква и цвет каждой записи — по своей стороне `XY`, а не по
 * общему приоритету {@link statusToDecoration} (тот остаётся для дерева файлов).
 */
export function xyToResourceStates(xy: string): IScmResourceState[] {
    if (xy === "!!") return [];
    if (xy === "??") return [{ group: "untracked", badge: "U", colorId: DECORATION_BY_STATUS["?"].colorId }];
    if (UNMERGED_CODES.has(xy)) {
        return [{ group: "merge", badge: "U", colorId: DECORATION_BY_STATUS.U.colorId }];
    }
    const states: IScmResourceState[] = [];
    const x = xy[0];
    const y = xy[1];
    if (x !== undefined && x !== " ") states.push({ group: "index", ...decorationFor(x) });
    if (y !== undefined && y !== " ") states.push({ group: "worktree", ...decorationFor(y) });
    return states;
}

/** Бейдж и цвет одной стороны `XY`; неизвестная буква — как modified, с самой буквой. */
function decorationFor(letter: string): { badge: string; colorId: string } {
    const deco = DECORATION_BY_STATUS[letter];
    if (deco === undefined) return { badge: letter, colorId: DECORATION_BY_STATUS.M.colorId };
    return { badge: deco.badge, colorId: deco.colorId };
}
