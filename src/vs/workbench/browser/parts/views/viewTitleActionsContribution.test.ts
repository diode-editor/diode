import { describe, expect, it } from "vitest";

import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";

import type { ViewsService } from "./viewsService.ts";
import { ViewTitleActionsContribution } from "./viewTitleActionsContribution.ts";

function fakeViews(): { views: ViewsService; refreshes: () => number } {
    const state = { count: 0 };
    const views = {
        refreshTitleActions: () => {
            state.count++;
        },
    } as unknown as ViewsService;
    return { views, refreshes: () => state.count };
}

describe("ViewTitleActionsContribution", () => {
    it("re-resolves title buttons on a context change", async () => {
        const contextKeys = new ContextKeyService();
        const target = fakeViews();
        const contribution = new ViewTitleActionsContribution(contextKeys, target.views);

        contextKeys.set("hasSearchResult", true);
        await Promise.resolve();
        expect(target.refreshes()).toBe(1);

        contribution.dispose();
    });

    it("several writes in one tick cause one rebuild", async () => {
        const contextKeys = new ContextKeyService();
        const target = fakeViews();
        const contribution = new ViewTitleActionsContribution(contextKeys, target.views);

        contextKeys.set("hasSearchResult", true);
        contextKeys.set("viewHasSomeCollapsibleResult", true);
        contextKeys.set("gitHasRepo", true);
        await Promise.resolve();
        expect(target.refreshes()).toBe(1);

        contribution.dispose();
    });

    it("writing the same value does not cause a rebuild", async () => {
        const contextKeys = new ContextKeyService();
        contextKeys.set("hasSearchResult", true);
        await Promise.resolve();

        const target = fakeViews();
        const contribution = new ViewTitleActionsContribution(contextKeys, target.views);
        contextKeys.set("hasSearchResult", true);
        await Promise.resolve();
        expect(target.refreshes()).toBe(0);

        contribution.dispose();
    });

    it("after dispose the subscription is removed", async () => {
        const contextKeys = new ContextKeyService();
        const target = fakeViews();
        const contribution = new ViewTitleActionsContribution(contextKeys, target.views);
        contribution.dispose();

        contextKeys.set("hasSearchResult", true);
        await Promise.resolve();
        expect(target.refreshes()).toBe(0);
    });
});
