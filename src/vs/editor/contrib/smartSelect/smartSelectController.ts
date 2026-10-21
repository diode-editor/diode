import type { IDisposable } from "../../../base/common/lifecycle.ts";
import { type IPosition, positionsEqual } from "../../common/core/iPosition.ts";
import { type IRange, rangeContainsPosition, rangesEqual } from "../../common/core/iRange.ts";
import { createSelection, type ISelection, selectionToRange } from "../../common/core/iSelection.ts";
import type { EditorViewState } from "../../common/viewModel/editorViewState.ts";

/** Upstream `SelectionRanges`. */
class SelectionRanges {
    public constructor(
        public readonly index: number,
        public readonly ranges: readonly IRange[],
    ) {}

    /** Ступень, равная текущей, проскакивается. */
    public mov(forward: boolean): SelectionRanges {
        const index = this.index + (forward ? 1 : -1);
        if (index < 0 || index >= this.ranges.length) return this;
        const next = new SelectionRanges(index, this.ranges);
        return rangesEqual(next.ranges[index], this.ranges[this.index]) ? next.mov(forward) : next;
    }
}

export type ComputeSelectionRanges = (positions: readonly IPosition[]) => Promise<IRange[][]>;

/**
 * Upstream `SmartSelectController`. Любая смена выделения не этим контроллером
 * забывает стек — как и правка документа, даже без сдвига каретки.
 */
export class SmartSelectController {
    private state: SelectionRanges[] | undefined;
    private stateVersionId = 0;
    private selectionListener: IDisposable | undefined;
    // Stryker disable next-line BooleanLiteral: до первой подписки флаг не читается, а после — всегда сброшен finally
    private ignoreSelection = false;

    public constructor(private readonly viewState: EditorViewState) {}

    public async run(forward: boolean, compute: ComputeSelectionRanges): Promise<void> {
        const document = this.viewState.document;
        if (this.stateVersionId !== document.versionId) this.forget();

        if (this.state === undefined) {
            const selections = this.viewState.selections;
            const versionId = document.versionId;
            const ranges = await compute(selections.map((selection) => selection.active));
            if (ranges.length !== selections.length) return;
            if (document.versionId !== versionId || !sameSelections(this.viewState.selections, selections)) return;

            this.state = ranges.map((oneRanges, i) => {
                const selected = selectionToRange(selections[i]);
                const enclosing = oneRanges.filter(
                    (range) =>
                        rangeContainsPosition(range, selected.start) && rangeContainsPosition(range, selected.end),
                );
                return new SelectionRanges(0, [selected, ...enclosing]);
            });
            this.stateVersionId = versionId;
            this.selectionListener = this.viewState.onDidChangeCursorPosition(() => {
                if (!this.ignoreSelection) this.forget();
            });
        }

        this.state = this.state.map((state) => state.mov(forward));
        const next = this.state.map(({ index, ranges }) => {
            const { start, end } = ranges[index];
            return createSelection(start.line, start.character, end.line, end.character);
        });
        this.ignoreSelection = true;
        try {
            this.viewState.selections = next;
        } finally {
            this.ignoreSelection = false;
        }
    }

    private forget(): void {
        this.selectionListener?.dispose();
        this.selectionListener = undefined;
        this.state = undefined;
    }
}

function sameSelections(a: readonly ISelection[], b: readonly ISelection[]): boolean {
    return (
        a.length === b.length &&
        a.every(
            (selection, i) =>
                positionsEqual(selection.anchor, b[i].anchor) && positionsEqual(selection.active, b[i].active),
        )
    );
}
