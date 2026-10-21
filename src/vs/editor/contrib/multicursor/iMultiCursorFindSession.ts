import type { IRange } from "../../common/core/iRange.ts";
import type { ISelection } from "../../common/core/iSelection.ts";

export interface IMultiCursorSearchSpec {
    /** Never contains a line break: multi-line search is not supported. */
    readonly searchText: string;
    readonly wholeWord: boolean;
    /**
     * Always `true` for now: a deliberate divergence from VS Code, which takes this option from the
     * find widget (off by default), so Ctrl+D on `foo` picks up `FOO` and typing breaks its case.
     */
    readonly matchCase: boolean;
}

export interface IMultiCursorFindSession extends IMultiCursorSearchSpec {
    /** Stored explicitly: selections are sorted, so "last in the array" is not "last added". */
    readonly lastAdded: IRange;
    /**
     * If it differs from the current selections, the session starts over. A snapshot catches any
     * cause (mouse, undo, extension edit, find) without reentrancy flags in the hot model setter.
     */
    readonly selectionsSnapshot: readonly ISelection[];
    readonly documentVersion: number;
}
