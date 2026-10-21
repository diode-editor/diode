import { describe, expect, it } from "vitest";

import { parseBranchHeaders, parseRemotes } from "./repoState.ts";

describe("parseBranchHeaders", () => {
    it("branch with upstream and ahead/behind", () => {
        const out = [
            "# branch.oid 0123abcd",
            "# branch.head main",
            "# branch.upstream origin/main",
            "# branch.ab +2 -1",
            "1 .M N... 100644 100644 100644 abc def file.ts",
        ].join("\n");
        expect(parseBranchHeaders(out)).toEqual({
            branch: "main",
            detached: false,
            upstream: "origin/main",
            ahead: 2,
            behind: 1,
        });
    });

    it("detached HEAD and no upstream", () => {
        const out = ["# branch.oid 0123abcd", "# branch.head (detached)"].join("\n");
        expect(parseBranchHeaders(out)).toEqual({
            branch: null,
            detached: true,
            upstream: null,
            ahead: 0,
            behind: 0,
        });
    });

    it("ignores broken headers (empty values, wrong ab format)", () => {
        const out = ["# branch.head ", "# branch.upstream ", "# branch.ab plus-minus"].join("\n");
        expect(parseBranchHeaders(out)).toEqual({
            branch: null,
            detached: false,
            upstream: null,
            ahead: 0,
            behind: 0,
        });
    });

    it("empty output gives defaults (unborn)", () => {
        expect(parseBranchHeaders("")).toEqual({
            branch: null,
            detached: false,
            upstream: null,
            ahead: 0,
            behind: 0,
        });
    });
});

describe("parseRemotes", () => {
    it("list of names, empty lines dropped", () => {
        expect(parseRemotes("origin\nupstream\n\n")).toEqual(["origin", "upstream"]);
        expect(parseRemotes("")).toEqual([]);
    });
});
