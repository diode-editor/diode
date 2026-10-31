import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";

import { QuickInputComponent } from "./quickInputComponent.ts";
import { QuickInputService } from "./quickInputService.ts";

function createService(): { service: QuickInputService; component: QuickInputComponent; testApp: TestApp } {
    const component = new QuickInputComponent();
    const service = new QuickInputService(component);
    const body = new BodyElement();
    const testApp = TestApp.create(body, new Size(80, 24));
    component.attachHost(body);
    return { service, component, testApp };
}

const FRUITS: QuickPickItem[] = [{ label: "alpha" }, { label: "beta" }, { label: "gamma" }];

function labels(items: readonly QuickPickItem[] | undefined): string[] | undefined {
    return items?.map((item) => item.label);
}

describe("QuickInputService.quickPickMany", () => {
    it("Space checks the row under the cursor, Enter returns the checked items", async () => {
        const { service, testApp } = createService();
        const result = service.quickPickMany({ items: FRUITS });
        testApp.sendKey(" ");
        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");
        testApp.sendKey(" ");
        testApp.sendKey("Enter");
        expect(labels(await result)).toEqual(["alpha", "gamma"]);
    });

    it("the result follows the original list order, not the check order", async () => {
        const { service, testApp } = createService();
        const result = service.quickPickMany({ items: FRUITS });
        // Check bottom-up: gamma first, then alpha.
        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");
        testApp.sendKey(" ");
        testApp.sendKey("ArrowUp");
        testApp.sendKey("ArrowUp");
        testApp.sendKey(" ");
        testApp.sendKey("Enter");
        expect(labels(await result)).toEqual(["alpha", "gamma"]);
    });

    it("a second Space unchecks", async () => {
        const { service, testApp } = createService();
        const result = service.quickPickMany({ items: FRUITS });
        testApp.sendKey(" ");
        testApp.sendKey(" ");
        testApp.sendKey("Enter");
        expect(labels(await result)).toEqual([]);
    });

    it("an empty set is an empty result, not a cancel", async () => {
        const { service, testApp } = createService();
        const result = service.quickPickMany({ items: FRUITS });
        testApp.sendKey("Enter");
        const picked = await result;
        expect(picked).not.toBeUndefined();
        expect(labels(picked)).toEqual([]);
    });

    it("Escape is a cancel (undefined), not an empty set", async () => {
        const { service, testApp } = createService();
        const result = service.quickPickMany({ items: FRUITS });
        testApp.sendKey(" ");
        testApp.sendKey("Escape");
        await expect(result).resolves.toBeUndefined();
    });

    it("pre-checked items end up in the result without a single keypress", async () => {
        const { service, testApp } = createService();
        const result = service.quickPickMany({ items: FRUITS, picked: [FRUITS[1]] });
        testApp.sendKey("Enter");
        expect(labels(await result)).toEqual(["beta"]);
    });

    it("checks survive filtering: items checked outside the current filter are not lost", async () => {
        const { service, testApp } = createService();
        const result = service.quickPickMany({ items: FRUITS });
        testApp.sendKey(" "); // alpha
        testApp.sendKey("g");
        testApp.sendKey("a"); // filter "ga" leaves only gamma
        testApp.sendKey(" "); // gamma
        testApp.sendKey("Enter");
        expect(labels(await result)).toEqual(["alpha", "gamma"]);
    });

    it("Enter on an empty list returns an empty set instead of hanging", async () => {
        const { service, testApp } = createService();
        const result = service.quickPickMany({ items: [] });
        testApp.sendKey("Enter");
        expect(labels(await result)).toEqual([]);
    });

    it("checks from the previous show do not leak into the next one", async () => {
        const { service, testApp } = createService();
        const first = service.quickPickMany({ items: FRUITS });
        testApp.sendKey(" ");
        testApp.sendKey("Enter");
        expect(labels(await first)).toEqual(["alpha"]);

        const second = service.quickPickMany({ items: FRUITS });
        testApp.sendKey("Enter");
        expect(labels(await second)).toEqual([]);
    });

    it("a single quickPick after a multi-select shows no checkboxes and accepts a row", async () => {
        const { service, component, testApp } = createService();
        const many = service.quickPickMany({ items: FRUITS });
        testApp.sendKey(" ");
        testApp.sendKey("Escape");
        await many;

        const single = service.quickPick({ items: FRUITS });
        expect(component.view.canPickMany).toBe(false);
        expect(component.view.inspectState().checked).toBeUndefined();
        testApp.sendKey("Enter");
        expect((await single)?.label).toBe("alpha");
    });

    it("an InputBox after a multi-select stays a single-line input", async () => {
        const { service, component, testApp } = createService();
        const many = service.quickPickMany({ items: FRUITS });
        testApp.sendKey(" ");
        testApp.sendKey("Escape");
        await many;

        const value = service.input({});
        expect(component.view.canPickMany).toBe(false);
        // In an input box Space is a plain character, not a check toggle.
        testApp.sendKey("a");
        testApp.sendKey(" ");
        testApp.sendKey("b");
        testApp.sendKey("Enter");
        await expect(value).resolves.toBe("a b");
    });

    it("a new show cancels the previous multi-select", async () => {
        const { service } = createService();
        const first = service.quickPickMany({ items: FRUITS });
        void service.quickPick({ items: FRUITS });
        await expect(first).resolves.toBeUndefined();
    });

    it("a multi-select cancels the pending input of the previous owner", async () => {
        const { service } = createService();
        const pending = service.input({ title: "Save As" });
        void service.quickPickMany({ items: FRUITS });
        await expect(pending).resolves.toBeUndefined();
    });

    it("a multi-select closes another open widget session", () => {
        const { service, component } = createService();
        let closed = 0;
        component.show();
        component.onDidClose = () => closed++;
        void service.quickPickMany({ items: FRUITS });
        expect(closed).toBe(1);
    });

    it("cancel() resolves a pending show to undefined", async () => {
        const { service } = createService();
        const pending = service.quickPickMany({ items: FRUITS });
        service.cancel();
        await expect(pending).resolves.toBeUndefined();
    });

    it("cancel() without an open show is a no-op", () => {
        const { service, component } = createService();
        expect(() => {
            service.cancel();
        }).not.toThrow();
        expect(component.isOpen()).toBe(false);
    });
});
