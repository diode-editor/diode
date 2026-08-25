import { describe, expect, it } from "vitest";

import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";

import { ViewTitleActionsContribution } from "./viewTitleActionsContribution.ts";
import type { ViewsService } from "./viewsService.ts";

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
    it("пере-резолвит кнопки заголовков на смену контекста", async () => {
        const contextKeys = new ContextKeyService();
        const target = fakeViews();
        const contribution = new ViewTitleActionsContribution(contextKeys, target.views);

        contextKeys.set("hasSearchResult", true);
        await Promise.resolve();
        expect(target.refreshes()).toBe(1);

        contribution.dispose();
    });

    it("несколько записей за тик — один пересбор", async () => {
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

    it("запись того же значения пересбора не вызывает", async () => {
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

    it("после dispose подписка снята", async () => {
        const contextKeys = new ContextKeyService();
        const target = fakeViews();
        const contribution = new ViewTitleActionsContribution(contextKeys, target.views);
        contribution.dispose();

        contextKeys.set("hasSearchResult", true);
        await Promise.resolve();
        expect(target.refreshes()).toBe(0);
    });
});
