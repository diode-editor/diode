import { describe, expect, it } from "vitest";

import type { IGraphCommit } from "./commitGraph.ts";
import { GRAPH_DEFAULT_STYLE, renderCommitGraph } from "./commitGraph.ts";
import type { IGraphPaletteCommit } from "./commitGraphPalette.ts";
import {
    createGraphPalette,
    GRAPH_CURRENT_REF_STYLE,
    GRAPH_PALETTE,
    GRAPH_REMOTE_REF_STYLE,
} from "./commitGraphPalette.ts";

function commit(sha: string, refs: IGraphPaletteCommit["refs"] = []): IGraphPaletteCommit {
    return { sha, refs };
}

describe("createGraphPalette", () => {
    it("a new lane takes the next palette color, a continuation inherits it", () => {
        const { styleFor } = createGraphPalette([commit("a"), commit("b")]);
        const first = styleFor("a", null);
        expect(first).toBe(GRAPH_PALETTE[0]);
        expect(styleFor("b", first)).toBe(first);
        expect(styleFor("c", first)).toBe(first);
    });

    it("the palette wraps around after the last color", () => {
        const { styleFor } = createGraphPalette([]);
        for (let i = 0; i < GRAPH_PALETTE.length; i++) styleFor(`lane${i}`, null);
        expect(styleFor("next", null)).toBe(GRAPH_PALETTE[0]);
    });

    it("the current branch recolors its lane and does not use up a palette color", () => {
        const { styleFor } = createGraphPalette([commit("head", [{ kind: "head", current: true }])]);
        expect(styleFor("head", GRAPH_PALETTE[3])).toBe(GRAPH_CURRENT_REF_STYLE);
        expect(styleFor("next", null)).toBe(GRAPH_PALETTE[0]);
    });

    it("a remote branch gets its own color, a tag and an ordinary branch inherit the lane", () => {
        const palette = createGraphPalette([
            commit("r", [{ kind: "remote", current: false }]),
            commit("t", [{ kind: "tag", current: false }]),
            commit("f", [{ kind: "head", current: false }]),
        ]);
        expect(palette.styleFor("r", GRAPH_PALETTE[1])).toBe(GRAPH_REMOTE_REF_STYLE);
        expect(palette.styleFor("t", GRAPH_PALETTE[1])).toBe(GRAPH_PALETTE[1]);
        expect(palette.styleFor("f", GRAPH_PALETTE[1])).toBe(GRAPH_PALETTE[1]);
    });

    it("colorOf remembers a commit's lane color; the first assignment wins", () => {
        const palette = createGraphPalette([commit("a")]);
        const lane = palette.styleFor("a", null);
        // Further down the graph the same commit is asked again — its color must not "move".
        palette.styleFor("a", GRAPH_PALETTE[4]);
        expect(palette.colorOf("a")).toBe(lane);
    });

    it("colorOf before layout gives the default color", () => {
        expect(createGraphPalette([commit("a")]).colorOf("a")).toBe(GRAPH_DEFAULT_STYLE);
    });

    it("a repeated sha in a page is taken by its first occurrence", () => {
        // `git log` prints a commit twice when two branches lead into it.
        const palette = createGraphPalette([commit("a", [{ kind: "head", current: true }]), commit("a", [])]);
        expect(palette.styleFor("a", null)).toBe(GRAPH_CURRENT_REF_STYLE);
    });
});

describe("colors on a laid-out graph", () => {
    /** Node color per row — the commit symbol sits in its column. */
    function nodeStyles(commits: readonly IGraphCommit[], palette = createGraphPalette([])): (string | undefined)[] {
        const lines = renderCommitGraph(commits, null, palette.styleFor);
        return lines.map((line) => {
            const index = Array.from(line.text).findIndex((ch) => ch === "○" || ch === "◎");
            return line.styles[index];
        });
    }

    it("linear history: one branch of one color", () => {
        const styles = nodeStyles([
            { sha: "1", parents: ["2"] },
            { sha: "2", parents: ["3"] },
            { sha: "3", parents: [] },
        ]);
        expect(new Set(styles).size).toBe(1);
        expect(styles[0]).toBe(GRAPH_PALETTE[0]);
    });

    it("a merged branch gets its own color, the main one does not change", () => {
        // main: M(merge) → V → S; feature: F → S.
        const styles = nodeStyles([
            { sha: "M", parents: ["V", "F"] },
            { sha: "F", parents: ["S"] },
            { sha: "V", parents: ["S"] },
            { sha: "S", parents: [] },
        ]);
        const [mergeStyle, featureStyle, mainStyle, rootStyle] = styles;
        expect(featureStyle).not.toBe(mergeStyle);
        expect(mainStyle).toBe(mergeStyle);
        expect(rootStyle).toBe(mergeStyle);
    });

    it("the current branch paints its lane with a semantic color", () => {
        const palette = createGraphPalette([
            { sha: "1", refs: [{ kind: "head", current: true }] },
            { sha: "2", refs: [] },
        ]);
        const styles = nodeStyles(
            [
                { sha: "1", parents: ["2"] },
                { sha: "2", parents: [] },
            ],
            palette,
        );
        expect(styles).toEqual([GRAPH_CURRENT_REF_STYLE, GRAPH_CURRENT_REF_STYLE]);
    });
});
