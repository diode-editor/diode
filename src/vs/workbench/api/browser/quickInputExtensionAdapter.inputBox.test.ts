import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../TestUtils/TestApp.ts";
import { QuickInputComponent } from "../../browser/parts/quickinput/quickInputComponent.ts";
import { QuickInputService } from "../../browser/parts/quickinput/quickInputService.ts";
import type { IWireQuickPickEvent } from "../common/wireTypes.ts";

import { QuickInputExtensionAdapter } from "./quickInputExtensionAdapter.ts";

function setup() {
    const component = new QuickInputComponent();
    const service = new QuickInputService(component);
    const body = new BodyElement();
    const testApp = TestApp.create(body, new Size(80, 24));
    component.attachHost(body);
    const adapter = new QuickInputExtensionAdapter(service);
    const events: IWireQuickPickEvent[] = [];
    const emit = (event: IWireQuickPickEvent): void => {
        events.push(event);
    };
    const frame = (): string => {
        testApp.render();
        return testApp.backend.screenToString();
    };
    return { adapter, service, component, testApp, events, emit, frame };
}

function clickAt(testApp: TestApp, x: number, y: number): void {
    for (const action of ["press", "release"] as const) {
        testApp.backend.simulateMouse({
            kind: "mouse",
            button: "left",
            // 1-based on the wire.
            x: x + 1,
            y: y + 1,
            action,
            shiftKey: false,
            altKey: false,
            ctrlKey: false,
            raw: "",
        });
    }
}

describe("QuickInputExtensionAdapter: input box flavor", () => {
    it("draws no list, and the pre-filled value starts selected: typing replaces it", () => {
        const { adapter, component, testApp, events, emit, frame } = setup();
        adapter.updateQuickPick(
            {
                handle: 5,
                inputBox: true,
                visible: true,
                title: "Create Maven Project",
                prompt: "Input group Id of your project.",
                value: "com.example",
            },
            emit,
        );

        const text = frame();
        expect(text).toContain("Create Maven Project");
        expect(text).toContain("com.example");
        expect(text).toContain("Input group Id of your project.");
        expect(component.view.items).toEqual([]);

        testApp.sendKey("x");
        expect(component.view.getQuery()).toBe("x");
        expect(events).toContainEqual({ handle: 5, kind: "changeValue", value: "x" });
    });

    it("Enter on the empty list accepts and leaves the box open: the extension decides", () => {
        const { adapter, component, testApp, events, emit } = setup();
        adapter.updateQuickPick({ handle: 5, inputBox: true, visible: true, value: "demo" }, emit);

        testApp.sendKey("Enter");

        expect(events).toContainEqual({ handle: 5, kind: "accept" });
        expect(component.isOpen()).toBe(true);
    });

    it("a validation message is drawn with its severity; null clears it", () => {
        const { adapter, component, emit, frame } = setup();
        adapter.updateQuickPick({ handle: 5, inputBox: true, visible: true, prompt: "Group" }, emit);

        adapter.updateQuickPick({ handle: 5, validationMessage: { message: "Careful", severity: "warning" } }, emit);
        expect(frame()).toContain("Careful");
        expect(component.view.validationSeverity).toBe("warning");

        adapter.updateQuickPick({ handle: 5, validationMessage: null }, emit);
        // The widget sets the row's text during layout, and that dirty mark paints on the next frame.
        frame();
        const cleared = frame();
        expect(cleared).not.toContain("Careful");
        expect(cleared).toContain("Group");
        expect(component.view.validationSeverity).toBe("error");
    });

    it("password masks the value in the frame", () => {
        const { adapter, emit, frame } = setup();
        adapter.updateQuickPick({ handle: 5, inputBox: true, visible: true, password: true, value: "secret" }, emit);
        expect(frame()).not.toContain("secret");
    });

    it("an explicit valueSelection is applied; null returns to the whole value", () => {
        const { adapter, component, testApp, emit } = setup();
        adapter.updateQuickPick(
            { handle: 5, inputBox: true, visible: true, value: "abcd", valueSelection: [1, 2] },
            emit,
        );
        testApp.sendKey("X");
        expect(component.view.getQuery()).toBe("aXcd");

        adapter.updateQuickPick({ handle: 5, value: "next", valueSelection: null }, emit);
        testApp.sendKey("Y");
        expect(component.view.getQuery()).toBe("Y");
    });

    it("a quick pick still starts with the cursor after its value", () => {
        const { adapter, component, testApp, emit } = setup();
        adapter.updateQuickPick({ handle: 5, visible: true, value: "ab" }, emit);
        testApp.sendKey("c");
        expect(component.view.getQuery()).toBe("abc");
    });
});

describe("QuickInputExtensionAdapter: Back button", () => {
    function withBack() {
        const env = setup();
        env.adapter.updateQuickPick(
            { handle: 5, visible: true, title: "Create", back: true, items: [{ handle: 0, label: "one" }] },
            env.emit,
        );
        return env;
    }

    it("is drawn in the title; a click on it reports back, and the picker stays open", () => {
        const { testApp, component, events, frame } = withBack();
        const lines = frame().split("\n");
        const row = lines.findIndex((line) => line.includes("← Create"));
        expect(row).toBeGreaterThanOrEqual(0);

        clickAt(testApp, (lines[row] ?? "").indexOf("←"), row);

        expect(events.filter((event) => event.kind === "back")).toEqual([{ handle: 5, kind: "back" }]);
        expect(component.isOpen()).toBe(true);
    });

    it("a title wider than the box is cut, and the arrow stays on screen and clickable", () => {
        const { adapter, testApp, events, emit, frame } = setup();
        const title = "A very long title ".repeat(10);
        adapter.updateQuickPick({ handle: 5, inputBox: true, visible: true, title, back: true }, emit);

        const lines = frame().split("\n");
        const row = lines.findIndex((line) => line.includes("← A very long"));
        expect(row).toBeGreaterThanOrEqual(0);

        clickAt(testApp, (lines[row] ?? "").indexOf("←"), row);
        expect(events.filter((event) => event.kind === "back")).toEqual([{ handle: 5, kind: "back" }]);
    });

    it("a click elsewhere on the title is not back", () => {
        const { testApp, events, frame } = withBack();
        const lines = frame().split("\n");
        const row = lines.findIndex((line) => line.includes("← Create"));

        clickAt(testApp, (lines[row] ?? "").indexOf("Create"), row);

        expect(events.filter((event) => event.kind === "back")).toEqual([]);
    });

    it("Alt+Left and workbench.action.quickInputBack report back", () => {
        const { testApp, service, events } = withBack();
        testApp.sendKey("Alt+ArrowLeft");
        service.backOpen();
        expect(events.filter((event) => event.kind === "back")).toHaveLength(2);
    });

    it("removing the button clears the arrow and its key", () => {
        const { adapter, testApp, service, events, emit, frame } = withBack();
        adapter.updateQuickPick({ handle: 5, back: false }, emit);

        expect(frame()).not.toContain("←");
        testApp.sendKey("Alt+ArrowLeft");
        service.backOpen();
        expect(events.filter((event) => event.kind === "back")).toEqual([]);
    });

    it("the next show on the shared widget has no arrow", async () => {
        const { service, testApp, frame } = withBack();
        const pending = service.input({ title: "Plain" });
        const text = frame();
        expect(text).toContain("Plain");
        expect(text).not.toContain("←");
        testApp.sendKey("Escape");
        await expect(pending).resolves.toBeUndefined();
    });

    it("without a title the arrow is the whole title", () => {
        const { adapter, emit, frame } = setup();
        adapter.updateQuickPick({ handle: 5, visible: true, back: true }, emit);
        expect(frame()).toContain("┤ ← ├");
    });
});
