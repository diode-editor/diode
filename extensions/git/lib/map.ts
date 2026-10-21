export interface IStatusDecoration {
    badge: string;
    colorId: string;
    /**
     * Всплывает ли к папкам-предкам. Как в эталоне (`Resource.resourceDecoration`):
     * удалённые не всплывают; ignored там отдаёт отдельный провайдер без `propagate`.
     */
    propagate: boolean;
}

const DECORATION_BY_STATUS = {
    M: { badge: "M", colorId: "gitDecoration.modifiedResourceForeground", propagate: true },
    A: { badge: "A", colorId: "gitDecoration.addedResourceForeground", propagate: true },
    D: { badge: "D", colorId: "gitDecoration.deletedResourceForeground", propagate: false },
    R: { badge: "R", colorId: "gitDecoration.renamedResourceForeground", propagate: true },
    C: { badge: "C", colorId: "gitDecoration.renamedResourceForeground", propagate: true },
    "?": { badge: "U", colorId: "gitDecoration.untrackedResourceForeground", propagate: true },
    "!": { badge: "I", colorId: "gitDecoration.ignoredResourceForeground", propagate: false },
    U: { badge: "U", colorId: "gitDecoration.conflictingResourceForeground", propagate: true },
} satisfies Record<string, IStatusDecoration>;

// `Record<string, T>` отдал бы на любой ключ непустой тип, и проверка на
// неизвестную букву выглядела бы мёртвой.
const DECORATION_LOOKUP: Partial<Record<string, IStatusDecoration>> = DECORATION_BY_STATUS;

const UNMERGED_CODES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

/** Индекс важнее рабочего дерева; неизвестный код — «modified». */
export function statusToDecoration(xy: string): IStatusDecoration {
    const code = primaryStatusChar(xy);
    return DECORATION_LOOKUP[code] ?? DECORATION_BY_STATUS.M;
}

function primaryStatusChar(xy: string): string {
    if (xy === "??") return "?";
    if (xy === "!!") return "!";
    if (UNMERGED_CODES.has(xy)) return "U";
    const x = xy[0];
    return x !== " " ? x : xy[1];
}

export type ScmGroupId = "merge" | "index" | "worktree" | "untracked";

export interface IScmResourceState {
    readonly group: ScmGroupId;
    readonly badge: string;
    readonly colorId: string;
}

/**
 * `MM` попадает и в `index`, и в `worktree`, как в VS Code. Буква каждой записи —
 * по своей стороне `XY`, а не по приоритету {@link statusToDecoration} (тот — для дерева файлов).
 */
export function xyToResourceStates(xy: string): IScmResourceState[] {
    if (xy === "!!") return [];
    if (xy === "??") return [{ group: "untracked", badge: "U", colorId: DECORATION_BY_STATUS["?"].colorId }];
    if (UNMERGED_CODES.has(xy)) {
        return [{ group: "merge", badge: "U", colorId: DECORATION_BY_STATUS.U.colorId }];
    }
    const states: IScmResourceState[] = [];
    const x = xy.at(0);
    const y = xy.at(1);
    if (x !== undefined && x !== " ") states.push({ group: "index", ...decorationFor(x) });
    if (y !== undefined && y !== " ") states.push({ group: "worktree", ...decorationFor(y) });
    return states;
}

/** Неизвестная буква — цвет modified, бейдж — сама буква. */
function decorationFor(letter: string): { badge: string; colorId: string } {
    const deco = DECORATION_LOOKUP[letter];
    if (deco === undefined) return { badge: letter, colorId: DECORATION_BY_STATUS.M.colorId };
    return { badge: deco.badge, colorId: deco.colorId };
}
