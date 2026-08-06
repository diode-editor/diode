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
    it("новая дорожка берёт следующий цвет палитры, продолжение — наследует", () => {
        const { styleFor } = createGraphPalette([commit("a"), commit("b")]);
        const first = styleFor("a", null);
        expect(first).toBe(GRAPH_PALETTE[0]);
        // Тот же цвет тянется вниз по ветке, сколько бы в ней ни было коммитов.
        expect(styleFor("b", first)).toBe(first);
        expect(styleFor("c", first)).toBe(first);
    });

    it("палитра замыкается после последнего цвета", () => {
        const { styleFor } = createGraphPalette([]);
        for (let i = 0; i < GRAPH_PALETTE.length; i++) styleFor(`lane${i}`, null);
        expect(styleFor("next", null)).toBe(GRAPH_PALETTE[0]);
    });

    it("текущая ветка перекрашивает свою дорожку и цвет палитры не тратит", () => {
        const { styleFor } = createGraphPalette([commit("head", [{ kind: "head", current: true }])]);
        expect(styleFor("head", GRAPH_PALETTE[3])).toBe(GRAPH_CURRENT_REF_STYLE);
        expect(styleFor("next", null)).toBe(GRAPH_PALETTE[0]);
    });

    it("remote-ветка красится своим цветом, тег и обычная ветка наследуют дорожку", () => {
        const palette = createGraphPalette([
            commit("r", [{ kind: "remote", current: false }]),
            commit("t", [{ kind: "tag", current: false }]),
            commit("f", [{ kind: "head", current: false }]),
        ]);
        expect(palette.styleFor("r", GRAPH_PALETTE[1])).toBe(GRAPH_REMOTE_REF_STYLE);
        expect(palette.styleFor("t", GRAPH_PALETTE[1])).toBe(GRAPH_PALETTE[1]);
        expect(palette.styleFor("f", GRAPH_PALETTE[1])).toBe(GRAPH_PALETTE[1]);
    });

    it("colorOf помнит цвет дорожки коммита; первое присвоение побеждает", () => {
        const palette = createGraphPalette([commit("a")]);
        const lane = palette.styleFor("a", null);
        // Ниже по графу тот же коммит спросят снова — цвет не должен «переехать».
        palette.styleFor("a", GRAPH_PALETTE[4]);
        expect(palette.colorOf("a")).toBe(lane);
    });

    it("colorOf до укладки — дефолтный цвет", () => {
        expect(createGraphPalette([commit("a")]).colorOf("a")).toBe(GRAPH_DEFAULT_STYLE);
    });

    it("повторный sha в странице берётся по первому вхождению", () => {
        // `git log` печатает коммит дважды, когда в него приходят две ветки.
        const palette = createGraphPalette([
            commit("a", [{ kind: "head", current: true }]),
            commit("a", []),
        ]);
        expect(palette.styleFor("a", null)).toBe(GRAPH_CURRENT_REF_STYLE);
    });
});

describe("цвета на уложенном графе", () => {
    /** Цвет узла строки — символ коммита стоит в его колонке. */
    function nodeStyles(commits: readonly IGraphCommit[], palette = createGraphPalette([])): (string | undefined)[] {
        const lines = renderCommitGraph(commits, null, palette.styleFor);
        return lines.map((line) => {
            const index = [...line.text].findIndex((ch) => ch === "○" || ch === "◎");
            return line.styles[index];
        });
    }

    it("линейная история — одна ветка одного цвета", () => {
        const styles = nodeStyles([
            { sha: "1", parents: ["2"] },
            { sha: "2", parents: ["3"] },
            { sha: "3", parents: [] },
        ]);
        expect(new Set(styles).size).toBe(1);
        expect(styles[0]).toBe(GRAPH_PALETTE[0]);
    });

    it("влитая ветка получает свой цвет, основная его не меняет", () => {
        // main: M(merge) → V → S; feature: F → S.
        const styles = nodeStyles([
            { sha: "M", parents: ["V", "F"] },
            { sha: "F", parents: ["S"] },
            { sha: "V", parents: ["S"] },
            { sha: "S", parents: [] },
        ]);
        const [mergeStyle, featureStyle, mainStyle, rootStyle] = styles;
        expect(featureStyle).not.toBe(mergeStyle);
        // Дорожка main проходит через merge, коммит в main и общий корень.
        expect(mainStyle).toBe(mergeStyle);
        expect(rootStyle).toBe(mergeStyle);
    });

    it("текущая ветка красит свою дорожку семантическим цветом", () => {
        const palette = createGraphPalette([
            { sha: "1", refs: [{ kind: "head", current: true }] },
            { sha: "2", refs: [] },
        ]);
        const styles = nodeStyles([{ sha: "1", parents: ["2"] }, { sha: "2", parents: [] }], palette);
        expect(styles).toEqual([GRAPH_CURRENT_REF_STYLE, GRAPH_CURRENT_REF_STYLE]);
    });
});
