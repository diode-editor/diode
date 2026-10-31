import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";

import { QuickInputComponent } from "./quickInputComponent.ts";
import { QuickInputService } from "./quickInputService.ts";

function createService() {
    const component = new QuickInputComponent();
    const service = new QuickInputService(component);
    const body = new BodyElement();
    const testApp = TestApp.create(body, new Size(80, 24));
    component.attachHost(body);
    return { service, testApp };
}

const FRUITS: QuickPickItem[] = [{ label: "alpha" }, { label: "beta" }, { label: "gamma" }];

// Upstream: `list.shouldLoop = !canSelectMany` (quickInput.ts), `quickInputList.focus(Next|Previous)` honors it.
describe("quickOpenSelectNext/Previous wrap around a single-select, as upstream", () => {
    it("next from the last row lands on the first", async () => {
        const { service } = createService();
        const pending = service.quickPick({ items: FRUITS });
        service.navigateOpen(true);
        service.navigateOpen(true);
        service.navigateOpen(true);
        service.acceptOpen();
        await expect(pending).resolves.toBe(FRUITS[0]);
    });

    it("previous from the first row lands on the last", async () => {
        const { service } = createService();
        const pending = service.quickPick({ items: FRUITS });
        service.navigateOpen(false);
        service.acceptOpen();
        await expect(pending).resolves.toBe(FRUITS[2]);
    });
});

// Upstream: `focusPrevious` with no focus starts from index 0 (listWidget.ts), and a multi-select does not loop.
describe("the first step up in a freshly opened multi-select lands on the first row, as upstream", () => {
    it("by the command", async () => {
        const { service } = createService();
        const pending = service.quickPickMany({ items: FRUITS });
        service.navigateOpen(false);
        service.toggleOpen();
        service.acceptOpen();
        await expect(pending).resolves.toEqual([FRUITS[0]]);
    });

    it("by ArrowUp", async () => {
        const { service, testApp } = createService();
        const pending = service.quickPickMany({ items: FRUITS });
        testApp.sendKey("ArrowUp");
        service.toggleOpen();
        service.acceptOpen();
        await expect(pending).resolves.toEqual([FRUITS[0]]);
    });
});
