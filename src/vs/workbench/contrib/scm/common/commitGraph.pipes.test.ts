import { describe, expect, it } from "vitest";

import type { IPipe } from "./commitGraph.ts";
import {
    EMPTY_TREE_HASH,
    getNextPipes,
    getPipeSets,
    GRAPH_DEFAULT_STYLE,
    PipeKind,
    START_HASH,
} from "./commitGraph.ts";

/** lazygit `TestGetNextPipes` cases: step order and an empty tree at the root commit. */
const STYLE = "graphStyle";
const getStyle = (): string => STYLE;

function pipe(fromPos: number, toPos: number, fromHash: string, toHash: string, kind: PipeKind): IPipe {
    return { fromPos, toPos, fromHash, toHash, kind, style: STYLE };
}

describe("getNextPipes", () => {
    it("a line reaches its parent and a new one starts", () => {
        expect(getNextPipes([pipe(0, 0, "a", "b", PipeKind.Starts)], { sha: "b", parents: ["c"] }, getStyle)).toEqual([
            pipe(0, 0, "a", "b", PipeKind.Terminates),
            pipe(0, 0, "b", "c", PipeKind.Starts),
        ]);
    });

    it("a pipe terminated on the previous row is not counted, the neighbor continues", () => {
        expect(
            getNextPipes(
                [
                    pipe(0, 0, "a", "b", PipeKind.Terminates),
                    pipe(0, 0, "b", "c", PipeKind.Starts),
                    pipe(0, 1, "b", "d", PipeKind.Starts),
                ],
                { sha: "d", parents: ["e"] },
                getStyle,
            ),
        ).toEqual([
            pipe(0, 0, "b", "c", PipeKind.Continues),
            pipe(1, 1, "b", "d", PipeKind.Terminates),
            pipe(1, 1, "d", "e", PipeKind.Starts),
        ]);
    });

    it("a root commit goes into an empty tree", () => {
        expect(
            getNextPipes([pipe(0, 0, "a", "root", PipeKind.Terminates)], { sha: "root", parents: [] }, getStyle),
        ).toEqual([pipe(1, 1, "root", EMPTY_TREE_HASH, PipeKind.Starts)]);
    });

    it("a merge commit hands free columns on the right to its extra parents", () => {
        expect(
            getNextPipes([pipe(0, 0, "a", "b", PipeKind.Starts)], { sha: "b", parents: ["c", "d", "e"] }, getStyle),
        ).toEqual([
            pipe(0, 0, "a", "b", PipeKind.Terminates),
            pipe(0, 0, "b", "c", PipeKind.Starts),
            pipe(0, 1, "b", "d", PipeKind.Starts),
            pipe(0, 2, "b", "e", PipeKind.Starts),
        ]);
    });
});

describe("getPipeSets", () => {
    it("the seed pipe puts the first commit into column zero", () => {
        const sets = getPipeSets([{ sha: "1", parents: ["2"] }], getStyle);
        expect(sets).toHaveLength(1);
        expect(sets[0]).toEqual([
            // The seed's terminator inherits its color; it is not visible in the frame —
            // the renderer skips a degenerate TERMINATES in the commit column.
            { ...pipe(0, 0, START_HASH, "1", PipeKind.Terminates), style: GRAPH_DEFAULT_STYLE },
            pipe(0, 0, "1", "2", PipeKind.Starts),
        ]);
    });

    it("every commit gets exactly one pipe set", () => {
        const sets = getPipeSets(
            [
                { sha: "1", parents: ["2"] },
                { sha: "2", parents: [] },
            ],
            getStyle,
        );
        expect(sets).toHaveLength(2);
    });

    it("an empty commit list gives an empty result", () => {
        expect(getPipeSets([], getStyle)).toEqual([]);
    });
});
