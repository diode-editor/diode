import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { parseDotGit, refsRoot, upstreamRefPath } from "./dotGit.ts";

describe("parseDotGit", () => {
    it("обычный клон: относительный `.git`, общего каталога нет", () => {
        expect(parseDotGit(".git\n.git", "/repo")).toEqual({ path: "/repo/.git", commonPath: undefined });
    });

    it("linked worktree: свой каталог и отдельный общий", () => {
        expect(
            parseDotGit("/main/.git/worktrees/feature\n/main/.git", "/main/.claude/worktrees/feature"),
        ).toEqual({ path: "/main/.git/worktrees/feature", commonPath: "/main/.git" });
    });

    it("git без --git-common-dir (до 2.5): общий каталог совпадает с обычным", () => {
        expect(parseDotGit(".git", "/repo")).toEqual({ path: "/repo/.git", commonPath: undefined });
    });

    it("пустой вывод — не репозиторий", () => {
        expect(parseDotGit("", "/repo")).toBeNull();
        expect(parseDotGit("\n\n", "/repo")).toBeNull();
    });

    it("путь нормализуется", () => {
        expect(parseDotGit("./sub/../.git", "/repo")?.path).toBe(path.normalize("/repo/.git"));
    });
});

describe("refsRoot", () => {
    it("обычный клон — сам `.git`", () => {
        expect(refsRoot({ path: "/repo/.git", commonPath: undefined })).toBe("/repo/.git");
    });

    it("worktree — общий каталог", () => {
        expect(refsRoot({ path: "/main/.git/worktrees/f", commonPath: "/main/.git" })).toBe("/main/.git");
    });
});

describe("upstreamRefPath", () => {
    const dotGit = { path: "/repo/.git", commonPath: undefined };

    it("origin/main → refs/remotes/origin/main", () => {
        expect(upstreamRefPath(dotGit, "origin/main")).toBe(path.join("/repo/.git", "refs/remotes/origin/main"));
    });

    it("ветка со слэшем в имени сохраняет вложенность", () => {
        expect(upstreamRefPath(dotGit, "origin/feature/x")).toBe(
            path.join("/repo/.git", "refs/remotes/origin/feature/x"),
        );
    });

    it("в worktree ref ищется в общем каталоге", () => {
        expect(upstreamRefPath({ path: "/main/.git/worktrees/f", commonPath: "/main/.git" }, "origin/main")).toBe(
            path.join("/main/.git", "refs/remotes/origin/main"),
        );
    });

    it("без upstream и с неполным именем следить не за чем", () => {
        expect(upstreamRefPath(dotGit, null)).toBeNull();
        expect(upstreamRefPath(dotGit, "")).toBeNull();
        expect(upstreamRefPath(dotGit, "origin")).toBeNull();
    });
});
