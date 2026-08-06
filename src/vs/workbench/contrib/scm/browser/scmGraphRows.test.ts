import { describe, expect, it } from "vitest";

import { TextLabelElement } from "../../../../../../tuidom/ui/text/textLabelElement.ts";
import type { IGraphLine } from "../common/commitGraph.ts";
import { GRAPH_CURRENT_REF_STYLE, GRAPH_REMOTE_REF_STYLE } from "../common/commitGraphPalette.ts";

import type { IScmCommit, IScmCommitRef } from "./graphService.ts";
import {
    applyGraphLine,
    buildCommitRow,
    buildLoadMoreRow,
    buildRefsLabel,
    GRAPH_MAX_WIDTH,
    graphColumnWidth,
    LOAD_MORE_ROW_ID,
    REFS_MAX_WIDTH,
} from "./scmGraphRows.ts";

const COMMIT_STYLE = "scmGraph.foreground1";

function line(text: string): IGraphLine {
    return { text, styles: [...text].map(() => COMMIT_STYLE) };
}

function commit(fields: Partial<IScmCommit> & { sha: string }): IScmCommit {
    return {
        shortSha: fields.sha.slice(0, 8),
        parents: [],
        refs: [],
        author: "Eugene",
        timestamp: 0,
        subject: "subject",
        ...fields,
    };
}

function ref(name: string, kind: IScmCommitRef["kind"], current = false): IScmCommitRef {
    return { name, kind, current };
}

describe("graphColumnWidth", () => {
    it("берёт максимум по строкам — колонки должны совпасть по вертикали", () => {
        expect(graphColumnWidth([line("○ "), line("◎─╮ "), line("│ ○ ")])).toBe(4);
    });

    it("зажимается потолком: глубокое ветвление не съедает сайдбар", () => {
        expect(graphColumnWidth([line("x".repeat(40))])).toBe(GRAPH_MAX_WIDTH);
    });

    it("пустой граф — нулевая колонка", () => {
        expect(graphColumnWidth([])).toBe(0);
    });
});

describe("applyGraphLine", () => {
    it("добивает строку до ширины колонки", () => {
        const label = new TextLabelElement("");
        applyGraphLine(label, line("○ "), 6);
        expect(label.getText()).toBe("○     ");
    });

    it("обрезает строку по ширине колонки", () => {
        const label = new TextLabelElement("");
        applyGraphLine(label, line("◎─╮ │ │ "), 4);
        expect(label.getText()).toBe("◎─╮ ");
    });

    it("перерисовка не копит стили от прошлой строки", () => {
        const label = new TextLabelElement("");
        applyGraphLine(label, { text: "○─╯", styles: ["a", "b", "c"] }, 3);
        applyGraphLine(label, { text: "○", styles: [undefined] }, 3);
        expect(label.getText()).toBe("○  ");
    });
});

describe("buildRefsLabel", () => {
    it("без ref'ов колонка пустая", () => {
        expect(buildRefsLabel([], COMMIT_STYLE)).toEqual({ text: "", styles: [] });
    });

    it("порядок как в vscode: текущая ветка → remote → локальные → теги", () => {
        // Имена короткие: длинный набор схлопнулся бы в «+N» и порядок стал бы не виден.
        const { text } = buildRefsLabel(
            [ref("v1", "tag"), ref("feat", "head"), ref("o/main", "remote"), ref("main", "head", true)],
            COMMIT_STYLE,
        );
        expect(text.trim()).toBe("main o/main feat v1");
    });

    it("текущая ветка и remote красятся семантическими цветами, прочие — цветом линии", () => {
        const { text, styles } = buildRefsLabel([ref("main", "head", true), ref("v1.0", "tag")], COMMIT_STYLE);
        expect(styles[0]).toBe(GRAPH_CURRENT_REF_STYLE);
        // Первый символ тега — после «main» и пробела-разделителя.
        expect(styles[text.indexOf("v1.0")]).toBe(COMMIT_STYLE);

        const remote = buildRefsLabel([ref("origin/main", "remote")], COMMIT_STYLE);
        expect(remote.styles[0]).toBe(GRAPH_REMOTE_REF_STYLE);
    });

    it("разделитель до темы коммита остаётся неокрашенным", () => {
        const { text, styles } = buildRefsLabel([ref("main", "head", true)], COMMIT_STYLE);
        expect(text.endsWith(" ")).toBe(true);
        expect(styles[styles.length - 1]).toBeUndefined();
    });

    it("не влезающие бейджи схлопываются в +N", () => {
        const refs = ["release/2026-08-alpha", "release/2026-08-beta", "hotfix"].map((n) => ref(n, "head"));
        const { text } = buildRefsLabel(refs, COMMIT_STYLE);
        expect(text.trim()).toBe("release/2026-08-alpha +2");
    });

    it("первый бейдж показывается всегда, даже если он один длиннее потолка", () => {
        const long = "b".repeat(REFS_MAX_WIDTH * 2);
        expect(buildRefsLabel([ref(long, "head")], COMMIT_STYLE).text.trim()).toBe(long);
    });
});

describe("buildCommitRow", () => {
    it("id строки — полный sha, тема коммита попадает в строку", () => {
        const parts = buildCommitRow(commit({ sha: "a".repeat(40), subject: "feat: панель" }), line("○ "), 2, COMMIT_STYLE);
        expect(parts.root.id).toBe("a".repeat(40));
        expect(parts.graph.getText()).toBe("○ ");
        expect(parts.subject.getText()).toBe("feat: панель");
    });

    it("колонка бейджей появляется только при наличии ref'ов", () => {
        const bare = buildCommitRow(commit({ sha: "a".repeat(40) }), line("○ "), 2, COMMIT_STYLE);
        const tagged = buildCommitRow(
            commit({ sha: "b".repeat(40), refs: [ref("main", "head", true)] }),
            line("○ "),
            2,
            COMMIT_STYLE,
        );
        expect(tagged.root.getChildren().length).toBe(bare.root.getChildren().length + 1);
    });
});

describe("buildLoadMoreRow", () => {
    it("несёт свой id и выравнивается по колонке тем коммитов", () => {
        const row = buildLoadMoreRow(4);
        expect(row.id).toBe(LOAD_MORE_ROW_ID);
        expect(row.getChildren()).toHaveLength(2);
    });
});
