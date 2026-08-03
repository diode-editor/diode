import { describe, expect, it } from "vitest";

import { parseBranchHeaders, parseRemotes } from "./repoState.ts";

describe("parseBranchHeaders", () => {
    it("ветка с upstream и ahead/behind", () => {
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

    it("detached HEAD и отсутствие upstream", () => {
        const out = ["# branch.oid 0123abcd", "# branch.head (detached)"].join("\n");
        expect(parseBranchHeaders(out)).toEqual({
            branch: null,
            detached: true,
            upstream: null,
            ahead: 0,
            behind: 0,
        });
    });

    it("битые заголовки (пустые значения, не тот формат ab) — игнорируются", () => {
        const out = ["# branch.head ", "# branch.upstream ", "# branch.ab plus-minus"].join("\n");
        expect(parseBranchHeaders(out)).toEqual({
            branch: null,
            detached: false,
            upstream: null,
            ahead: 0,
            behind: 0,
        });
    });

    it("пустой вывод — дефолты (unborn)", () => {
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
    it("список имён, пустые строки отбрасываются", () => {
        expect(parseRemotes("origin\nupstream\n\n")).toEqual(["origin", "upstream"]);
        expect(parseRemotes("")).toEqual([]);
    });
});
