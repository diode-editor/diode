import { describe, expect, it } from "vitest";

import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { SCM_CHANGES_VIEW_ID, SCM_GRAPH_VIEW_ID } from "../common/scmViews.ts";

import { gitMutating, gitProgressTarget, gitProgressTitle } from "./gitProgress.ts";

describe("gitProgressTitle", () => {
    it("gerund by operation name", () => {
        expect(gitProgressTitle("commit")).toBe("Committing…");
        expect(gitProgressTitle("undoCommit")).toBe("Undoing Commit…");
        expect(gitProgressTitle("stage")).toBe("Staging…");
        expect(gitProgressTitle("unstage")).toBe("Unstaging…");
        expect(gitProgressTitle("clean")).toBe("Discarding…");
        expect(gitProgressTitle("pull")).toBe("Pulling…");
        expect(gitProgressTitle("push")).toBe("Pushing…");
        expect(gitProgressTitle("pushDelete")).toBe("Pushing…");
        expect(gitProgressTitle("fetch")).toBe("Fetching…");
        expect(gitProgressTitle("sync")).toBe("Syncing Changes…");
        expect(gitProgressTitle("checkout")).toBe("Checking Out…");
    });

    it("operation families share a label", () => {
        for (const op of ["branchCreate", "branchDelete", "branchRename"]) {
            expect(gitProgressTitle(op)).toBe("Updating Branch…");
        }
        for (const op of ["merge", "mergeAbort"]) expect(gitProgressTitle(op)).toBe("Merging…");
        for (const op of ["rebase", "rebaseAbort"]) expect(gitProgressTitle(op)).toBe("Rebasing…");
        for (const op of ["stashPush", "stashPop", "stashApply", "stashDrop", "stashClear"]) {
            expect(gitProgressTitle(op)).toBe("Stashing…");
        }
        for (const op of ["remoteAdd", "remoteRemove"]) expect(gitProgressTitle(op)).toBe("Updating Remotes…");
        for (const op of ["tagCreate", "tagDelete"]) expect(gitProgressTitle(op)).toBe("Updating Tags…");
        expect(gitProgressTitle("logLoadMore")).toBe("Loading History…");
        expect(gitProgressTitle("refresh")).toBe("Refreshing…");
        expect(gitProgressTitle("cherryPick")).toBe("Cherry-Picking…");
        expect(gitProgressTitle("reset")).toBe("Resetting…");
        expect(gitProgressTitle("revert")).toBe("Reverting…");
    });

    it("an unknown operation gets a neutral label, not an empty one", () => {
        expect(gitProgressTitle("somethingNew")).toBe("Working…");
    });
});

describe("gitProgressTarget", () => {
    it("by default: the CHANGES section, not duplicated in the status bar", () => {
        expect(gitProgressTarget("commit")).toEqual({ viewId: SCM_CHANGES_VIEW_ID, window: false });
        expect(gitProgressTarget("stage")).toEqual({ viewId: SCM_CHANGES_VIEW_ID, window: false });
    });

    it("history: the GRAPH section", () => {
        expect(gitProgressTarget("logLoadMore")).toEqual({ viewId: SCM_GRAPH_VIEW_ID, window: false });
    });

    it("refresh goes to CHANGES unless the caller names its own section", () => {
        expect(gitProgressTarget("refresh")).toEqual({ viewId: SCM_CHANGES_VIEW_ID, window: false });
        expect(gitProgressTarget("refresh", SCM_GRAPH_VIEW_ID)).toEqual({ viewId: SCM_GRAPH_VIEW_ID, window: false });
        expect(gitProgressTarget("pull", SCM_GRAPH_VIEW_ID)).toEqual({ viewId: SCM_GRAPH_VIEW_ID, window: true });
    });

    it("network operations are duplicated in the status bar so they are visible from the Explorer too", () => {
        for (const op of ["pull", "push", "fetch", "sync"]) {
            expect(gitProgressTarget(op)).toEqual({ viewId: SCM_CHANGES_VIEW_ID, window: true });
        }
    });
});

describe("gitMutating", () => {
    const action = (overrides: Partial<CommandAction> = {}): CommandAction => ({
        id: "git.commit",
        title: "Git: Commit",
        run: () => undefined,
        ...overrides,
    });

    it("adds the busy key to the command's enablement", () => {
        expect(gitMutating(action()).enablement).toBe("!gitOperationInProgress");
    });

    it("the command's own enablement is kept and narrowed", () => {
        expect(gitMutating(action({ enablement: "gitHasRemotes" })).enablement).toBe(
            "(gitHasRemotes) && (!gitOperationInProgress)",
        );
    });

    it("leaves the other fields alone, including the visibility when clause", () => {
        const original = action({ when: "gitHasRepo", shortTitle: "Commit" });
        expect(gitMutating(original)).toMatchObject({
            id: "git.commit",
            title: "Git: Commit",
            shortTitle: "Commit",
            when: "gitHasRepo",
        });
    });
});
