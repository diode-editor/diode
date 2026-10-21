import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import type { IGraphLine } from "../common/commitGraph.ts";
import { GRAPH_CURRENT_REF_STYLE, GRAPH_REMOTE_REF_STYLE } from "../common/commitGraphPalette.ts";

import type { IScmCommit, IScmCommitRef } from "./graphService.ts";

/**
 * No sha column: in a ~30-wide sidebar the hash would crowd out the subject (Copy Commit ID exists).
 * The graph is not aligned into a column (as in lazygit): aligning to the maximum would
 * push every subject right for the sake of a couple of branchings.
 */

/** Badge column cap — beyond it they collapse into `+N`. */
export const REFS_MAX_WIDTH = 20;

/** Id of the load-more row: the e2e `#id` selector matches only `[A-Za-z0-9_-]`. */
export const LOAD_MORE_ROW_ID = "scmGraphLoadMore";

export const LOAD_MORE_LABEL = "Load More…";

/** Kept together to redraw the graph column on selection change without rebuilding the row. */
export interface IScmGraphRowParts {
    readonly root: HFlexElement;
    readonly graph: TextLabelElement;
    readonly subject: TextLabelElement;
}

/**
 * Width is `2 * (lane count)` and independent of selection, so the label does not jump under the cursor.
 * The last cell is a connector space that also separates the badges.
 */
export function applyGraphLine(label: TextLabelElement, line: IGraphLine): void {
    label.setText(line.text);
    label.clearCharStyles();
    for (let i = 0; i < line.styles.length; i++) {
        const style = line.styles[i];
        if (style !== undefined) label.setCharStyle(i, { fg: style });
    }
}

/** Badge order as in vscode: current branch → remote → local → tags. */
const REF_ORDER: Record<IScmCommitRef["kind"], number> = { remote: 1, head: 2, tag: 3 };

function refRank(ref: IScmCommitRef): number {
    return ref.current ? 0 : REF_ORDER[ref.kind];
}

/** Current branch and remote use semantic colors, the rest use the commit's line color (vscode rule). */
function refStyle(ref: IScmCommitRef, commitStyle: string): string {
    if (ref.current) return GRAPH_CURRENT_REF_STYLE;
    if (ref.kind === "remote") return GRAPH_REMOTE_REF_STYLE;
    return commitStyle;
}

/** Collapses into `+N` — otherwise a long branch list would eat the commit subject. */
export function buildRefsLabel(
    refs: readonly IScmCommitRef[],
    commitStyle: string,
): { text: string; styles: (string | undefined)[] } {
    if (refs.length === 0) return { text: "", styles: [] };

    const sorted = [...refs].sort((a, b) => refRank(a) - refRank(b));
    let text = "";
    const styles: (string | undefined)[] = [];
    let shown = 0;

    for (const ref of sorted) {
        const piece = shown === 0 ? ref.name : ` ${ref.name}`;
        // The first badge always shows: "+N" without a single name is less useful.
        if (shown > 0 && text.length + piece.length > REFS_MAX_WIDTH) break;
        const style = refStyle(ref, commitStyle);
        text += piece;
        for (let rest = piece.length; rest > 0; rest--) styles.push(style);
        shown++;
    }

    const hidden = sorted.length - shown;
    if (hidden > 0) {
        const piece = ` +${hidden}`;
        text += piece;
        for (let rest = piece.length; rest > 0; rest--) styles.push("descriptionForeground");
    }

    // The separator before the commit subject is outside badge highlighting.
    text += " ";
    styles.push(undefined);
    return { text, styles };
}

/** Row id is the full sha: identity in the list and the argument of context menu commands. */
export function buildCommitRow(commit: IScmCommit, line: IGraphLine, commitStyle: string): IScmGraphRowParts {
    const root = new HFlexElement();
    root.id = commit.sha;

    const graph = new TextLabelElement("");
    applyGraphLine(graph, line);
    root.addChild(graph, { width: hflexFit(), height: 1 });

    const refs = buildRefsLabel(commit.refs, commitStyle);
    if (refs.text !== "") {
        const refsLabel = new TextLabelElement(refs.text);
        for (let i = 0; i < refs.styles.length; i++) {
            const style = refs.styles[i];
            if (style !== undefined) refsLabel.setCharStyle(i, { fg: style });
        }
        root.addChild(refsLabel, { width: hflexFit(), height: 1 });
    }

    const subject = new TextLabelElement(commit.subject);
    root.addChild(subject, { width: hflexFill(), height: 1 });

    return { root, graph, subject };
}

/** `indent` is the graph width of the last row, so the text lines up under its subject. */
export function buildLoadMoreRow(indent: number): HFlexElement {
    const root = new HFlexElement();
    root.id = LOAD_MORE_ROW_ID;
    root.addChild(new TextLabelElement("".padEnd(indent, " ")), {
        width: hflexFixed(indent),
        height: 1,
    });
    const label = new TextLabelElement(LOAD_MORE_LABEL);
    label.style = { fg: "descriptionForeground" };
    root.addChild(label, { width: hflexFill(), height: 1 });
    return root;
}
