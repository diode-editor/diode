import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";

import { QuickInputComponent } from "./quickInputComponent.ts";
import { QuickInputService } from "./quickInputService.ts";
import type { QuickPickSessionItem } from "./quickPickSession.ts";

type Logged = ["value", string] | ["accept"] | ["active", string[]] | ["selection", string[]] | ["hide"];

function setup() {
    const component = new QuickInputComponent();
    const service = new QuickInputService(component);
    const body = new BodyElement();
    const testApp = TestApp.create(body, new Size(80, 24));
    component.attachHost(body);
    const log: Logged[] = [];
    const labels = (items: readonly QuickPickSessionItem[]): string[] => items.map((item) => item.label);
    const pick = service.createQuickPick<QuickPickSessionItem>({
        onDidChangeValue: (value) => log.push(["value", value]),
        onDidAccept: () => log.push(["accept"]),
        onDidChangeActive: (items) => log.push(["active", labels(items)]),
        onDidChangeSelection: (items) => log.push(["selection", labels(items)]),
        onDidHide: () => log.push(["hide"]),
    });
    const view = (): Record<string, unknown> => component.view.inspectState();
    const type = (text: string): void => {
        for (const ch of text) testApp.sendKey(ch);
    };
    return { service, component, testApp, pick, log, view, type };
}

const FRUITS: QuickPickSessionItem[] = [
    { label: "apple", description: "red" },
    { label: "banana", detail: "long yellow" },
    { label: "cherry" },
];

describe("QuickPickSession — show and live state", () => {
    it("a hidden picker accumulates state and shows it on show()", () => {
        const { pick, component, view } = setup();
        pick.update({ title: "Fruit", placeholder: "pick one", items: FRUITS });
        expect(component.isOpen()).toBe(false);

        expect(pick.visible).toBe(false);
        pick.show();

        expect(component.isOpen()).toBe(true);
        expect(pick.visible).toBe(true);
        expect(view()).toMatchObject({ title: "Fruit", items: ["apple", "banana", "cherry"], activeIndex: 0 });
        expect(component.view.placeholder).toBe("pick one");
    });

    it("items sent AFTER show appear in the open picker", () => {
        // Exactly the golang.go pickLazyEnum scenario: show() with an empty list,
        // items arrive later in the language server's response.
        const { pick, view, log } = setup();
        pick.show();
        expect(view()).toMatchObject({ items: [] });

        pick.update({ items: FRUITS });

        expect(view()).toMatchObject({ items: ["apple", "banana", "cherry"] });
        expect(log).toContainEqual(["active", ["apple"]]);
    });

    it("title with steps matches upstream getTitle", () => {
        const { pick, view } = setup();
        pick.update({ title: "Wizard", step: 2, totalSteps: 3 });
        pick.show();
        expect(view()).toMatchObject({ title: "Wizard (2/3)" });

        pick.update({ totalSteps: undefined });
        expect(view()).toMatchObject({ title: "Wizard (2)" });

        pick.update({ title: undefined, totalSteps: 3 });
        expect(view()).toMatchObject({ title: "2/3" });
    });
});

describe("QuickPickSession — input", () => {
    it("typing filters by label and reports the value and the active item", () => {
        const { pick, view, log, type } = setup();
        pick.update({ items: FRUITS });
        pick.show();
        log.length = 0;

        type("ch");

        expect(view()).toMatchObject({ query: "ch", items: ["cherry"] });
        // "c" leaves only cherry, so the active item changes; "ch" doesn't move it.
        expect(log).toEqual([
            ["value", "c"],
            ["active", ["cherry"]],
            ["value", "ch"],
        ]);
    });

    it("matchOnDescription / matchOnDetail widen the search, alwaysShow is never hidden", () => {
        const { pick, view, type } = setup();
        pick.update({ items: [...FRUITS, { label: "other", alwaysShow: true }] });
        pick.show();
        type("yel");
        expect(view()).toMatchObject({ items: ["other"] });

        pick.update({ matchOnDetail: true });
        expect(view()).toMatchObject({ items: ["banana", "other"] });

        pick.update({ value: "red", matchOnDescription: true });
        expect(view()).toMatchObject({ items: ["apple", "other"] });
    });

    it("a programmatic value changes the query and also fires onDidChangeValue", () => {
        const { pick, view, log } = setup();
        pick.update({ items: FRUITS });
        pick.show();
        log.length = 0;

        pick.update({ value: "ban" });

        expect(view()).toMatchObject({ query: "ban", items: ["banana"] });
        expect(log).toEqual([
            ["value", "ban"],
            ["active", ["banana"]],
        ]);
    });

    it("Enter selects the active item and reports accept, but does NOT close", () => {
        const { pick, component, testApp, log } = setup();
        pick.update({ items: FRUITS });
        pick.show();
        testApp.sendKey("ArrowDown");
        log.length = 0;

        testApp.sendKey("Enter");

        expect(log).toEqual([["selection", ["banana"]], ["accept"]]);
        expect(component.isOpen()).toBe(true);
        expect(pick.getState().selectedItems.map((item) => item.label)).toEqual(["banana"]);
    });

    it("Enter on an empty list accepts without a selection (the typed text)", () => {
        const { pick, testApp, log, type } = setup();
        pick.show();
        type("x");
        log.length = 0;

        testApp.sendKey("Enter");

        expect(log).toEqual([["accept"]]);
    });

    it("an arrow key fires onDidChangeActive, programmatic activeItems stays silent", () => {
        const { pick, view, testApp, log } = setup();
        pick.update({ items: FRUITS });
        pick.show();
        log.length = 0;

        testApp.sendKey("ArrowDown");
        expect(log).toEqual([["active", ["banana"]]]);

        log.length = 0;
        pick.update({ activeItems: [FRUITS[2]] });
        expect(view()).toMatchObject({ activeIndex: 2 });
        expect(log).toEqual([]);
    });

    it("keepScrollPosition: new items do not move the active item to the top", () => {
        const { pick, view, testApp } = setup();
        pick.update({ items: FRUITS, keepScrollPosition: true });
        pick.show();
        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");

        pick.update({ items: [...FRUITS, { label: "date" }] });
        expect(view()).toMatchObject({ activeIndex: 2 });

        pick.update({ keepScrollPosition: false, items: FRUITS });
        expect(view()).toMatchObject({ activeIndex: 0 });
    });
});

describe("QuickPickSession — owner changes echoed, as for an extension", () => {
    function echoing() {
        const component = new QuickInputComponent();
        const service = new QuickInputService(component);
        const body = new BodyElement();
        const testApp = TestApp.create(body, new Size(80, 24));
        component.attachHost(body);
        const log: Logged[] = [];
        const labels = (items: readonly QuickPickSessionItem[]): string[] => items.map((item) => item.label);
        const pick = service.createQuickPick<QuickPickSessionItem>(
            {
                onDidChangeValue: (value) => log.push(["value", value]),
                onDidAccept: () => log.push(["accept"]),
                onDidChangeActive: (items) => log.push(["active", labels(items)]),
                onDidChangeSelection: (items) => log.push(["selection", labels(items)]),
                onDidHide: () => log.push(["hide"]),
            },
            { echoOwnerChanges: true },
        );
        return { pick, log, testApp };
    }

    it("activeItems set before show come back on show", () => {
        const { pick, log } = echoing();
        pick.update({ items: FRUITS, activeItems: [FRUITS[1]] });
        expect(log).toEqual([]);
        pick.show();
        expect(log).toEqual([["active", ["banana"]]]);
    });

    it("selectedItems set while open give a selection and an accept, the active row stays", () => {
        const { pick, log } = echoing();
        pick.update({ items: FRUITS });
        pick.show();
        log.length = 0;
        pick.update({ selectedItems: [FRUITS[1]] });
        pick.update({ selectedItems: [FRUITS[2]] });
        expect(log).toEqual([["selection", ["banana"]], ["accept"], ["selection", ["cherry"]], ["accept"]]);
        expect(pick.getState().activeItems).toEqual([FRUITS[0]]);
    });

    it("selectedItems set before show are confirmed on show", () => {
        const { pick, log } = echoing();
        pick.update({ items: FRUITS, selectedItems: [FRUITS[2]] });
        pick.show();
        expect(log).toEqual([["active", ["apple"]], ["selection", ["cherry"]], ["accept"]]);
    });

    it("in a multi-select they are checks: a selection without an accept, and no active row", () => {
        const { pick, log } = echoing();
        pick.update({ items: FRUITS, canSelectMany: true });
        pick.show();
        expect(log).toEqual([]);
        pick.update({ selectedItems: [FRUITS[1]] });
        expect(log).toEqual([["selection", ["banana"]]]);
    });

    it("activeItems set while open come back too", () => {
        const { pick, log } = echoing();
        pick.update({ items: FRUITS });
        pick.show();
        pick.update({ activeItems: [FRUITS[2]] });
        expect(log.at(-1)).toEqual(["active", ["cherry"]]);
    });

    it("what was set before a show is confirmed once: the next show stays silent about it", () => {
        const { pick, log } = echoing();
        pick.update({ items: FRUITS, activeItems: [FRUITS[1]], selectedItems: [FRUITS[2]] });
        pick.show();
        pick.hide();
        log.length = 0;
        pick.show();
        expect(log).toEqual([]);
    });

    it("an empty selection is reported, but accepts nothing", () => {
        const { pick, log } = echoing();
        pick.update({ items: FRUITS });
        pick.show();
        log.length = 0;
        pick.update({ selectedItems: [] });
        expect(log).toEqual([["selection", []]]);
    });

    it("an owner that hides on the selection gets no accept", () => {
        const component = new QuickInputComponent();
        const service = new QuickInputService(component);
        component.attachHost(new BodyElement());
        const log: string[] = [];
        const pick = service.createQuickPick<QuickPickSessionItem>(
            {
                onDidChangeValue: () => undefined,
                onDidAccept: () => log.push("accept"),
                onDidChangeActive: () => undefined,
                onDidChangeSelection: () => {
                    log.push("selection");
                    pick.hide();
                },
                onDidHide: () => log.push("hide"),
            },
            { echoOwnerChanges: true },
        );
        pick.update({ items: FRUITS });
        pick.show();
        pick.update({ selectedItems: [FRUITS[1]] });
        expect(log).toEqual(["selection", "hide"]);
    });
});

describe("QuickPickSession — multi-select", () => {
    it("Space toggles a check and reports the set in list order; Enter accepts", () => {
        const { pick, view, testApp, log } = setup();
        pick.update({ items: FRUITS, canSelectMany: true });
        pick.show();
        log.length = 0;

        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");
        testApp.sendKey(" ");
        testApp.sendKey("ArrowUp");
        testApp.sendKey("ArrowUp");
        testApp.sendKey(" ");
        testApp.sendKey("Enter");

        expect(view()).toMatchObject({ checked: ["apple", "cherry"] });
        expect(log.filter((entry) => entry[0] !== "active")).toEqual([
            ["selection", ["cherry"]],
            ["selection", ["apple", "cherry"]],
            ["accept"],
        ]);
    });

    it("the owner's selectedItems are checks on screen and survive new items", () => {
        const { pick, view } = setup();
        pick.update({ items: FRUITS, canSelectMany: true, selectedItems: [FRUITS[1]] });
        pick.show();
        expect(view()).toMatchObject({ checked: ["banana"] });

        pick.update({ selectedItems: [FRUITS[0], FRUITS[2]] });
        expect(view()).toMatchObject({ checked: ["apple", "cherry"] });

        pick.update({ items: [...FRUITS] });
        expect(view()).toMatchObject({ checked: ["apple", "cherry"] });
    });
});

describe("QuickPickSession — hiding", () => {
    it("Escape closes and fires onDidHide; it can be shown again with the state intact", () => {
        const { pick, component, testApp, log, view, type } = setup();
        pick.update({ items: FRUITS });
        pick.show();
        type("ap");
        testApp.sendKey("Escape");

        expect(component.isOpen()).toBe(false);
        expect(log.at(-1)).toEqual(["hide"]);
        expect(pick.visible).toBe(false);

        pick.show();
        expect(view()).toMatchObject({ query: "ap", items: ["apple"] });
    });

    it("the owner's hide() closes and fires onDidHide exactly once", () => {
        const { pick, component, log } = setup();
        pick.show();
        pick.hide();
        pick.hide();
        expect(component.isOpen()).toBe(false);
        expect(log.filter((entry) => entry[0] === "hide")).toHaveLength(1);
    });

    it("another show on the shared widget takes it over — the picker gets onDidHide", () => {
        const { pick, service, log } = setup();
        pick.show();
        void service.input({ prompt: "other" });
        expect(log.at(-1)).toEqual(["hide"]);
        expect(pick.visible).toBe(false);
    });

    it("hide() after a takeover leaves the other show alone", () => {
        const { pick, service, component } = setup();
        pick.show();
        void service.input({ prompt: "other" });
        pick.hide();
        expect(component.isOpen()).toBe(true);
        expect(component.view.prompt).toBe("other");
    });

    it("dispose hides, and the picker is dead afterwards", () => {
        const { pick, component, log } = setup();
        pick.update({ items: FRUITS });
        pick.show();
        pick.dispose();
        expect(component.isOpen()).toBe(false);
        expect(log.at(-1)).toEqual(["hide"]);

        pick.show();
        pick.update({ title: "late" });
        expect(component.isOpen()).toBe(false);
        expect(pick.getState().title).toBeUndefined();
    });

    it("showing without state changes fires no extra hide events", () => {
        const { pick, log } = setup();
        pick.show();
        pick.show();
        expect(log.filter((entry) => entry[0] === "hide")).toEqual([]);
    });
});

describe("QuickPickSession — targeted updates of an open picker", () => {
    function titleRow(testApp: ReturnType<typeof setup>["testApp"]): string {
        testApp.render();
        // The overlay sits at 10% of the height (24 rows → row 2).
        return testApp.backend.getTextAt(new Point(0, 2), 80);
    }

    it("changing just the title reaches the frame", () => {
        const { pick, testApp } = setup();
        pick.update({ title: "Old", items: FRUITS });
        pick.show();
        expect(titleRow(testApp)).toContain("Old");

        pick.update({ title: "New" });
        expect(titleRow(testApp)).toContain("New");
    });

    it("changing just the prompt reaches the frame", () => {
        const { pick, testApp } = setup();
        pick.update({ prompt: "first", items: FRUITS });
        pick.show();
        pick.update({ prompt: "second" });
        // The prompt text is wrapped by layout, so two frames: layout, then paint.
        testApp.render();
        testApp.render();
        // Border is row 2, query row 3, prompt row 4.
        expect(testApp.backend.getTextAt(new Point(0, 4), 80)).toContain("second");
    });

    it("updating one field leaves the others, the active item and the query alone", () => {
        const { pick, view, testApp, log } = setup();
        pick.update({
            title: "T",
            step: 1,
            totalSteps: 2,
            prompt: "p",
            placeholder: "ph",
            items: FRUITS,
            canSelectMany: true,
            selectedItems: [FRUITS[0]],
        });
        pick.show();
        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");
        log.length = 0;

        pick.update({ prompt: "p2" });

        expect(view()).toMatchObject({ title: "T (1/2)", activeIndex: 1, checked: ["apple"], query: "" });
        expect(log).toEqual([]);
    });

    it("the same value again does not fire onDidChangeValue", () => {
        const { pick, log, type } = setup();
        pick.update({ items: FRUITS });
        pick.show();
        type("a");
        log.length = 0;
        pick.update({ value: "a" });
        expect(log).toEqual([]);
    });

    it("matchOnDescription alone refilters the open list", () => {
        const { pick, view, type } = setup();
        pick.update({ items: FRUITS });
        pick.show();
        type("red");
        expect(view()).toMatchObject({ items: [] });
        pick.update({ matchOnDescription: true });
        expect(view()).toMatchObject({ items: ["apple"] });
    });

    it("canSelectMany alone turns on checkboxes in the open list — in the frame", () => {
        const { pick, view, testApp } = setup();
        pick.update({ items: FRUITS, selectedItems: [FRUITS[2]] });
        pick.show();
        expect(view()).not.toHaveProperty("checked");
        pick.update({ canSelectMany: true });
        expect(view()).toMatchObject({ checked: ["cherry"] });
        // Rows: border 2, query 3, separator 4, apple 5, banana 6, cherry 7.
        testApp.render();
        testApp.render();
        expect(testApp.backend.getTextAt(new Point(0, 7), 80)).toContain("[✓] cherry");
        expect(testApp.backend.getTextAt(new Point(0, 5), 80)).toContain("[ ] apple");
    });

    it("typing moves the active item back to the first matching row", () => {
        const { pick, view, testApp, type } = setup();
        pick.update({ items: FRUITS });
        pick.show();
        testApp.sendKey("ArrowDown");
        // "a" matches both apple and banana: the active item is apple, not banana.
        type("a");
        expect(view()).toMatchObject({ items: ["apple", "banana"], activeIndex: 0 });
    });

    it("a list filtered down to nothing fires onDidChangeActive([])", () => {
        const { pick, log, type } = setup();
        pick.update({ items: FRUITS });
        pick.show();
        log.length = 0;
        type("zz");
        expect(log).toContainEqual(["active", []]);
    });

    it("a query with surrounding spaces searches by its trimmed content", () => {
        const { pick, view } = setup();
        pick.update({ items: FRUITS, value: "  ch " });
        pick.show();
        expect(view()).toMatchObject({ items: ["cherry"] });
    });

    it("activeItems: the first row and an unknown item follow the rules", () => {
        const { pick, view, testApp } = setup();
        pick.update({ items: FRUITS });
        pick.show();
        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");

        pick.update({ activeItems: [FRUITS[0]] });
        expect(view()).toMatchObject({ activeIndex: 0 });

        testApp.sendKey("ArrowDown");
        pick.update({ activeItems: [{ label: "foreign" }] });
        expect(view()).toMatchObject({ activeIndex: 1 });
    });

    it("activeItems set before show are active right away — without an echo to the owner", () => {
        const { pick, view, log } = setup();
        pick.update({ items: FRUITS, activeItems: [FRUITS[1]] });
        pick.show();
        expect(view()).toMatchObject({ activeIndex: 1 });
        expect(log).toEqual([]);
    });

    it("show itself reports the initial active item", () => {
        const { pick, log } = setup();
        pick.update({ items: FRUITS });
        pick.show();
        expect(log).toEqual([["active", ["apple"]]]);
    });

    it("keepScrollPosition replaces items in place", () => {
        const { pick, view } = setup();
        pick.update({ items: FRUITS, keepScrollPosition: true });
        pick.show();
        pick.update({ items: [...FRUITS, { label: "date" }] });
        expect(view()).toMatchObject({ items: ["apple", "banana", "cherry", "date"] });
    });

    it('without a placeholder the query row is empty, not the default "Type to search…"', () => {
        const { pick, component } = setup();
        pick.show();
        expect(component.view.placeholder).toBe("");
    });

    it("an empty title with steps shows only the steps", () => {
        const { pick, view } = setup();
        pick.update({ title: "", step: 1, totalSteps: 2 });
        pick.show();
        expect(view()).toMatchObject({ title: "1/2" });
        pick.update({ step: undefined });
        expect(view()).toMatchObject({ title: undefined });
    });
});

describe("QuickPickSession — file dialog mode", () => {
    it("matchOnLabel: false with no other fields — the query neither filters the list nor moves the active item", () => {
        const { pick, view, type, testApp } = setup();
        pick.update({ items: FRUITS, matchOnLabel: false });
        pick.show();
        testApp.sendKey("ArrowDown");
        type("zz");
        expect(view()).toMatchObject({ query: "zz", items: ["apple", "banana", "cherry"], activeIndex: 1 });
    });

    it("itemActivation: none — new items have no active item; Enter accepts the typed value", () => {
        const { pick, view, testApp, log } = setup();
        pick.update({ items: FRUITS, itemActivation: "none" });
        pick.show();
        expect(view()).toMatchObject({ activeIndex: -1 });
        log.length = 0;
        testApp.sendKey("Enter");
        expect(log).toEqual([["accept"]]);

        testApp.sendKey("ArrowDown");
        expect(view()).toMatchObject({ activeIndex: 0 });
        pick.update({ items: [...FRUITS] });
        expect(view()).toMatchObject({ activeIndex: -1 });
    });

    it("activeItems = [] clears the active item; ↑ from there goes to the last row", () => {
        const { pick, view, testApp, log } = setup();
        pick.update({ items: FRUITS });
        pick.show();
        log.length = 0;
        pick.update({ activeItems: [] });
        expect(view()).toMatchObject({ activeIndex: -1 });
        expect(log).toEqual([]);
        testApp.sendKey("ArrowUp");
        expect(view()).toMatchObject({ activeIndex: 2 });
        expect(log).toEqual([["active", ["cherry"]]]);
    });

    it("validationMessage shows a message under the query row; undefined removes it", () => {
        const { pick, component } = setup();
        pick.update({ validationMessage: "Please enter a path that exists." });
        pick.show();
        expect(component.view.validationMessage).toBe("Please enter a path that exists.");
        expect(component.view.validationSeverity).toBe("error");
        pick.update({ validationMessage: undefined });
        expect(component.view.validationMessage).toBeNull();
    });

    it("valueSelection selects text in the query row, together with the value and on its own", () => {
        const { pick, component } = setup();
        pick.show();
        pick.update({ value: "/ws/docs", valueSelection: [4, 8] });
        const state = component.view.inputElement.inputState;
        expect(state.selectedText).toBe("docs");
        expect(state.cursorOffset).toBe(8);
        pick.update({ valueSelection: [3, 3] });
        expect(state.hasSelection).toBe(false);
        expect(state.cursorOffset).toBe(3);
    });
});

describe("QuickPickSession — shared widget after another flavor", () => {
    it("a takeover closes another owner's show (Quick Open) — that owner learns about the close", () => {
        const { pick, component } = setup();
        let foreignClosed = false;
        component.onDidClose = () => {
            foreignClosed = true;
        };
        component.show();
        pick.show();
        expect(foreignClosed).toBe(true);
        expect(component.isOpen()).toBe(true);
    });

    it("a promise-based show opened earlier resolves to undefined", async () => {
        const { pick, service } = setup();
        const pending = service.quickPick({ items: [{ label: "x" }] });
        pick.show();
        await expect(pending).resolves.toBeUndefined();
    });

    it("the password mask, validation error and active item of the previous show do not carry over", async () => {
        const { pick, service, component, testApp, view, log } = setup();
        const input = service.input({ password: true, validateInput: () => "bad" });
        expect(component.view.validationMessage).toBe("bad");
        pick.update({ items: FRUITS });
        pick.show();
        await expect(input).resolves.toBeUndefined();

        expect(component.view.password).toBe(false);
        log.length = 0;
        testApp.sendKey("Enter");
        expect(log).toEqual([["selection", ["apple"]], ["accept"]]);

        pick.hide();
        const many = service.quickPickMany({ items: FRUITS });
        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");
        expect(view()).toMatchObject({ activeIndex: 2 });
        pick.show();
        await many;
        expect(view()).toMatchObject({ activeIndex: 0 });
        expect(view()).not.toHaveProperty("checked");
    });

    it("a fresh picker after another list with the active item at the bottom opens on the first row", async () => {
        const { pick, service, testApp, view } = setup();
        const many = service.quickPickMany({ items: FRUITS });
        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");
        pick.update({ items: FRUITS });
        pick.show();
        await many;
        expect(view()).toMatchObject({ activeIndex: 0 });
    });

    it("hide() of a hidden picker does not close another show", () => {
        const { pick, service, component } = setup();
        void service.input({ prompt: "foreign" });
        pick.hide();
        expect(component.isOpen()).toBe(true);
    });
});

describe("QuickPickSession — search rules and query selection", () => {
    it("matchOnLabel: false on an open picker shows the whole list again", () => {
        const { pick, view, type } = setup();
        pick.update({ items: FRUITS });
        pick.show();
        type("app");
        expect(view()).toMatchObject({ items: ["apple"] });

        pick.update({ matchOnLabel: false });

        expect(view()).toMatchObject({ items: ["apple", "banana", "cherry"] });
    });

    it("a query selection set before show is visible on show", () => {
        const { pick, component } = setup();
        pick.update({ value: "/ws/report.txt", valueSelection: [4, 10] });

        pick.show();

        expect(component.view.inputElement.inputState.selectedText).toBe("report");
    });
});

describe("QuickPickSession — widget handed over from the typing handler", () => {
    it("after hide() inside onDidChangeValue the new owner's rows are not overwritten", () => {
        const { service, component, testApp, view } = setup();
        const main = service.createQuickPick<QuickPickSessionItem>({
            onDidChangeValue: () => undefined,
            onDidAccept: () => undefined,
            onDidChangeActive: () => undefined,
            onDidChangeSelection: () => undefined,
            onDidHide: () => undefined,
        });
        main.update({ items: FRUITS });
        // A prompt on top: typing in it means "no", so it hides itself and shows the main picker again.
        const prompt = service.createQuickPick<QuickPickSessionItem>({
            onDidChangeValue: () => {
                prompt.hide();
            },
            onDidAccept: () => undefined,
            onDidChangeActive: () => undefined,
            onDidChangeSelection: () => undefined,
            onDidHide: () => {
                main.show();
            },
        });
        prompt.show();
        expect(view()).toMatchObject({ items: [] });

        testApp.sendKey("x");

        expect(component.isOpen()).toBe(true);
        expect(view()).toMatchObject({ items: ["apple", "banana", "cherry"] });
    });
});
