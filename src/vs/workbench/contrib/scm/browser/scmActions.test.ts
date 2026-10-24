import { describe, expect, it } from "vitest";

import { SCM_ACTIONS } from "./scmActions.ts";

/** Commands that mutate via git — they get the busy enablement. */
const MUTATING = [
    "git.stage",
    "git.unstage",
    "git.clean",
    "git.stageAll",
    "git.unstageAll",
    "git.cleanAll",
    "git.commit",
    "git.commitAmend",
    "git.undoCommit",
    "git.pull",
    "git.push",
    "git.sync",
    "git.fetch",
    "git.publish",
    "git.checkout",
    "git.branch",
    "git.merge",
    "git.stash",
    "git.stashPop",
    "scm.graph.refresh",
    "git.refresh",
];

/** Reads need no disabling: a file can be opened even during a commit. */
const READ_ONLY = [
    "scm.action.openFile",
    "scm.action.openChanges",
    "scm.action.viewAsTree",
    "scm.action.viewAsList",
    "workbench.view.scm",
    "git.showOutput",
];

function actionById(id: string): { enablement?: string } | undefined {
    return SCM_ACTIONS.find((action) => action.id === id);
}

describe("SCM commands and busy enablement", () => {
    it("mutating commands are disabled while an operation is running", () => {
        for (const id of MUTATING) {
            const action = actionById(id);
            expect(action, `no command ${id}`).toBeDefined();
            expect(action!.enablement, `${id} has no busy enablement`).toContain("!gitOperationInProgress");
        }
    });

    it("read-only SCM commands stay available", () => {
        for (const id of READ_ONLY) {
            const action = actionById(id);
            expect(action, `no command ${id}`).toBeDefined();
            expect(action!.enablement ?? "").not.toContain("gitOperationInProgress");
        }
    });
});
