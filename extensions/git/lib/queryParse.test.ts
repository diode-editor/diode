import { describe, expect, it } from "vitest";

import { parseForEachRefZ, parseStashListZ } from "./queryParse.ts";

describe("parseForEachRefZ", () => {
    it("раскладывает heads/remotes/tags в короткие имена", () => {
        const out = [
            "refs/heads/main\0abc123\0feat: latest",
            "refs/remotes/origin/main\0abc123\0feat: latest",
            "refs/remotes/origin/HEAD\0abc123\0",
            "refs/tags/v1.0\0def456\0release",
            "refs/stash\0zzz\0ignored",
            "",
        ].join("\n");
        expect(parseForEachRefZ(out)).toEqual([
            { name: "main", kind: "head", sha: "abc123", subject: "feat: latest" },
            { name: "origin/main", kind: "remote", sha: "abc123", subject: "feat: latest" },
            { name: "v1.0", kind: "tag", sha: "def456", subject: "release" },
        ]);
    });

    it("битые строки пропускаются, отсутствующий subject — пустая строка", () => {
        expect(parseForEachRefZ("refs/heads/only-name\nгарбидж")).toEqual([]);
        expect(parseForEachRefZ("refs/heads/x\0abc")).toEqual([{ name: "x", kind: "head", sha: "abc", subject: "" }]);
    });
});

describe("parseStashListZ", () => {
    it("индекс + описание; мусор мимо", () => {
        const out = ["stash@{0}\0WIP on main: abc feat", "stash@{1}\0On feature: custom message", "junk\0x", ""].join(
            "\n",
        );
        expect(parseStashListZ(out)).toEqual([
            { index: "stash@{0}", description: "WIP on main: abc feat" },
            { index: "stash@{1}", description: "On feature: custom message" },
        ]);
        expect(parseStashListZ("stash@{2}")).toEqual([{ index: "stash@{2}", description: "" }]);
    });
});
