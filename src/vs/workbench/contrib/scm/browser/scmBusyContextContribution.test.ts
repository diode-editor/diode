import { describe, expect, it } from "vitest";

import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ProgressService } from "../../../../platform/progress/common/progressService.ts";
import { SCM_CHANGES_VIEW_ID, SCM_GRAPH_VIEW_ID } from "../common/scmViews.ts";

import { ScmBusyContextContribution } from "./scmBusyContextContribution.ts";

function make(): {
    progress: ProgressService;
    contextKeys: ContextKeyService;
    contribution: ScmBusyContextContribution;
} {
    const progress = new ProgressService();
    const contextKeys = new ContextKeyService();
    const contribution = new ScmBusyContextContribution(progress, contextKeys);
    return { progress, contextKeys, contribution };
}

describe("ScmBusyContextContribution", () => {
    it("the key is false at startup", () => {
        const h = make();
        expect(h.contextKeys.get("gitOperationInProgress")).toBe(false);
        h.contribution.dispose();
    });

    it("an operation in any SCM section raises the key and lowers it on completion", async () => {
        for (const viewId of [SCM_CHANGES_VIEW_ID, SCM_GRAPH_VIEW_ID]) {
            const h = make();
            let done!: () => void;
            const running = h.progress.withProgress(
                { location: "view", viewId, title: "Committing…" },
                () =>
                    new Promise<void>((resolve) => {
                        done = resolve;
                    }),
            );

            // The key must be raised before the show delay: the command must be disabled
            // immediately, not after 300 ms.
            expect(h.contextKeys.get("gitOperationInProgress")).toBe(true);

            done();
            await running;
            expect(h.contextKeys.get("gitOperationInProgress")).toBe(false);
            h.contribution.dispose();
        }
    });

    it("another section does not raise the key", () => {
        const h = make();
        void h.progress.withProgress(
            { location: "view", viewId: "workbench.view.search", title: "Searching…" },
            () => new Promise<void>(() => {}),
        );
        expect(h.contextKeys.get("gitOperationInProgress")).toBe(false);
        h.contribution.dispose();
    });

    it("after dispose the key is no longer updated", () => {
        const h = make();
        h.contribution.dispose();
        void h.progress.withProgress(
            { location: "view", viewId: SCM_CHANGES_VIEW_ID, title: "Committing…" },
            () => new Promise<void>(() => {}),
        );
        expect(h.contextKeys.get("gitOperationInProgress")).toBe(false);
    });
});
