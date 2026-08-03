import { describe, expect, it } from "vitest";

import { fetchArgs, pullArgs, pushArgs, safeRefArg } from "./syncArgs.ts";

describe("safeRefArg", () => {
    it("отклоняет не-строки, пустое и похожее на флаг (argument injection)", () => {
        expect(safeRefArg(42)).toBeNull();
        expect(safeRefArg("")).toBeNull();
        expect(safeRefArg("  ")).toBeNull();
        expect(safeRefArg("--force")).toBeNull();
        expect(safeRefArg("-x")).toBeNull();
        expect(safeRefArg(" main ")).toBe("main");
    });
});

describe("pullArgs / pushArgs / fetchArgs", () => {
    it("pull: rebase и remote/ref; ref без remote игнорируется", () => {
        expect(pullArgs({})).toEqual(["pull"]);
        expect(pullArgs({ rebase: true })).toEqual(["pull", "--rebase"]);
        expect(pullArgs({ remote: "origin", ref: "main" })).toEqual(["pull", "origin", "main"]);
        expect(pullArgs({ remote: "origin" })).toEqual(["pull", "origin"]);
        expect(pullArgs({ ref: "main" })).toEqual(["pull"]);
        expect(pullArgs({ remote: "--evil" })).toEqual(["pull"]);
    });

    it("push: force-with-lease, follow-tags, -u, remote/ref", () => {
        expect(pushArgs({})).toEqual(["push"]);
        expect(pushArgs({ forceWithLease: true, followTags: true })).toEqual([
            "push",
            "--force-with-lease",
            "--follow-tags",
        ]);
        expect(pushArgs({ setUpstream: true, remote: "origin", ref: "main" })).toEqual([
            "push",
            "-u",
            "origin",
            "main",
        ]);
        expect(pushArgs({ remote: "origin" })).toEqual(["push", "origin"]);
    });

    it("fetch: prune/all; remote игнорируется при all", () => {
        expect(fetchArgs({})).toEqual(["fetch"]);
        expect(fetchArgs({ prune: true })).toEqual(["fetch", "--prune"]);
        expect(fetchArgs({ all: true, remote: "origin" })).toEqual(["fetch", "--all"]);
        expect(fetchArgs({ remote: "origin" })).toEqual(["fetch", "origin"]);
    });
});
