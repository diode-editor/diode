import { describe, expect, it } from "vitest";

import { globToRegExp, matchAnyGlob, matchGlob, matchRelativeGlob, splitGlobAware } from "./glob.ts";

describe("glob", () => {
    it("`*` does not cross a segment separator", () => {
        expect(matchGlob("src/*.ts", "src/main.ts")).toBe(true);
        expect(matchGlob("src/*.ts", "src/vs/main.ts")).toBe(false);
    });

    it("`**/` matches zero or more segments", () => {
        expect(matchGlob("**/settings.json", "settings.json")).toBe(true);
        expect(matchGlob("**/settings.json", "a/b/settings.json")).toBe(true);
        expect(matchGlob("**/settings.json", "a/settings.jsonc")).toBe(false);
    });

    it("`**` without a separator matches any tail", () => {
        expect(matchGlob("node_modules/**", "node_modules/pkg/index.js")).toBe(true);
        expect(matchGlob("node_modules/**", "node_modules")).toBe(false);
    });

    it("`?` is exactly one character within a segment", () => {
        expect(matchGlob("file?.ts", "file1.ts")).toBe(true);
        expect(matchGlob("file?.ts", "file12.ts")).toBe(false);
        expect(matchGlob("file?.ts", "file/.ts")).toBe(false);
    });

    it("`{a,b}` is alternation", () => {
        expect(matchGlob("**/*.{ts,js}", "src/main.ts")).toBe(true);
        expect(matchGlob("**/*.{ts,js}", "src/main.js")).toBe(true);
        expect(matchGlob("**/*.{ts,js}", "src/main.css")).toBe(false);
    });

    it("a comma outside a group is a plain character", () => {
        expect(matchGlob("a,b.ts", "a,b.ts")).toBe(true);
        expect(matchGlob("a,b.ts", "a.ts")).toBe(false);
    });

    it("dot and other regexp metacharacters are escaped", () => {
        expect(matchGlob("a.ts", "axts")).toBe(false);
        expect(matchGlob("a+b.ts", "a+b.ts")).toBe(true);
        expect(matchGlob("(x).ts", "(x).ts")).toBe(true);
        expect(matchGlob("[0-9].ts", "[0-9].ts")).toBe(true);
        expect(matchGlob("[0-9].ts", "5.ts")).toBe(false);
    });

    it("an unpaired `}` matches literally", () => {
        expect(matchGlob("a}.ts", "a}.ts")).toBe(true);
    });

    it("the pattern is anchored to the whole path", () => {
        expect(matchGlob("main.ts", "src/main.ts")).toBe(false);
    });

    it("compilation is cached per pattern", () => {
        expect(globToRegExp("**/*.ts")).toBe(globToRegExp("**/*.ts"));
    });

    it("matchAnyGlob: an empty set matches nothing", () => {
        expect(matchAnyGlob([], "a.ts")).toBe(false);
        expect(matchAnyGlob(["**/*.js", "**/*.ts"], "a.ts")).toBe(true);
    });

    it("matchRelativeGlob: the pattern matches the path relative to base", () => {
        expect(matchRelativeGlob({ base: "/home/user", pattern: "*.json" }, "/home/user/a.json")).toBe(true);
        expect(matchRelativeGlob({ base: "/home/user/", pattern: "*.json" }, "/home/user/a.json")).toBe(true);
        // `*` relative to base doesn't descend into a subdirectory, so base really is stripped.
        expect(matchRelativeGlob({ base: "/home/user", pattern: "*.json" }, "/home/user/sub/a.json")).toBe(false);
        expect(matchRelativeGlob({ base: "/home/user", pattern: "**/*.json" }, "/home/user/sub/a.json")).toBe(true);
    });

    it("matchRelativeGlob: a path outside base does not match, even with a shared name prefix", () => {
        expect(matchRelativeGlob({ base: "/home/user", pattern: "**" }, "/home/other/a.json")).toBe(false);
        expect(matchRelativeGlob({ base: "/home/user", pattern: "**" }, "/home/username/a.json")).toBe(false);
    });
});

describe("splitGlobAware", () => {
    it("splits on the separator", () => {
        expect(splitGlobAware("a,b,c", ",")).toEqual(["a", "b", "c"]);
    });

    it("does not split inside `{…}` and `[…]`", () => {
        expect(splitGlobAware("*.{ts,js},out", ",")).toEqual(["*.{ts,js}", "out"]);
        expect(splitGlobAware("[,a],b", ",")).toEqual(["[,a]", "b"]);
    });

    it("splits again after a closed group", () => {
        expect(splitGlobAware("{a,b},[c,d],e", ",")).toEqual(["{a,b}", "[c,d]", "e"]);
    });

    it("an empty string gives an empty list; an empty middle is kept, an empty tail is not", () => {
        expect(splitGlobAware("", ",")).toEqual([]);
        expect(splitGlobAware("a,,b,", ",")).toEqual(["a", "", "b"]);
    });

    it("any character can be the separator", () => {
        expect(splitGlobAware("a/{b/c}/d", "/")).toEqual(["a", "{b/c}", "d"]);
    });
});
