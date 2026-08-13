import { describe, expect, it } from "vitest";

import { TextLabelElement } from "@tuidom/all/ui/text/textLabelElement";
import type { IGraphLine } from "../common/commitGraph.ts";
import { GRAPH_CURRENT_REF_STYLE, GRAPH_REMOTE_REF_STYLE } from "../common/commitGraphPalette.ts";

import type { IScmCommit, IScmCommitRef } from "./graphService.ts";
import {
    applyGraphLine,
    buildCommitRow,
    buildLoadMoreRow,
    buildRefsLabel,
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

describe("applyGraphLine", () => {
    it("кладёт строку как есть — своей ширины, без добивки до общей колонки", () => {
        const label = new TextLabelElement("");
        applyGraphLine(label, line("\u25cb "));
        expect(label.getText()).toBe("\u25cb ");

        // Соседняя строка с двумя дорожками длиннее — и остаётся длиннее.
        applyGraphLine(label, line("\u2502 \u25cb "));
        expect(label.getText()).toBe("\u2502 \u25cb ");
    });

    it("перерисовка не копит стили от прошлой строки", () => {
        const label = new TextLabelElement("");
        applyGraphLine(label, { text: "\u25cb\u2500\u256f", styles: ["a", "b", "c"] });
        applyGraphLine(label, { text: "\u25cb", styles: [undefined] });
        expect(label.getText()).toBe("\u25cb");
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
        const parts = buildCommitRow(commit({ sha: "a".repeat(40), subject: "feat: панель" }), line("○ "), COMMIT_STYLE);
        expect(parts.root.id).toBe("a".repeat(40));
        expect(parts.graph.getText()).toBe("○ ");
        expect(parts.subject.getText()).toBe("feat: панель");
    });

    it("колонка бейджей появляется только при наличии ref'ов", () => {
        const bare = buildCommitRow(commit({ sha: "a".repeat(40) }), line("○ "), COMMIT_STYLE);
        const tagged = buildCommitRow(
            commit({ sha: "b".repeat(40), refs: [ref("main", "head", true)] }),
            line("○ "),
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
