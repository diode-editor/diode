/**
 * Verbatim port of the lazygit pipe model (`pkg/gui/presentation/graph/{graph,cell}.go`):
 * the order of steps in {@link getNextPipes} and passes in {@link renderPipeSet} decides which
 * line moves where and whose color wins — the `graph_test.go` fixtures pin it down.
 * Difference: instead of an ANSI string, an {@link IGraphLine} with a theme token per char.
 */

/** Value order is the pipe sort key. */
export enum PipeKind {
    /** The commit is the line's parent. */
    Terminates,
    Starts,
    Continues,
}

/** `fromPos` is the column in the previous commit's row, `toPos` in the current one. */
export interface IPipe {
    readonly fromHash: string;
    readonly toHash: string;
    readonly fromPos: number;
    readonly toPos: number;
    readonly kind: PipeKind;
    readonly style: string;
}

export interface IGraphCommit {
    readonly sha: string;
    /** In git order; empty means a root commit. */
    readonly parents: readonly string[];
}

export interface IGraphLine {
    readonly text: string;
    /** `undefined` means an uncolored char. */
    readonly styles: readonly (string | undefined)[];
}

/**
 * `inherited` is the color of the continued line, `null` means a new lane. Deviates from lazygit
 * (color by commit author): the color lives on the lane, as in vscode — otherwise every commit
 * of a linear history would get its own color.
 */
export type GraphStyleProvider = (sha: string, inherited: string | null) => string;

/** The git empty tree is the root commit's parent (`git hash-object -t tree /dev/null`). */
export const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export const START_HASH = "START";

/** Counterpart of lazygit `FgLightWhite.SetBold()`. */
export const GRAPH_HIGHLIGHT_STYLE = "list.highlightForeground";

/** Style of the seed pipe and untouched cells; it almost never reaches the frame. */
export const GRAPH_DEFAULT_STYLE = "foreground";

const MERGE_SYMBOL = "◎";
const COMMIT_SYMBOL = "○";

/** `null` equals nothing: "no selected commit" must not match a pipe without a source. */
function equalHashes(a: string | null, b: string | null): boolean {
    if (a === null || b === null) return false;
    return a === b;
}

const pipeLeft = (pipe: IPipe): number => Math.min(pipe.fromPos, pipe.toPos);
const pipeRight = (pipe: IPipe): number => Math.max(pipe.fromPos, pipe.toPos);

export function renderCommitGraph(
    commits: readonly IGraphCommit[],
    selectedHash: string | null,
    getStyle: GraphStyleProvider,
): IGraphLine[] {
    const pipeSets = getPipeSets(commits, getStyle);
    return pipeSets.map((pipeSet, index) =>
        renderPipeSet(pipeSet, selectedHash, index > 0 ? commits[index - 1].sha : null),
    );
}

/**
 * The seed is a fake STARTS pipe from {@link START_HASH}: without it the first commit
 * would find no child and drift to column 1.
 */
export function getPipeSets(commits: readonly IGraphCommit[], getStyle: GraphStyleProvider): IPipe[][] {
    if (commits.length === 0) return [];

    let pipes: IPipe[] = [
        {
            fromPos: 0,
            toPos: 0,
            fromHash: START_HASH,
            toHash: commits[0].sha,
            kind: PipeKind.Starts,
            style: GRAPH_DEFAULT_STYLE,
        },
    ];

    return commits.map((commit) => {
        pipes = getNextPipes(pipes, commit, getStyle);
        return pipes;
    });
}

/**
 * Step order follows the original: `maxPos` is computed over all previous pipes,
 * including terminated ones, and only then are those dropped.
 */
export function getNextPipes(prevPipes: readonly IPipe[], commit: IGraphCommit, getStyle: GraphStyleProvider): IPipe[] {
    let maxPos = 0;
    for (const pipe of prevPipes) {
        if (pipe.toPos > maxPos) maxPos = pipe.toPos;
    }

    const currentPipes = prevPipes.filter((pipe) => pipe.kind !== PipeKind.Terminates);

    const newPipes: IPipe[] = [];
    // Not connected to anything (only happens with `git log --all`) — goes to the far end.
    let pos = maxPos + 1;
    // A line ending in the commit column hands its color to the line to the first parent.
    let inherited: string | null = null;
    for (const pipe of currentPipes) {
        if (equalHashes(pipe.toHash, commit.sha)) {
            pos = pipe.toPos;
            // The seed carries no color: the first commit starts a lane from scratch.
            inherited = pipe.fromHash === START_HASH ? null : pipe.style;
            break;
        }
    }

    // An occupied column is where a pipe ends; a traversed one is where it starts,
    // ends or crosses.
    const takenSpots = new Set<number>();
    const traversedSpots = new Set<number>();

    const toHash = commit.parents.length === 0 ? EMPTY_TREE_HASH : commit.parents[0];
    newPipes.push({
        fromPos: pos,
        toPos: pos,
        fromHash: commit.sha,
        toHash,
        kind: PipeKind.Starts,
        style: getStyle(commit.sha, inherited),
    });

    const traversedSpotsForContinuingPipes = new Set<number>();
    for (const pipe of currentPipes) {
        if (!equalHashes(pipe.toHash, commit.sha)) traversedSpotsForContinuingPipes.add(pipe.toPos);
    }

    const getNextAvailablePosForContinuingPipe = (): number => {
        let i = 0;
        while (traversedSpots.has(i)) i++;
        return i;
    };

    const getNextAvailablePosForNewPipe = (): number => {
        let i = 0;
        while (takenSpots.has(i) || traversedSpotsForContinuingPipes.has(i)) i++;
        return i;
    };

    const traverse = (from: number, to: number): void => {
        const left = Math.min(from, to);
        const right = Math.max(from, to);
        for (let i = left; i <= right; i++) traversedSpots.add(i);
        takenSpots.add(to);
    };

    for (const pipe of currentPipes) {
        if (equalHashes(pipe.toHash, commit.sha)) {
            newPipes.push({
                fromPos: pipe.toPos,
                toPos: pos,
                fromHash: pipe.fromHash,
                toHash: pipe.toHash,
                kind: PipeKind.Terminates,
                style: pipe.style,
            });
            traverse(pipe.toPos, pos);
        } else if (pipe.toPos < pos) {
            const availablePos = getNextAvailablePosForContinuingPipe();
            newPipes.push({
                fromPos: pipe.toPos,
                toPos: availablePos,
                fromHash: pipe.fromHash,
                toHash: pipe.toHash,
                kind: PipeKind.Continues,
                style: pipe.style,
            });
            traverse(pipe.toPos, availablePos);
        }
    }

    if (commit.parents.length > 1) {
        for (const parent of commit.parents.slice(1)) {
            const availablePos = getNextAvailablePosForNewPipe();
            // Assume continuing lines stay in their columns.
            newPipes.push({
                fromPos: pos,
                toPos: availablePos,
                fromHash: commit.sha,
                toHash: parent,
                kind: PipeKind.Starts,
                // A merged branch is a new lane: the merge's color would mean "same branch".
                style: getStyle(parent, null),
            });
            takenSpots.add(availablePos);
        }
    }

    for (const pipe of currentPipes) {
        if (!equalHashes(pipe.toHash, commit.sha) && pipe.toPos > pos) {
            // Continues — and may shift left on the way, filling a hole.
            let last = pipe.toPos;
            for (let i = pipe.toPos; i > pos; i--) {
                if (takenSpots.has(i) || traversedSpots.has(i)) break;
                last = i;
            }
            newPipes.push({
                fromPos: pipe.toPos,
                toPos: last,
                fromHash: pipe.fromHash,
                toHash: pipe.toHash,
                kind: PipeKind.Continues,
                style: pipe.style,
            });
            traverse(pipe.toPos, last);
        }
    }

    newPipes.sort((a, b) => (a.toPos === b.toPos ? a.kind - b.kind : a.toPos - b.toPos));

    return newPipes;
}

/** A row cell: two chars — node/corner and the connector to its right. */
class Cell {
    private up = false;
    private down = false;
    private left = false;
    private right = false;
    private type: "connection" | "commit" | "merge" = "connection";
    private rightStyle: string | null = null;
    private style: string = GRAPH_DEFAULT_STYLE;

    public reset(): void {
        this.up = false;
        this.down = false;
        this.left = false;
        this.right = false;
    }

    public setUp(style: string): this {
        this.up = true;
        this.style = style;
        return this;
    }

    public setDown(style: string): this {
        this.down = true;
        this.style = style;
        return this;
    }

    public setLeft(style: string): this {
        this.left = true;
        // Vertical wins over horizontal: its color is not overridden.
        if (!this.up && !this.down) this.style = style;
        return this;
    }

    public setRight(style: string, override: boolean): this {
        this.right = true;
        if (this.rightStyle === null || override) this.rightStyle = style;
        return this;
    }

    public setStyle(style: string): this {
        this.style = style;
        return this;
    }

    public setType(type: "commit" | "merge"): this {
        this.type = type;
        return this;
    }

    /** Spaces stay uncolored: tests check every char's style (as in lazygit). */
    public render(): { chars: [string, string]; styles: [string | undefined, string | undefined] } {
        const [box, connector] = getBoxDrawingChars(this.up, this.down, this.left, this.right);
        const first = this.type === "commit" ? COMMIT_SYMBOL : this.type === "merge" ? MERGE_SYMBOL : box;
        const rightStyle = this.rightStyle ?? this.style;
        return {
            chars: [first, connector],
            styles: [first === " " ? undefined : this.style, connector === " " ? undefined : rightStyle],
        };
    }
}

/**
 * Exported for tests: the table has 16 combinations, and the lazygit fixtures do not hit all of them.
 */
export function getBoxDrawingChars(up: boolean, down: boolean, left: boolean, right: boolean): [string, string] {
    if (up && down && left && right) return ["│", "─"];
    if (up && down && left && !right) return ["│", " "];
    if (up && down && !left && right) return ["│", "─"];
    if (up && down && !left && !right) return ["│", " "];
    if (up && !down && left && right) return ["┴", "─"];
    if (up && !down && left && !right) return ["╯", " "];
    if (up && !down && !left && right) return ["╰", "─"];
    if (up && !down && !left && !right) return ["╵", " "];
    if (!up && down && left && right) return ["┬", "─"];
    if (!up && down && left && !right) return ["╮", " "];
    if (!up && down && !left && right) return ["╭", "─"];
    if (!up && down && !left && !right) return ["╷", " "];
    if (!up && !down && left && right) return ["─", "─"];
    if (!up && !down && left && !right) return ["─", " "];
    if (!up && !down && !left && right) return ["╶", "─"];
    return [" ", " "];
}

/**
 * Three passes set color priority: unselected STARTS (they override the right connector),
 * other unselected, and last the selected commit's lines on top.
 */
export function renderPipeSet(
    pipes: readonly IPipe[],
    selectedHash: string | null,
    prevCommitHash: string | null,
): IGraphLine {
    let maxPos = 0;
    let commitPos = 0;
    let startCount = 0;
    for (const pipe of pipes) {
        if (pipe.kind === PipeKind.Starts) {
            startCount++;
            commitPos = pipe.fromPos;
        } else if (pipe.kind === PipeKind.Terminates) {
            commitPos = pipe.toPos;
        }
        if (pipeRight(pipe) > maxPos) maxPos = pipeRight(pipe);
    }
    const isMerge = startCount > 1;

    const cells: Cell[] = [];
    for (let i = 0; i <= maxPos; i++) cells.push(new Cell());

    const renderPipe = (pipe: IPipe, style: string, overrideRightStyle: boolean): void => {
        const left = pipeLeft(pipe);
        const right = pipeRight(pipe);

        if (left !== right) {
            for (let i = left + 1; i < right; i++) cells[i].setLeft(style).setRight(style, overrideRightStyle);
            cells[left].setRight(style, overrideRightStyle);
            cells[right].setLeft(style);
        }

        if (pipe.kind === PipeKind.Starts || pipe.kind === PipeKind.Continues) cells[pipe.toPos].setDown(style);
        if (pipe.kind === PipeKind.Terminates || pipe.kind === PipeKind.Continues) cells[pipe.fromPos].setUp(style);
    };

    // Highlight only if the row has a visible line of the selected commit.
    let highlight = true;
    if (prevCommitHash !== null && equalHashes(prevCommitHash, selectedHash)) {
        highlight = false;
        for (const pipe of pipes) {
            if (
                equalHashes(pipe.fromHash, selectedHash) &&
                (pipe.kind !== PipeKind.Terminates || pipe.fromPos !== pipe.toPos)
            ) {
                highlight = true;
            }
        }
    }

    const selectedPipes: IPipe[] = [];
    const nonSelectedPipes: IPipe[] = [];
    for (const pipe of pipes) {
        (highlight && equalHashes(pipe.fromHash, selectedHash) ? selectedPipes : nonSelectedPipes).push(pipe);
    }

    for (const pipe of nonSelectedPipes) {
        if (pipe.kind === PipeKind.Starts) renderPipe(pipe, pipe.style, true);
    }

    for (const pipe of nonSelectedPipes) {
        // Skip a degenerate TERMINATES in the commit column — otherwise it
        // would override the color of the line starting here.
        const degenerateTerminator =
            pipe.kind === PipeKind.Terminates && pipe.fromPos === commitPos && pipe.toPos === commitPos;
        if (pipe.kind !== PipeKind.Starts && !degenerateTerminator) renderPipe(pipe, pipe.style, false);
    }

    for (const pipe of selectedPipes) {
        for (let i = pipeLeft(pipe); i <= pipeRight(pipe); i++) cells[i].reset();
    }
    for (const pipe of selectedPipes) {
        renderPipe(pipe, GRAPH_HIGHLIGHT_STYLE, true);
        if (pipe.toPos === commitPos) cells[pipe.toPos].setStyle(GRAPH_HIGHLIGHT_STYLE);
    }

    cells[commitPos].setType(isMerge ? "merge" : "commit");

    let text = "";
    const styles: (string | undefined)[] = [];
    for (const cell of cells) {
        const rendered = cell.render();
        text += rendered.chars[0] + rendered.chars[1];
        styles.push(rendered.styles[0], rendered.styles[1]);
    }
    return { text, styles };
}
