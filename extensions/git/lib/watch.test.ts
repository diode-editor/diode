import { describe, expect, it } from "vitest";

import { isRelevantDotGitEvent, isRelevantWorkingTreeEvent } from "./watch.ts";

describe("isRelevantDotGitEvent", () => {
    it("HEAD, index и состояние операции будят refresh", () => {
        expect(isRelevantDotGitEvent("/repo/.git/HEAD")).toBe(true);
        expect(isRelevantDotGitEvent("/repo/.git/index")).toBe(true);
        expect(isRelevantDotGitEvent("/repo/.git/MERGE_HEAD")).toBe(true);
        expect(isRelevantDotGitEvent("/repo/.git/rebase-merge")).toBe(true);
        expect(isRelevantDotGitEvent("/repo/.git/refs")).toBe(true);
        expect(isRelevantDotGitEvent("/repo/.git/packed-refs")).toBe(true);
    });

    it("index.lock игнорируется — иначе шторм рефрешей на каждой операции", () => {
        expect(isRelevantDotGitEvent("/repo/.git/index.lock")).toBe(false);
    });

    it("index.lock внутри worktree тоже игнорируется", () => {
        expect(isRelevantDotGitEvent("/main/.git/worktrees/feature/index.lock")).toBe(false);
    });

    it("сам каталог `.git` — не событие содержимого", () => {
        expect(isRelevantDotGitEvent("/repo/.git")).toBe(false);
    });

    it("cookie-файлы watchman'а игнорируются", () => {
        expect(isRelevantDotGitEvent("/repo/.git/.watchman-cookie-host-1-2")).toBe(false);
    });
});

describe("isRelevantWorkingTreeEvent", () => {
    it("файл под корнем — событие рабочего дерева", () => {
        expect(isRelevantWorkingTreeEvent("/repo", "/repo/src/a.ts")).toBe(true);
    });

    it("служебный каталог отдаётся своему watcher'у", () => {
        expect(isRelevantWorkingTreeEvent("/repo", "/repo/.git/index")).toBe(false);
        expect(isRelevantWorkingTreeEvent("/repo", "/repo/.git")).toBe(false);
        expect(isRelevantWorkingTreeEvent("/repo", "/repo/sub/.git/HEAD")).toBe(false);
    });

    it("`.gitignore` — обычный файл, а не служебный каталог", () => {
        expect(isRelevantWorkingTreeEvent("/repo", "/repo/.gitignore")).toBe(true);
    });

    it("вне корня и сам корень — не наше событие", () => {
        expect(isRelevantWorkingTreeEvent("/repo", "/elsewhere/a.ts")).toBe(false);
        expect(isRelevantWorkingTreeEvent("/repo", "/repo")).toBe(false);
    });
});
