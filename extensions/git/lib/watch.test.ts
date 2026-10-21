import { describe, expect, it } from "vitest";

import { isRelevantDotGitEvent, isRelevantWorkingTreeEvent } from "./watch.ts";

describe("isRelevantDotGitEvent", () => {
    it("HEAD, index and operation state trigger a refresh", () => {
        expect(isRelevantDotGitEvent("/repo/.git/HEAD")).toBe(true);
        expect(isRelevantDotGitEvent("/repo/.git/index")).toBe(true);
        expect(isRelevantDotGitEvent("/repo/.git/MERGE_HEAD")).toBe(true);
        expect(isRelevantDotGitEvent("/repo/.git/rebase-merge")).toBe(true);
        expect(isRelevantDotGitEvent("/repo/.git/refs")).toBe(true);
        expect(isRelevantDotGitEvent("/repo/.git/packed-refs")).toBe(true);
    });

    it("ignores index.lock, or every operation causes a refresh storm", () => {
        expect(isRelevantDotGitEvent("/repo/.git/index.lock")).toBe(false);
    });

    it("ignores index.lock inside a worktree too", () => {
        expect(isRelevantDotGitEvent("/main/.git/worktrees/feature/index.lock")).toBe(false);
    });

    it("the `.git` directory itself is not a content event", () => {
        expect(isRelevantDotGitEvent("/repo/.git")).toBe(false);
    });

    it("ignores watchman cookie files", () => {
        expect(isRelevantDotGitEvent("/repo/.git/.watchman-cookie-host-1-2")).toBe(false);
    });
});

describe("isRelevantWorkingTreeEvent", () => {
    it("a file under the root is a working tree event", () => {
        expect(isRelevantWorkingTreeEvent("/repo", "/repo/src/a.ts")).toBe(true);
    });

    it("the git dir is left to its own watcher", () => {
        expect(isRelevantWorkingTreeEvent("/repo", "/repo/.git/index")).toBe(false);
        expect(isRelevantWorkingTreeEvent("/repo", "/repo/.git")).toBe(false);
        expect(isRelevantWorkingTreeEvent("/repo", "/repo/sub/.git/HEAD")).toBe(false);
    });

    it("`.gitignore` is a regular file, not the git dir", () => {
        expect(isRelevantWorkingTreeEvent("/repo", "/repo/.gitignore")).toBe(true);
    });

    it("outside the root and the root itself are not our events", () => {
        expect(isRelevantWorkingTreeEvent("/repo", "/elsewhere/a.ts")).toBe(false);
        expect(isRelevantWorkingTreeEvent("/repo", "/repo")).toBe(false);
    });
});
