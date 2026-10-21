import type { GraphStyleProvider } from "./commitGraph.ts";
import { GRAPH_DEFAULT_STYLE } from "./commitGraph.ts";

/**
 * The vscode model, not lazygit's (`md5(author) → HSL` truecolor bypassing themes): color belongs to the lane;
 * a commit with the current or a remote branch recolors the lane to a semantic color;
 * a new lane takes the next palette color round-robin.
 */

/** Colorblind-safe palette, as in vscode. */
export const GRAPH_PALETTE = [
    "scmGraph.foreground1",
    "scmGraph.foreground2",
    "scmGraph.foreground3",
    "scmGraph.foreground4",
    "scmGraph.foreground5",
] as const;

export const GRAPH_CURRENT_REF_STYLE = "scmGraph.historyItemRefColor";
export const GRAPH_REMOTE_REF_STYLE = "scmGraph.historyItemRemoteRefColor";

export interface IGraphPaletteCommit {
    readonly sha: string;
    readonly refs: readonly { readonly kind: "head" | "remote" | "tag"; readonly current: boolean }[];
}

export interface IGraphPalette {
    readonly styleFor: GraphStyleProvider;
    /** Default before layout. */
    colorOf(sha: string): string;
}

/** `undefined` means the color is inherited or taken from the palette. */
function semanticStyle(commit: IGraphPaletteCommit | undefined): string | undefined {
    if (commit === undefined) return undefined;
    if (commit.refs.some((ref) => ref.current)) return GRAPH_CURRENT_REF_STYLE;
    if (commit.refs.some((ref) => ref.kind === "remote")) return GRAPH_REMOTE_REF_STYLE;
    return undefined;
}

/** The color counter lives inside: a fresh palette per layout, otherwise colors are not reproducible. */
export function createGraphPalette(commits: readonly IGraphPaletteCommit[]): IGraphPalette {
    const byHash = new Map<string, IGraphPaletteCommit>();
    for (const commit of commits) {
        if (!byHash.has(commit.sha)) byHash.set(commit.sha, commit);
    }

    const assigned = new Map<string, string>();
    let colorIndex = -1;

    const styleFor: GraphStyleProvider = (sha, inherited) => {
        const semantic = semanticStyle(byHash.get(sha));
        let style = semantic ?? inherited;
        if (style === null) {
            colorIndex = (colorIndex + 1) % GRAPH_PALETTE.length;
            style = GRAPH_PALETTE[colorIndex];
        }
        // First assignment wins: the merge opens the lane to the merged branch, and
        // the branch's commit itself comes later and must keep the same color.
        if (!assigned.has(sha)) assigned.set(sha, style);
        return style;
    };

    return {
        styleFor,
        colorOf: (sha) => assigned.get(sha) ?? GRAPH_DEFAULT_STYLE,
    };
}
