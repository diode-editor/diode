import { describe, expect, it } from "vitest";

import { OperatingSystem } from "../../../../../base/common/platform.ts";

import { detectLinks, getLinkSuffix, removeLinkQueryString, toLinkSuffix } from "./terminalLinkParsing.ts";

// Cases the upstream suite (terminalLinkParsing.test.ts) leaves out.

function paths(line: string): [number, string][] {
    return detectLinks(line, OperatingSystem.Linux).map((link) => [link.path.index, link.path.text]);
}

describe("terminalLinkParsing — beyond the upstream suite", () => {
    it("a range suffix keeps its end row and column", () => {
        expect(getLinkSuffix("foo:339:12-341.789")).toMatchObject({ row: 339, col: 12, rowEnd: 341, colEnd: 789 });
        expect(getLinkSuffix('"foo", lines 339-341, characters 12-789')).toMatchObject({
            row: 339,
            col: 12,
            rowEnd: 341,
            colEnd: 789,
        });
        expect(getLinkSuffix("foo:339:12")).toMatchObject({ row: 339, col: 12 });
        expect(getLinkSuffix("foo")).toBeNull();
    });

    it("a match without named groups is a suffix without numbers", () => {
        const match = /x/.exec("ax");
        expect(match).not.toBeNull();
        expect(toLinkSuffix(match!)).toStrictEqual({
            row: undefined,
            col: undefined,
            rowEnd: undefined,
            colEnd: undefined,
            suffix: { index: 1, text: "x" },
        });
    });

    it("the suffix must end the link; a non-breaking space works as a space", () => {
        expect(getLinkSuffix("foo:339 bar")).toBeNull();
        expect(getLinkSuffix("foo,\u00A0line 339")).toMatchObject({ row: 339 });
    });

    it("the query string goes, a `\\\\?\\` prefix is not one", () => {
        expect(removeLinkQueryString("a.ts?x=1")).toBe("a.ts");
        expect(removeLinkQueryString("\\\\?\\c:\\a.ts")).toBe("\\\\?\\c:\\a.ts");
    });

    it("a suffix with nothing before it is not a link", () => {
        expect(paths("(339)")).toEqual([]);
        expect(paths("'':1")).toEqual([]);
    });

    it("a quote inside the path is not a prefix", () => {
        expect(paths("foo'bar:1")).toEqual([[0, "foo'bar"]]);
    });

    it("a bracket inside a quoted path gives a second candidate after it", () => {
        expect(paths('"x(a.ts", line 3')).toEqual([
            [1, "x(a.ts"],
            [3, "a.ts"],
        ]);
    });

    it("paths without a suffix are merged around the suffixed ones in order, overlapping ones dropped", () => {
        expect(paths("./x ./y:1 ./z")).toEqual([
            [0, "./x"],
            [4, "./y"],
            [10, "./z"],
        ]);
        expect(paths("./y:1 ./z ./w")).toEqual([
            [0, "./y"],
            [6, "./z"],
            [10, "./w"],
        ]);
        expect(paths("./a ./b ./y:1")).toEqual([
            [0, "./a"],
            [4, "./b"],
            [8, "./y"],
        ]);
        expect(paths("./y:1 ./v:2 ./u")).toEqual([
            [0, "./y"],
            [6, "./v"],
            [12, "./u"],
        ]);
        expect(paths("./y:1 ./m ./v:2")).toEqual([
            [0, "./y"],
            [6, "./m"],
            [10, "./v"],
        ]);
        expect(paths("./m ./y:1 ./v:2")).toEqual([
            [0, "./m"],
            [4, "./y"],
            [10, "./v"],
        ]);
        // `|` ends a suffixed path but not a plain one: `x/y|z/w.ts` would run into `z/w.ts`.
        expect(paths("x/y|z/w.ts:3")).toEqual([[4, "z/w.ts"]]);
        // `:` ends a plain path but not a suffixed one: `b/c.ts` starts inside `a:b/c.ts`.
        expect(paths("a:b/c.ts:3 ./d:4")).toEqual([
            [0, "a:b/c.ts"],
            [11, "./d"],
        ]);
    });

    it("a multi-quote prefix is cut to its last quote only when the suffix opens with that quote", () => {
        expect(detectLinks("''foo:1", OperatingSystem.Linux)[0].prefix).toEqual({ index: 0, text: "''" });
        expect(detectLinks("echo \"'foo' on line 1\"", OperatingSystem.Linux)[0].prefix).toEqual({
            index: 6,
            text: "'",
        });
    });

    it("git diff headers lose their `a/` and `b/`, other lines keep them", () => {
        expect(paths("--- a/foo/bar")).toEqual([[6, "foo/bar"]]);
        expect(paths("+++ b/foo/bar")).toEqual([[6, "foo/bar"]]);
        expect(paths("diff --git a/foo/bar b/foo/bar")).toEqual([
            [13, "foo/bar"],
            [23, "foo/bar"],
        ]);
        expect(paths("--- a/foo b/bar/x")).toEqual([
            [6, "foo"],
            [10, "b/bar/x"],
        ]);
        expect(paths("diff --git x/y")).toEqual([[11, "x/y"]]);
        expect(paths("see a/foo/x")).toEqual([[4, "a/foo/x"]]);
        expect(paths("x a/foo")).toEqual([[2, "a/foo"]]);
    });
});
