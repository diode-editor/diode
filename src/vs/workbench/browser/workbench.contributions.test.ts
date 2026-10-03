import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { LifecycleServiceDIToken } from "../services/lifecycle/browser/lifecycleService.ts";
import { StatusBarServiceDIToken } from "../services/statusbar/common/statusBarService.ts";

describe("Workbench contributions", () => {
    let h: IAppHarness;

    beforeEach(() => {
        h = createAppTestHarness();
    });

    afterEach(() => {
        h.dispose();
    });

    it("фаза Ready наступает в mount(): статус-contribution'ы опубликовали сегменты", () => {
        // Terminal env + editor-status contribution'ы инстанцируются в mount()
        // (Ready), поэтому к этому моменту в статус-баре уже есть записи.
        const statusBar = h.container.get(StatusBarServiceDIToken);
        expect(h.container.get(LifecycleServiceDIToken).phase).toBe("ready");
        expect(statusBar.entries().length).toBeGreaterThan(0);
    });

    it("переход в Eventually не падает при пустой фазе", () => {
        expect(() => {
            h.container.get(LifecycleServiceDIToken).setPhase("eventually");
        }).not.toThrow();
    });
});
