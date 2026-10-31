import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";

import { QuickInputComponent } from "./quickInputComponent.ts";
import { QuickInputService } from "./quickInputService.ts";
import type { QuickPickSessionItem } from "./quickPickSession.ts";

function createService() {
    const component = new QuickInputComponent();
    const service = new QuickInputService(component);
    const body = new BodyElement();
    const testApp = TestApp.create(body, new Size(80, 24));
    component.attachHost(body);
    return { service, component, testApp };
}

const FRUITS: QuickPickItem[] = [{ label: "alpha" }, { label: "beta" }, { label: "gamma" }];

describe("quick input commands on every flavor", () => {
    it("with nothing open they do nothing and do not fail", () => {
        const { service, component } = createService();
        service.acceptOpen();
        service.closeOpen();
        service.navigateOpen(true);
        service.toggleOpen();
        service.focusOpen();
        expect(component.isOpen()).toBe(false);
    });

    it("after a show has closed they do not reach the widget it left behind", () => {
        const { service, component } = createService();
        const log: string[] = [];
        const pick = service.createQuickPick<QuickPickSessionItem>({
            onDidChangeValue: () => undefined,
            onDidAccept: () => log.push("accept"),
            onDidChangeActive: () => log.push("active"),
            onDidChangeSelection: () => log.push("selection"),
            onDidHide: () => undefined,
        });
        pick.update({ items: FRUITS, canSelectMany: true });
        pick.show();
        service.navigateOpen(true);
        pick.hide();
        log.length = 0;

        service.navigateOpen(true);
        service.toggleOpen();
        service.acceptOpen();

        expect(component.view.selectedIndex).toBe(0);
        expect(component.view.checkedItems.size).toBe(0);
        expect(log).toEqual([]);
    });

    it("an input box: accept returns the text, close returns undefined", async () => {
        const { service, component } = createService();
        const accepted = service.input({ value: "farboo" });
        service.acceptOpen();
        await expect(accepted).resolves.toBe("farboo");

        const closed = service.input({ value: "farboo" });
        service.closeOpen();
        await expect(closed).resolves.toBeUndefined();
        expect(component.isOpen()).toBe(false);
    });

    it("an input box: accept is blocked by a failing validator, close still works", async () => {
        const { service } = createService();
        const pending = service.input({ validateInput: (value) => (value === "" ? "required" : null) });
        service.acceptOpen();
        await Promise.resolve();
        service.closeOpen();
        await expect(pending).resolves.toBeUndefined();
    });

    it("a list: navigate moves the highlight on the screen, accept takes that row", async () => {
        const { service, component } = createService();
        const pending = service.quickPick({ items: FRUITS });
        service.navigateOpen(true);
        expect(component.view.inspectState()).toMatchObject({ activeIndex: 1 });
        service.navigateOpen(true);
        service.navigateOpen(false);
        service.acceptOpen();
        await expect(pending).resolves.toBe(FRUITS[1]);
    });

    it("a multi-select opens with no active row: the first step lands on the first row, toggle checks it", async () => {
        const { service, component } = createService();
        const active: (string | undefined)[] = [];
        const pending = service.quickPickMany({
            items: FRUITS,
            onDidChangeActive: (item) => {
                active.push(item?.label);
            },
        });
        expect(component.view.selectedIndex).toBe(-1);
        service.toggleOpen();
        expect(component.view.checkedItems.size).toBe(0);
        service.navigateOpen(true);
        service.toggleOpen();
        service.navigateOpen(true);
        service.toggleOpen();
        service.acceptOpen();
        await expect(pending).resolves.toEqual([FRUITS[0], FRUITS[1]]);
        expect(active).toEqual(["alpha", "beta"]);
    });

    it("Space on a freshly opened multi-select still checks the first row", async () => {
        const { service, testApp } = createService();
        const pending = service.quickPickMany({ items: FRUITS });
        testApp.sendKey(" ");
        testApp.sendKey("Enter");
        await expect(pending).resolves.toEqual([FRUITS[0]]);
    });

    it("toggle does nothing outside a multi-select", async () => {
        const { service, component } = createService();
        const pending = service.quickPick({ items: FRUITS });
        service.toggleOpen();
        expect(component.view.checkedItems.size).toBe(0);
        service.closeOpen();
        await expect(pending).resolves.toBeUndefined();
    });

    it("a createQuickPick session: close hides it and tells the owner", () => {
        const { service, component } = createService();
        const log: string[] = [];
        const pick = service.createQuickPick<QuickPickSessionItem>({
            onDidChangeValue: () => undefined,
            onDidAccept: () => log.push("accept"),
            onDidChangeActive: () => undefined,
            onDidChangeSelection: (items) => log.push(`selection ${items.map((i) => i.label).join()}`),
            onDidHide: () => log.push("hide"),
        });
        pick.update({ items: FRUITS });
        pick.show();
        service.navigateOpen(true);
        service.acceptOpen();
        expect(component.isOpen()).toBe(true);
        service.closeOpen();
        expect(component.isOpen()).toBe(false);
        expect(log).toEqual(["selection beta", "accept", "hide"]);
    });

    it("focus returns the keyboard to the query line", async () => {
        const { service, component } = createService();
        const pending = service.input();
        const focus = vi.spyOn(component.view, "focus");
        service.focusOpen();
        expect(focus).toHaveBeenCalledOnce();
        service.closeOpen();
        service.focusOpen();
        expect(focus).toHaveBeenCalledOnce();
        await pending;
    });
});

describe("late items of a quick pick", () => {
    it("the picker is open and cancellable before they arrive", async () => {
        const { service, component } = createService();
        const pending = service.quickPick({ items: [], lateItems: new Promise(() => undefined) });
        expect(component.isOpen()).toBe(true);
        service.acceptOpen();
        expect(component.isOpen()).toBe(true);
        service.closeOpen();
        await expect(pending).resolves.toBeUndefined();
    });

    it("they fill the list, honoring what was already typed", async () => {
        const { service, component, testApp } = createService();
        let arrive!: (items: { items: readonly QuickPickItem[] }) => void;
        const pending = service.quickPick({
            items: [],
            lateItems: new Promise((resolve) => {
                arrive = resolve;
            }),
        });
        testApp.sendKey("g");
        arrive({ items: FRUITS });
        await Promise.resolve();
        await Promise.resolve();
        expect(component.view.inspectState()).toMatchObject({ items: ["gamma"] });
        service.acceptOpen();
        await expect(pending).resolves.toBe(FRUITS[2]);
    });

    it("a multi-select's preselection comes with them", async () => {
        const { service, component } = createService();
        const pending = service.quickPickMany({
            items: [],
            lateItems: Promise.resolve({ items: FRUITS, picked: [FRUITS[1]] }),
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(component.view.inspectState()).toMatchObject({ checked: ["beta"] });
        service.acceptOpen();
        await expect(pending).resolves.toEqual([FRUITS[1]]);
    });

    it("items arriving after the show ended leave the next one's checks alone", async () => {
        const { service, component } = createService();
        let arrive!: (items: { items: readonly QuickPickItem[]; picked: readonly QuickPickItem[] }) => void;
        const first = service.quickPickMany({
            items: [],
            lateItems: new Promise((resolve) => {
                arrive = resolve;
            }),
        });
        const own = { label: "own" };
        const second = service.quickPickMany({ items: [own], picked: [own] });
        await expect(first).resolves.toBeUndefined();
        arrive({ items: FRUITS, picked: [] });
        await Promise.resolve();
        await Promise.resolve();
        expect(component.view.inspectState()).toMatchObject({ checked: ["own"] });
        service.closeOpen();
        await second;
    });

    it("items arriving after the show ended do not touch the next one", async () => {
        const { service, component } = createService();
        let arrive!: (items: { items: readonly QuickPickItem[] }) => void;
        const first = service.quickPick({
            items: [],
            lateItems: new Promise((resolve) => {
                arrive = resolve;
            }),
        });
        const second = service.quickPick({ items: [{ label: "own" }] });
        await expect(first).resolves.toBeUndefined();
        arrive({ items: FRUITS });
        await Promise.resolve();
        await Promise.resolve();
        expect(component.view.inspectState()).toMatchObject({ items: ["own"] });
        service.closeOpen();
        await second;
    });
});
