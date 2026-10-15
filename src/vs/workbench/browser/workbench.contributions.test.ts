import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { isSubmenuContribution } from "../../platform/actions/common/iMenuContribution.ts";
import { MenuId } from "../../platform/actions/common/menuId.ts";
import { MenuServiceDIToken } from "../../platform/actions/common/menuService.ts";
import { SwitchOutputMenu } from "../contrib/output/browser/outputChannelActions.ts";
import { LifecycleServiceDIToken } from "../services/lifecycle/browser/lifecycleService.ts";
import { OUTPUT_VIEW_ID } from "../services/output/common/output.ts";
import { StatusBarServiceDIToken } from "../services/statusbar/common/statusBarService.ts";

describe("Workbench contributions", () => {
    let h: IAppHarness;

    beforeEach(() => {
        h = createAppTestHarness({ phase: "ready" });
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

    // Эталон держит каналы Output на `LifecyclePhase.Restored` и инстанцирует
    // их по idle: на Ready их ещё нет, они приходят первыми в переходе в
    // Eventually (у приложения — после кадра с подсветкой).
    it("afterRestored: на Ready селектора каналов Output ещё нет, с Eventually — есть", () => {
        const menus = h.container.get(MenuServiceDIToken);
        const hasSwitchOutput = (): boolean =>
            menus.hasItems(
                MenuId.ViewTitle,
                { view: OUTPUT_VIEW_ID },
                (item) => isSubmenuContribution(item) && item.submenu === SwitchOutputMenu,
            );
        expect(hasSwitchOutput()).toBe(false);

        h.container.get(LifecycleServiceDIToken).setPhase("eventually");
        expect(hasSwitchOutput()).toBe(true);
    });
});
