import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { describe, expect, it } from "vitest";

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
    return { text, styles: Array.from(text, () => COMMIT_STYLE) };
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
    it("puts the row as is, at its own width, without padding to a common column", () => {
        const label = new TextLabelElement("");
        applyGraphLine(label, line("\u25cb "));
        expect(label.getText()).toBe("\u25cb ");

        // The neighboring row with two lanes is longer — and stays longer.
        applyGraphLine(label, line("\u2502 \u25cb "));
        expect(label.getText()).toBe("\u2502 \u25cb ");
    });

    it("a redraw does not accumulate styles from the previous row", () => {
        const label = new TextLabelElement("");
        applyGraphLine(label, { text: "\u25cb\u2500\u256f", styles: ["a", "b", "c"] });
        applyGraphLine(label, { text: "\u25cb", styles: [undefined] });
        expect(label.getText()).toBe("\u25cb");
    });
});

describe("buildRefsLabel", () => {
    it("without refs the column is empty", () => {
        expect(buildRefsLabel([], COMMIT_STYLE)).toEqual({ text: "", styles: [] });
    });

    it("order as in vscode: current branch → remote → local → tags", () => {
        // Short names: a long set would collapse into "+N" and hide the order.
        const { text } = buildRefsLabel(
            [ref("v1", "tag"), ref("feat", "head"), ref("o/main", "remote"), ref("main", "head", true)],
            COMMIT_STYLE,
        );
        expect(text.trim()).toBe("main o/main feat v1");
    });

    it("the current branch and remote get semantic colors, the rest the line color", () => {
        const { text, styles } = buildRefsLabel([ref("main", "head", true), ref("v1.0", "tag")], COMMIT_STYLE);
        expect(styles[0]).toBe(GRAPH_CURRENT_REF_STYLE);
        // The tag's first char comes after "main" and the separator space.
        expect(styles[text.indexOf("v1.0")]).toBe(COMMIT_STYLE);
        // A color for EVERY char: a misaligned array would shift the highlighting.
        expect(styles).toHaveLength(text.length);
        expect(styles.slice(0, "main".length)).toEqual(Array.from("main", () => GRAPH_CURRENT_REF_STYLE));

        const remote = buildRefsLabel([ref("origin/main", "remote")], COMMIT_STYLE);
        expect(remote.styles[0]).toBe(GRAPH_REMOTE_REF_STYLE);
        expect(remote.styles).toHaveLength(remote.text.length);
    });

    it("the separator before the commit subject stays uncolored", () => {
        const { text, styles } = buildRefsLabel([ref("main", "head", true)], COMMIT_STYLE);
        expect(text.endsWith(" ")).toBe(true);
        expect(styles[styles.length - 1]).toBeUndefined();
    });

    it("badges that do not fit collapse into +N", () => {
        const refs = ["release/2026-08-alpha", "release/2026-08-beta", "hotfix"].map((n) => ref(n, "head"));
        const { text, styles } = buildRefsLabel(refs, COMMIT_STYLE);
        expect(text.trim()).toBe("release/2026-08-alpha +2");
        expect(styles).toHaveLength(text.length);
        const plusAt = text.indexOf(" +2");
        expect(styles.slice(plusAt, plusAt + " +2".length)).toEqual(Array.from(" +2", () => "descriptionForeground"));
    });

    it("the first badge is always shown, even if it alone exceeds the cap", () => {
        const long = "b".repeat(REFS_MAX_WIDTH * 2);
        expect(buildRefsLabel([ref(long, "head")], COMMIT_STYLE).text.trim()).toBe(long);
    });
});

describe("buildCommitRow", () => {
    it("the row id is the full sha, the commit subject goes into the row", () => {
        const parts = buildCommitRow(commit({ sha: "a".repeat(40), subject: "feat: panel" }), line("○ "), COMMIT_STYLE);
        expect(parts.root.id).toBe("a".repeat(40));
        expect(parts.graph.getText()).toBe("○ ");
        expect(parts.subject.getText()).toBe("feat: panel");
    });

    it("the badge column appears only when there are refs", () => {
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
    it("carries its own id and aligns to the commit subject column", () => {
        const row = buildLoadMoreRow(4);
        expect(row.id).toBe(LOAD_MORE_ROW_ID);
        expect(row.getChildren()).toHaveLength(2);
    });
});
