import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../TestUtils/TestApp.ts";
import { flushMicrotasks } from "../../../../TestUtils/timing.ts";
import { QuickInputComponent } from "../../browser/parts/quickinput/quickInputComponent.ts";
import { QuickInputService } from "../../browser/parts/quickinput/quickInputService.ts";
import type { IWireQuickPickEvent, IWireQuickPickRequest } from "../common/wireTypes.ts";

import { QuickInputExtensionAdapter } from "./quickInputExtensionAdapter.ts";

function createAdapter() {
    const component = new QuickInputComponent();
    const service = new QuickInputService(component);
    const body = new BodyElement();
    const testApp = TestApp.create(body, new Size(80, 24));
    component.attachHost(body);
    return { adapter: new QuickInputExtensionAdapter(service), service, component, testApp };
}

function pickRequest(overrides: Partial<IWireQuickPickRequest> = {}): IWireQuickPickRequest {
    return {
        handle: 1,
        canPickMany: false,
        items: [{ label: "alpha" }, { label: "beta" }, { label: "gamma" }],
        picked: [],
        ...overrides,
    };
}

describe("QuickInputExtensionAdapter.showInputBox", () => {
    it("raises the overlay with the extension's options and returns the input", async () => {
        const { adapter, component, testApp } = createAdapter();
        const pending = adapter.showInputBox({
            handle: 1,
            title: "Your name",
            prompt: "How should we address you",
            placeHolder: "name",
            value: "Ada",
            password: false,
            validates: false,
        });
        expect(component.view.title).toBe("Your name");
        expect(component.view.prompt).toBe("How should we address you");
        expect(component.view.placeholder).toBe("name");
        testApp.sendKey("Enter");
        await expect(pending).resolves.toBe("Ada");
    });

    it("password from the extension's request enables the mask, but the real text is returned", async () => {
        const { adapter, component, testApp } = createAdapter();
        const pending = adapter.showInputBox({ handle: 1, password: true, validates: false });
        testApp.sendKey("h");
        testApp.sendKey("i");

        expect(component.view.password).toBe(true);
        expect(component.view.inspectState().query).toBe("**");

        testApp.sendKey("Enter");
        await expect(pending).resolves.toBe("hi");
    });

    it("no mask without password", () => {
        const { adapter, component } = createAdapter();
        void adapter.showInputBox({ handle: 1, password: false, validates: false });
        expect(component.view.password).toBe(false);
    });

    it("Escape — undefined", async () => {
        const { adapter, testApp } = createAdapter();
        const pending = adapter.showInputBox({ handle: 1, password: false, validates: false });
        testApp.sendKey("Escape");
        await expect(pending).resolves.toBeUndefined();
    });

    it("extension validation is shown and blocks Enter", async () => {
        const { adapter, component, testApp } = createAdapter();
        const pending = adapter.showInputBox({
            handle: 1,
            password: false,
            validates: true,
            validate: (value) =>
                Promise.resolve(value === "ab" ? { message: "Digits only", severity: "error" as const } : null),
        });
        testApp.sendKey("a");
        testApp.sendKey("b");
        await Promise.resolve();
        await Promise.resolve();
        expect(component.view.validationMessage).toBe("Digits only");
        expect(component.view.validationSeverity).toBe("error");
        testApp.sendKey("Enter");
        expect(component.isOpen()).toBe(true);

        testApp.sendKey("Backspace");
        await Promise.resolve();
        await Promise.resolve();
        testApp.sendKey("Enter");
        await expect(pending).resolves.toBe("a");
    });

    it("extension warning does not block Enter", async () => {
        const { adapter, component, testApp } = createAdapter();
        const pending = adapter.showInputBox({
            handle: 1,
            password: false,
            validates: true,
            validate: () => Promise.resolve({ message: "Careful", severity: "warning" as const }),
        });
        testApp.sendKey("8");
        await Promise.resolve();
        await Promise.resolve();
        expect(component.view.validationSeverity).toBe("warning");
        testApp.sendKey("Enter");
        await expect(pending).resolves.toBe("8");
    });
});

describe("QuickInputExtensionAdapter.showQuickPick", () => {
    it("single pick answers with the index of the chosen row", async () => {
        const { adapter, testApp } = createAdapter();
        const pending = adapter.showQuickPick(pickRequest());
        testApp.sendKey("ArrowDown");
        testApp.sendKey("Enter");
        await expect(pending).resolves.toEqual([1]);
    });

    it("without title and placeholder the pick opens with widget defaults", async () => {
        const { adapter, component, testApp } = createAdapter();
        const pending = adapter.showQuickPick(pickRequest());
        expect(component.view.title).toBeUndefined();
        expect(component.view.placeholder).toBe("");
        testApp.sendKey("Enter");
        await expect(pending).resolves.toEqual([0]);
    });

    it("list title and placeholder reach the widget", async () => {
        const { adapter, component, testApp } = createAdapter();
        const pending = adapter.showQuickPick(pickRequest({ title: "Who", placeHolder: "Pick one" }));
        expect(component.view.title).toBe("Who");
        expect(component.view.placeholder).toBe("Pick one");
        testApp.sendKey("Escape");
        await pending;
    });

    it("multi-pick without title and placeholder also opens", async () => {
        const { adapter, component, testApp } = createAdapter();
        const pending = adapter.showQuickPick(pickRequest({ canPickMany: true }));
        expect(component.view.title).toBeUndefined();
        expect(component.view.placeholder).toBe("");
        testApp.sendKey("Enter");
        await expect(pending).resolves.toEqual([]);
    });

    it("multi-pick with title and placeholder passes them to the widget", async () => {
        const { adapter, component, testApp } = createAdapter();
        const pending = adapter.showQuickPick(
            pickRequest({ canPickMany: true, title: "What", placeHolder: "Check some" }),
        );
        expect(component.view.title).toBe("What");
        expect(component.view.placeholder).toBe("Check some");
        testApp.sendKey("Escape");
        await pending;
    });

    it("item description reaches the widget", () => {
        const { adapter, component } = createAdapter();
        void adapter.showQuickPick(pickRequest({ items: [{ label: "TypeScript", description: ".ts" }] }));
        expect(component.view.items[0]).toEqual({ label: "TypeScript", description: ".ts" });
    });

    it("Escape yields undefined, not an empty set", async () => {
        const { adapter, testApp } = createAdapter();
        const pending = adapter.showQuickPick(pickRequest());
        testApp.sendKey("Escape");
        await expect(pending).resolves.toBeUndefined();
    });

    it("multi-pick answers with indices in list order", async () => {
        const { adapter, testApp } = createAdapter();
        const pending = adapter.showQuickPick(pickRequest({ canPickMany: true }));
        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");
        testApp.sendKey(" ");
        testApp.sendKey("ArrowUp");
        testApp.sendKey("ArrowUp");
        testApp.sendKey(" ");
        testApp.sendKey("Enter");
        await expect(pending).resolves.toEqual([0, 2]);
    });

    it("onDidSelectItem reports the active row on open and on a real move, not again on filtering", async () => {
        const { adapter, testApp } = createAdapter();
        const seen: number[] = [];
        const pending = adapter.showQuickPick(pickRequest(), (index) => seen.push(index));
        expect(seen).toEqual([0]);
        testApp.sendKey("ArrowDown");
        expect(seen).toEqual([0, 1]);
        testApp.sendKey("b");
        expect(seen).toEqual([0, 1]);
        testApp.sendKey("Enter");
        await expect(pending).resolves.toEqual([1]);
    });

    it("in a multi-select onDidSelectItem stays silent until the first step", async () => {
        const { adapter, testApp } = createAdapter();
        const seen: number[] = [];
        const pending = adapter.showQuickPick(pickRequest({ canPickMany: true }), (index) => seen.push(index));
        expect(seen).toEqual([]);
        testApp.sendKey("ArrowDown");
        expect(seen).toEqual([0]);
        testApp.sendKey("Enter");
        await expect(pending).resolves.toEqual([]);
    });

    it("late items: the reply indexes them, and they are forgotten with the show", async () => {
        const { adapter, service, testApp } = createAdapter();
        const seen: number[] = [];
        const pending = adapter.showQuickPick(pickRequest({ items: [], itemsPending: true }), (index) =>
            seen.push(index),
        );
        expect(seen).toEqual([]);
        adapter.setQuickPickItems({ handle: 1, items: [{ label: "one" }, { label: "two" }], picked: [] });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(seen).toEqual([0]);
        testApp.sendKey("ArrowDown");
        testApp.sendKey("Enter");
        await expect(pending).resolves.toEqual([1]);

        const again = adapter.showQuickPick(pickRequest({ handle: 2, items: [], itemsPending: true }));
        service.closeOpen();
        await expect(again).resolves.toBeUndefined();
        adapter.setQuickPickItems({ handle: 2, items: [{ label: "late" }], picked: [] });
    });

    it("late items bring their preselection", async () => {
        const { adapter, testApp } = createAdapter();
        const pending = adapter.showQuickPick(pickRequest({ canPickMany: true, items: [], itemsPending: true }));
        adapter.setQuickPickItems({ handle: 1, items: [{ label: "one" }, { label: "two" }], picked: [1] });
        await flushMicrotasks();
        testApp.sendKey("Enter");
        await expect(pending).resolves.toEqual([1]);
    });

    it("a second batch for the same show is ignored: the reply still indexes the first", async () => {
        const { adapter, testApp } = createAdapter();
        const pending = adapter.showQuickPick(pickRequest({ items: [], itemsPending: true }));
        adapter.setQuickPickItems({ handle: 1, items: [{ label: "one" }, { label: "two" }], picked: [] });
        adapter.setQuickPickItems({ handle: 1, items: [{ label: "other" }], picked: [] });
        await flushMicrotasks();
        testApp.sendKey("ArrowDown");
        testApp.sendKey("Enter");
        await expect(pending).resolves.toEqual([1]);
    });

    it("items for a show that announced none are ignored", async () => {
        const { adapter, component, testApp } = createAdapter();
        const pending = adapter.showQuickPick(pickRequest());
        adapter.setQuickPickItems({ handle: 1, items: [{ label: "stray" }], picked: [] });
        await flushMicrotasks();
        expect(component.view.inspectState()).toMatchObject({ items: ["alpha", "beta", "gamma"] });
        testApp.sendKey("Escape");
        await pending;
    });

    it("filtering every row away reports nothing to onDidSelectItem", async () => {
        const { adapter, testApp } = createAdapter();
        const seen: number[] = [];
        const pending = adapter.showQuickPick(pickRequest(), (index) => seen.push(index));
        testApp.sendKey("z");
        expect(seen).toEqual([0]);
        testApp.sendKey("Escape");
        await pending;
    });

    it("pre-picked indices open already checked", async () => {
        const { adapter, testApp } = createAdapter();
        const pending = adapter.showQuickPick(pickRequest({ canPickMany: true, picked: [1] }));
        testApp.sendKey("Enter");
        await expect(pending).resolves.toEqual([1]);
    });

    it("multi-pick with nothing checked yields an empty index array", async () => {
        const { adapter, testApp } = createAdapter();
        const pending = adapter.showQuickPick(pickRequest({ canPickMany: true }));
        testApp.sendKey("Enter");
        await expect(pending).resolves.toEqual([]);
    });

    it("empty list: Enter accepts nothing, Escape cancels", async () => {
        const { adapter, component, testApp } = createAdapter();
        const pending = adapter.showQuickPick(pickRequest({ items: [] }));
        testApp.sendKey("Enter");
        expect(component.isOpen()).toBe(true);
        testApp.sendKey("Escape");
        await expect(pending).resolves.toBeUndefined();
    });
});

describe("QuickInputExtensionAdapter.cancel", () => {
    it("cancels its live input and resolves the promise to undefined", async () => {
        const { adapter, component } = createAdapter();
        const pending = adapter.showInputBox({ handle: 7, password: false, validates: false });
        adapter.cancel(7);
        await expect(pending).resolves.toBeUndefined();
        expect(component.isOpen()).toBe(false);
    });

    it("cancels the live list pick", async () => {
        const { adapter } = createAdapter();
        const pending = adapter.showQuickPick(pickRequest({ handle: 9 }));
        adapter.cancel(9);
        await expect(pending).resolves.toBeUndefined();
    });

    it("foreign handle leaves the current input alone", async () => {
        const { adapter, component, testApp } = createAdapter();
        const pending = adapter.showInputBox({ handle: 7, password: false, validates: false });
        adapter.cancel(8);
        expect(component.isOpen()).toBe(true);
        testApp.sendKey("Enter");
        await expect(pending).resolves.toBe("");
    });

    it("cancel of an already closed input is a no-op and does not kill another session", async () => {
        const { adapter, service, component, testApp } = createAdapter();
        const pending = adapter.showInputBox({ handle: 7, password: false, validates: false });
        testApp.sendKey("Escape");
        await pending;

        // Another owner took the overlay (one of our own commands).
        const ours = service.input({ title: "Save As" });
        adapter.cancel(7);
        expect(component.isOpen()).toBe(true);
        testApp.sendKey("Enter");
        await expect(ours).resolves.toBe("");
    });

    it("cancel of a closed LIST does not kill another session", async () => {
        const { adapter, service, component, testApp } = createAdapter();
        const pending = adapter.showQuickPick(pickRequest({ handle: 5 }));
        testApp.sendKey("Escape");
        await pending;

        const ours = service.input({ title: "Save As" });
        adapter.cancel(5);
        expect(component.isOpen()).toBe(true);
        testApp.sendKey("Enter");
        await expect(ours).resolves.toBe("");
    });

    it("tail of a preempted input does not reset the preempting slot", async () => {
        const { adapter, component, testApp } = createAdapter();
        const first = adapter.showInputBox({ handle: 1, password: false, validates: false });
        const second = adapter.showQuickPick(pickRequest({ handle: 2 }));
        // The first show is already preempted by the second; its completion does NOT touch the slot.
        await expect(first).resolves.toBeUndefined();

        adapter.cancel(2);
        expect(component.isOpen()).toBe(false);
        await expect(second).resolves.toBeUndefined();
    });

    it("preemption by the extension's next input does not leave the previous promise hanging", async () => {
        const { adapter, testApp } = createAdapter();
        const first = adapter.showInputBox({ handle: 1, password: false, validates: false });
        const second = adapter.showQuickPick(pickRequest({ handle: 2 }));
        await expect(first).resolves.toBeUndefined();
        testApp.sendKey("Enter");
        await expect(second).resolves.toEqual([0]);
    });
});

describe("QuickInputExtensionAdapter: object picker", () => {
    function objectPick() {
        const env = createAdapter();
        const events: IWireQuickPickEvent[] = [];
        const emit = (event: IWireQuickPickEvent): void => {
            events.push(event);
        };
        return { ...env, events, emit };
    }

    it("first update creates and shows the picker; detail takes the description's place", () => {
        const { adapter, component, emit } = objectPick();
        adapter.updateQuickPick(
            {
                handle: 5,
                visible: true,
                title: "Pick",
                items: [
                    { handle: 0, label: "Alpha", description: "first", detail: "ignored" },
                    { handle: 2, label: "Gamma", detail: "example.com/gamma" },
                ],
            },
            emit,
        );
        expect(component.isOpen()).toBe(true);
        expect(component.view.title).toBe("Pick");
        expect(component.view.items.map((item) => [item.label, item.description])).toEqual([
            ["Alpha", "first"],
            ["Gamma", "example.com/gamma"],
        ]);
    });

    it("user actions are sent as events with the extension's item handles", () => {
        const { adapter, testApp, events, emit } = objectPick();
        adapter.updateQuickPick(
            {
                handle: 5,
                visible: true,
                items: [
                    { handle: 0, label: "Alpha" },
                    { handle: 2, label: "Gamma" },
                ],
            },
            emit,
        );
        events.length = 0;
        testApp.sendKey("ArrowDown");
        testApp.sendKey("Enter");
        testApp.sendKey("Escape");
        expect(events).toEqual([
            { handle: 5, kind: "changeActive", items: [2] },
            { handle: 5, kind: "changeSelection", items: [2] },
            { handle: 5, kind: "accept" },
            { handle: 5, kind: "hide" },
        ]);
    });

    it("activeItems and selectedItems set by the extension come back as events, as upstream", () => {
        const { adapter, events, emit } = objectPick();
        const items = [
            { handle: 0, label: "Alpha" },
            { handle: 2, label: "Gamma" },
        ];
        adapter.updateQuickPick({ handle: 5, visible: true, items }, emit);
        events.length = 0;
        adapter.updateQuickPick({ handle: 5, activeItems: [2] }, emit);
        adapter.updateQuickPick({ handle: 5, selectedItems: [0] }, emit);
        expect(events).toEqual([
            { handle: 5, kind: "changeActive", items: [2] },
            { handle: 5, kind: "changeSelection", items: [0] },
            { handle: 5, kind: "accept" },
        ]);
    });

    it("typing sends changeValue with the text as is", () => {
        const { adapter, testApp, events, emit } = objectPick();
        adapter.updateQuickPick({ handle: 5, visible: true }, emit);
        testApp.sendKey("$");
        expect(events).toContainEqual({ handle: 5, kind: "changeValue", value: "$" });
    });

    it("activeItems/selectedItems of the same diff resolve against the NEW items", () => {
        const { adapter, component, emit } = objectPick();
        adapter.updateQuickPick({ handle: 5, visible: true, items: [{ handle: 0, label: "old" }] }, emit);
        adapter.updateQuickPick(
            {
                handle: 5,
                canSelectMany: true,
                items: [
                    { handle: 0, label: "one" },
                    { handle: 1, label: "two" },
                ],
                activeItems: [1],
                selectedItems: [0, 9],
            },
            emit,
        );
        expect(component.view.inspectState()).toMatchObject({
            items: ["one", "two"],
            activeIndex: 1,
            checked: ["one"],
        });
    });

    it("null resets a field, visible:false hides, the next visible:true shows again", () => {
        const { adapter, component, events, emit } = objectPick();
        adapter.updateQuickPick({ handle: 5, visible: true, title: "T", step: 1, totalSteps: 2 }, emit);
        expect(component.view.title).toBe("T (1/2)");
        adapter.updateQuickPick({ handle: 5, title: null, step: null, totalSteps: null, placeholder: null }, emit);
        expect(component.view.title).toBeUndefined();

        adapter.updateQuickPick({ handle: 5, visible: false, prompt: "hidden" }, emit);
        expect(component.isOpen()).toBe(false);
        expect(events.at(-1)).toEqual({ handle: 5, kind: "hide" });

        adapter.updateQuickPick({ handle: 5, visible: true }, emit);
        expect(component.isOpen()).toBe(true);
        expect(component.view.prompt).toBe("hidden");
    });

    it("other flags reach the session", () => {
        const { adapter, component, testApp, emit } = objectPick();
        adapter.updateQuickPick(
            {
                handle: 5,
                visible: true,
                matchOnDescription: true,
                matchOnDetail: true,
                keepScrollPosition: true,
                value: "sec",
                items: [
                    { handle: 0, label: "a", description: "first" },
                    { handle: 1, label: "b", detail: "second" },
                ],
            },
            emit,
        );
        expect(component.view.inspectState()).toMatchObject({ query: "sec", items: ["b"] });
        testApp.sendKey("Backspace");
        testApp.sendKey("Backspace");
        testApp.sendKey("Backspace");
        for (const ch of "fir") testApp.sendKey(ch);
        expect(component.view.inspectState()).toMatchObject({ items: ["a"] });
    });

    it("dispose hides and forgets; repeated and foreign dispose are silent", () => {
        const { adapter, component, events, emit } = objectPick();
        adapter.updateQuickPick({ handle: 5, visible: true }, emit);
        adapter.disposeQuickPick(5);
        expect(component.isOpen()).toBe(false);
        expect(events.at(-1)).toEqual({ handle: 5, kind: "hide" });
        events.length = 0;
        adapter.disposeQuickPick(5);
        adapter.disposeQuickPick(6);
        expect(events).toEqual([]);

        // The same handle after removal is a new picker, not the old one revived.
        adapter.updateQuickPick({ handle: 5, visible: true }, emit);
        expect(component.view.title).toBeUndefined();
    });

    it("after dispose the same handle creates a live picker again", () => {
        const { adapter, component, emit } = objectPick();
        adapter.updateQuickPick({ handle: 5, visible: true, title: "old" }, emit);
        adapter.disposeQuickPick(5);
        adapter.updateQuickPick({ handle: 5, visible: true }, emit);
        expect(component.isOpen()).toBe(true);
        expect(component.view.title).toBeUndefined();
    });

    it("unknown handle in activeItems is dropped, highlight goes to the first known one", () => {
        const { adapter, component, emit } = objectPick();
        adapter.updateQuickPick(
            {
                handle: 5,
                visible: true,
                items: [
                    { handle: 0, label: "one" },
                    { handle: 1, label: "two" },
                ],
                activeItems: [9, 1],
            },
            emit,
        );
        expect(component.view.inspectState()).toMatchObject({ activeIndex: 1 });
    });

    it("a diff without a field leaves it alone: labels, steps, flags and query stay", () => {
        const { adapter, component, emit } = objectPick();
        adapter.updateQuickPick(
            {
                handle: 5,
                visible: true,
                title: "T",
                step: 1,
                totalSteps: 2,
                prompt: "p",
                placeholder: "ph",
                value: "o",
                canSelectMany: true,
                matchOnDescription: true,
                items: [{ handle: 0, label: "one", description: "x" }],
                selectedItems: [0],
            },
            emit,
        );
        adapter.updateQuickPick({ handle: 5, items: [{ handle: 0, label: "one", description: "x" }] }, emit);
        expect(component.view.inspectState()).toMatchObject({
            title: "T (1/2)",
            query: "o",
            items: ["one"],
            checked: [],
        });
        expect(component.view.prompt).toBe("p");
        expect(component.view.placeholder).toBe("ph");
    });

    it("keepScrollPosition from the diff keeps the highlight in place on new items", () => {
        const { adapter, component, testApp, emit } = objectPick();
        const items = [
            { handle: 0, label: "one" },
            { handle: 1, label: "two" },
        ];
        adapter.updateQuickPick({ handle: 5, visible: true, keepScrollPosition: true, items }, emit);
        testApp.sendKey("ArrowDown");
        adapter.updateQuickPick({ handle: 5, items: [...items, { handle: 2, label: "three" }] }, emit);
        expect(component.view.inspectState()).toMatchObject({ activeIndex: 1 });
    });

    it("matchOnDetail from the diff matches on detail even when the description hides it on screen", () => {
        const { adapter, component, emit } = objectPick();
        adapter.updateQuickPick(
            {
                handle: 5,
                visible: true,
                matchOnDetail: true,
                value: "hidden",
                items: [
                    { handle: 0, label: "a", description: "shown", detail: "hidden" },
                    { handle: 1, label: "b" },
                ],
            },
            emit,
        );
        expect(component.view.inspectState()).toMatchObject({ items: ["a"] });
    });

    it("empty description yields to detail", () => {
        const { adapter, component, emit } = objectPick();
        adapter.updateQuickPick(
            { handle: 5, visible: true, items: [{ handle: 0, label: "a", description: "", detail: "det" }] },
            emit,
        );
        expect(component.view.items[0]).toMatchObject({ description: "det" });
    });
});
