import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { parseDotGit, refsRoot, upstreamRefPath } from "./dotGit.ts";

describe("parseDotGit", () => {
    it("regular clone: relative `.git`, no common dir", () => {
        expect(parseDotGit(".git\n.git", "/repo")).toEqual({ path: "/repo/.git", commonPath: undefined });
    });

    it("linked worktree: own dir and a separate common one", () => {
        expect(parseDotGit("/main/.git/worktrees/feature\n/main/.git", "/main/.claude/worktrees/feature")).toEqual({
            path: "/main/.git/worktrees/feature",
            commonPath: "/main/.git",
        });
    });

    it("git without --git-common-dir (before 2.5): common dir equals the regular one", () => {
        expect(parseDotGit(".git", "/repo")).toEqual({ path: "/repo/.git", commonPath: undefined });
    });

    it("empty output is not a repository", () => {
        expect(parseDotGit("", "/repo")).toBeNull();
        expect(parseDotGit("\n\n", "/repo")).toBeNull();
    });

    it("normalizes the path", () => {
        expect(parseDotGit("./sub/../.git", "/repo")?.path).toBe(path.normalize("/repo/.git"));
    });
});

describe("refsRoot", () => {
    it("regular clone: `.git` itself", () => {
        expect(refsRoot({ path: "/repo/.git", commonPath: undefined })).toBe("/repo/.git");
    });

    it("worktree: the common dir", () => {
        expect(refsRoot({ path: "/main/.git/worktrees/f", commonPath: "/main/.git" })).toBe("/main/.git");
    });
});

describe("upstreamRefPath", () => {
    const dotGit = { path: "/repo/.git", commonPath: undefined };

    it("origin/main → refs/remotes/origin/main", () => {
        expect(upstreamRefPath(dotGit, "origin/main")).toBe(path.join("/repo/.git", "refs/remotes/origin/main"));
    });

    it("a branch with a slash in its name keeps nesting", () => {
        expect(upstreamRefPath(dotGit, "origin/feature/x")).toBe(
            path.join("/repo/.git", "refs/remotes/origin/feature/x"),
        );
    });

    it("in a worktree the ref is looked up in the common dir", () => {
        expect(upstreamRefPath({ path: "/main/.git/worktrees/f", commonPath: "/main/.git" }, "origin/main")).toBe(
            path.join("/main/.git", "refs/remotes/origin/main"),
        );
    });

    it("nothing to watch without upstream or with an incomplete name", () => {
        expect(upstreamRefPath(dotGit, null)).toBeNull();
        expect(upstreamRefPath(dotGit, "")).toBeNull();
        expect(upstreamRefPath(dotGit, "origin")).toBeNull();
    });
});
