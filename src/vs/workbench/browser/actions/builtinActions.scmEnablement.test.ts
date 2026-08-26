import { describe, expect, it } from "vitest";

import { builtinActions } from "./builtinActions.ts";

/** Команды, которые ходят в git на мутацию — им положен enablement занятости. */
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
];

/** Чтение — гасить незачем: открыть файл можно и во время коммита. */
const READ_ONLY = [
    "scm.action.openFile",
    "scm.action.openChanges",
    "scm.action.viewAsTree",
    "scm.action.viewAsList",
    "workbench.view.scm",
    "git.showOutput",
];

function actionById(id: string): { enablement?: string } | undefined {
    return builtinActions.find((action) => action.id === id);
}

describe("SCM-команды и enablement занятости", () => {
    it("мутирующие команды гаснут на время идущей операции", () => {
        for (const id of MUTATING) {
            const action = actionById(id);
            expect(action, `нет команды ${id}`).toBeDefined();
            expect(action!.enablement, `у ${id} нет enablement занятости`).toContain("!gitOperationInProgress");
        }
    });

    it("read-only команды SCM остаются доступными", () => {
        for (const id of READ_ONLY) {
            const action = actionById(id);
            expect(action, `нет команды ${id}`).toBeDefined();
            expect(action!.enablement ?? "").not.toContain("gitOperationInProgress");
        }
    });
});
