import { describe, expect, it } from "vitest";

import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ProgressService } from "../../../../platform/progress/common/progressService.ts";
import { SCM_CHANGES_VIEW_ID, SCM_GRAPH_VIEW_ID } from "../common/scmViews.ts";

import { ScmBusyContextContribution } from "./scmBusyContextContribution.ts";

function make(): { progress: ProgressService; contextKeys: ContextKeyService; contribution: ScmBusyContextContribution } {
    const progress = new ProgressService();
    const contextKeys = new ContextKeyService();
    const contribution = new ScmBusyContextContribution(progress, contextKeys);
    return { progress, contextKeys, contribution };
}

describe("ScmBusyContextContribution", () => {
    it("на старте ключ ложный", () => {
        const h = make();
        expect(h.contextKeys.get("gitOperationInProgress")).toBe(false);
        h.contribution.dispose();
    });

    it("операция любой секции SCM поднимает ключ и опускает по завершении", async () => {
        for (const viewId of [SCM_CHANGES_VIEW_ID, SCM_GRAPH_VIEW_ID]) {
            const h = make();
            let done!: () => void;
            const running = h.progress.withProgress({ location: "view", viewId, title: "Committing…" }, () =>
                new Promise<void>((resolve) => {
                    done = resolve;
                }),
            );

            // Ключ обязан подняться до задержки показа: команда должна погаснуть
            // мгновенно, а не через 300 мс.
            expect(h.contextKeys.get("gitOperationInProgress")).toBe(true);

            done();
            await running;
            expect(h.contextKeys.get("gitOperationInProgress")).toBe(false);
            h.contribution.dispose();
        }
    });

    it("чужая секция ключ не поднимает", () => {
        const h = make();
        void h.progress.withProgress(
            { location: "view", viewId: "workbench.view.search", title: "Searching…" },
            () => new Promise<void>(() => {}),
        );
        expect(h.contextKeys.get("gitOperationInProgress")).toBe(false);
        h.contribution.dispose();
    });

    it("после dispose ключ больше не обновляется", () => {
        const h = make();
        h.contribution.dispose();
        void h.progress.withProgress(
            { location: "view", viewId: SCM_CHANGES_VIEW_ID, title: "Committing…" },
            () => new Promise<void>(() => {}),
        );
        expect(h.contextKeys.get("gitOperationInProgress")).toBe(false);
    });
});
