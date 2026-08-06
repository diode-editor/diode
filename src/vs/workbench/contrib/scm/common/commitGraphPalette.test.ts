import { describe, expect, it } from "vitest";

import { GRAPH_DEFAULT_STYLE } from "./commitGraph.ts";
import type { IGraphPaletteCommit } from "./commitGraphPalette.ts";
import {
    createGraphStyleProvider,
    GRAPH_CURRENT_REF_STYLE,
    GRAPH_PALETTE,
    GRAPH_REMOTE_REF_STYLE,
} from "./commitGraphPalette.ts";

function commit(sha: string, refs: IGraphPaletteCommit["refs"] = []): IGraphPaletteCommit {
    return { sha, refs };
}

describe("createGraphStyleProvider", () => {
    it("раздаёт палитру по кругу в порядке списка", () => {
        const style = createGraphStyleProvider([commit("a"), commit("b"), commit("c")]);
        expect(style({ sha: "a", parents: [] })).toBe(GRAPH_PALETTE[0]);
        expect(style({ sha: "b", parents: [] })).toBe(GRAPH_PALETTE[1]);
        expect(style({ sha: "c", parents: [] })).toBe(GRAPH_PALETTE[2]);
    });

    it("палитра замыкается после последнего цвета", () => {
        const commits = ["a", "b", "c", "d", "e", "f"].map((sha) => commit(sha));
        const style = createGraphStyleProvider(commits);
        expect(style({ sha: "f", parents: [] })).toBe(GRAPH_PALETTE[0]);
    });

    it("цвет коммита стабилен при повторных запросах (merge спрашивает на каждого родителя)", () => {
        const style = createGraphStyleProvider([commit("a"), commit("b")]);
        const first = style({ sha: "a", parents: ["b", "c"] });
        expect(style({ sha: "a", parents: ["b", "c"] })).toBe(first);
        expect(style({ sha: "b", parents: [] })).not.toBe(first);
    });

    it("текущая ветка красит линию семантическим цветом и не тратит цвет палитры", () => {
        const style = createGraphStyleProvider([
            commit("head", [{ kind: "head", current: true }]),
            commit("next"),
        ]);
        expect(style({ sha: "head", parents: [] })).toBe(GRAPH_CURRENT_REF_STYLE);
        expect(style({ sha: "next", parents: [] })).toBe(GRAPH_PALETTE[0]);
    });

    it("remote-ветка красится своим цветом, тег — обычным из палитры", () => {
        const style = createGraphStyleProvider([
            commit("r", [{ kind: "remote", current: false }]),
            commit("t", [{ kind: "tag", current: false }]),
        ]);
        expect(style({ sha: "r", parents: [] })).toBe(GRAPH_REMOTE_REF_STYLE);
        expect(style({ sha: "t", parents: [] })).toBe(GRAPH_PALETTE[0]);
    });

    it("дубликат sha в списке цвет не переназначает", () => {
        const style = createGraphStyleProvider([commit("a"), commit("a"), commit("b")]);
        expect(style({ sha: "a", parents: [] })).toBe(GRAPH_PALETTE[0]);
        expect(style({ sha: "b", parents: [] })).toBe(GRAPH_PALETTE[1]);
    });

    it("неизвестный коммит (затравка графа) получает дефолтный цвет", () => {
        const style = createGraphStyleProvider([commit("a")]);
        expect(style({ sha: "unknown", parents: [] })).toBe(GRAPH_DEFAULT_STYLE);
    });
});
