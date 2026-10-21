export interface IStatusDecoration {
    badge: string;
    colorId: string;
    /**
     * Whether it propagates to ancestor folders. As upstream (`Resource.resourceDecoration`):
     * deleted files don't propagate; there, ignored files come from a separate provider without `propagate`.
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

// `Record<string, T>` would give a non-undefined type for any key, and the check for
// an unknown letter would look dead.
const DECORATION_LOOKUP: Partial<Record<string, IStatusDecoration>> = DECORATION_BY_STATUS;

const UNMERGED_CODES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

/** The index wins over the working tree; an unknown code means "modified". */
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
 * `MM` lands in both `index` and `worktree`, as in VS Code. Each entry's letter comes
 * from its own side of `XY`, not from the {@link statusToDecoration} priority (that one is for the file tree).
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

/** An unknown letter gets the modified color, with the letter itself as the badge. */
function decorationFor(letter: string): { badge: string; colorId: string } {
    const deco = DECORATION_LOOKUP[letter];
    if (deco === undefined) return { badge: letter, colorId: DECORATION_BY_STATUS.M.colorId };
    return { badge: deco.badge, colorId: deco.colorId };
}
