import { describe, expect, it } from "vitest";

import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { SCM_CHANGES_VIEW_ID, SCM_GRAPH_VIEW_ID } from "../common/scmViews.ts";

import { gitMutating, gitProgressTarget, gitProgressTitle } from "./gitProgress.ts";

describe("gitProgressTitle", () => {
    it("герундий по имени операции", () => {
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

    it("семейства операций делят подпись", () => {
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
        for (const op of ["logLoadMore", "refresh"]) expect(gitProgressTitle(op)).toBe("Loading History…");
        expect(gitProgressTitle("cherryPick")).toBe("Cherry-Picking…");
        expect(gitProgressTitle("reset")).toBe("Resetting…");
        expect(gitProgressTitle("revert")).toBe("Reverting…");
    });

    it("неизвестная операция — нейтральная подпись, а не пустая", () => {
        expect(gitProgressTitle("somethingNew")).toBe("Working…");
    });
});

describe("gitProgressTarget", () => {
    it("по умолчанию — секция CHANGES без дубля в статус-баре", () => {
        expect(gitProgressTarget("commit")).toEqual({ viewId: SCM_CHANGES_VIEW_ID, window: false });
        expect(gitProgressTarget("stage")).toEqual({ viewId: SCM_CHANGES_VIEW_ID, window: false });
    });

    it("история — секция GRAPH", () => {
        expect(gitProgressTarget("logLoadMore")).toEqual({ viewId: SCM_GRAPH_VIEW_ID, window: false });
        expect(gitProgressTarget("refresh")).toEqual({ viewId: SCM_GRAPH_VIEW_ID, window: false });
    });

    it("сетевые операции дублируются в статус-баре: их видно и из Explorer'а", () => {
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

    it("вешает ключ занятости на доступность команды", () => {
        expect(gitMutating(action()).enablement).toBe("!gitOperationInProgress");
    });

    it("своё enablement команды сохраняется и сужается", () => {
        expect(gitMutating(action({ enablement: "gitHasRemotes" })).enablement).toBe(
            "(gitHasRemotes) && (!gitOperationInProgress)",
        );
    });

    it("остальные поля не трогает — в том числе when видимости", () => {
        const original = action({ when: "gitHasRepo", shortTitle: "Commit" });
        expect(gitMutating(original)).toMatchObject({
            id: "git.commit",
            title: "Git: Commit",
            shortTitle: "Commit",
            when: "gitHasRepo",
        });
    });
});
