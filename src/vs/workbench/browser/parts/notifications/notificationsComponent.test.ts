import { Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { KeybindingRegistry, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { NotificationService } from "../../../services/notification/browser/notificationService.ts";

import { clampRow, FOCUS_MESSAGE_COMMAND_ID, NotificationsComponent } from "./notificationsComponent.ts";

// The full "service → overlay → frame" path is covered in workbench.notifications.test.ts.

function makeComponent(binding?: string) {
    const notifications = new NotificationService();
    const keybindings = new KeybindingRegistry();
    const contextKeys = new ContextKeyService();
    if (binding !== undefined) keybindings.register(parseKeybinding(binding), FOCUS_MESSAGE_COMMAND_ID);
    const component = new NotificationsComponent(notifications, keybindings, contextKeys);
    return { notifications, component };
}

function mountHost(component: NotificationsComponent) {
    const body = new BodyElement();
    const testApp = TestApp.create(body, new Size(80, 24));
    component.attachHost(body);
    return { body, testApp };
}

function screen(testApp: TestApp): string {
    testApp.render();
    return testApp.backend.screenToString();
}

describe("clampRow", () => {
    it("a regular row passes through as is", () => {
        expect(clampRow(10, 24)).toBe(10);
    });

    it("on a short screen a tall toast does not move above the menu row", () => {
        expect(clampRow(-5, 24)).toBe(1);
        expect(clampRow(0, 24)).toBe(1);
    });

    it("nor past the bottom edge of the frame", () => {
        expect(clampRow(100, 24)).toBe(23);
    });

    it("on a one-row screen the first row remains", () => {
        expect(clampRow(0, 1)).toBe(1);
    });
});

describe("NotificationsComponent — without an attached host", () => {
    it("a message before attachHost does not crash or open overlays", () => {
        const { notifications, component } = makeComponent();

        expect(() => {
            notifications.show({ severity: "error", message: "boom", modal: false, items: [] });
            notifications.show({ severity: "info", message: "ask?", modal: false, items: ["One"] });
        }).not.toThrow();
        expect(component.getOpenAsk()).toBeNull();
        expect(component.focusAsk()).toBe(false);
    });

    it("the stack is addressable by the #notificationToasts selector", () => {
        const { component } = makeComponent();
        const { testApp } = mountHost(component);
        expect(testApp.querySelector("#notificationToasts")).not.toBeNull();
    });

    it("focusAsk reports whether a question was found", () => {
        const { notifications, component } = makeComponent();
        mountHost(component);
        expect(component.focusAsk()).toBe(false);

        notifications.show({ severity: "info", message: "ask?", modal: false, items: ["One"] });

        expect(component.focusAsk()).toBe(true);
    });

    it("attachHost shows what has already accumulated", () => {
        const { notifications, component } = makeComponent();
        notifications.show({ severity: "error", message: "before the host", modal: false, items: [] });

        const { testApp } = mountHost(component);

        expect(screen(testApp)).toContain("before the host");
    });

    it("an empty service draws neither a border nor an empty window", () => {
        const { component } = makeComponent();
        const { testApp } = mountHost(component);

        expect(screen(testApp)).not.toContain("╭");
    });
});

describe("NotificationsComponent — toast close button", () => {
    it("× on a passive toast removes exactly that toast", () => {
        const { notifications, component } = makeComponent();
        const { testApp } = mountHost(component);
        notifications.show({ severity: "error", message: "sticky", modal: false, items: [] });
        notifications.show({ severity: "error", message: "second", modal: false, items: [] });
        expect(screen(testApp)).toContain("sticky");

        const buttons = testApp.querySelectorAll("ButtonElement");
        buttons[0].focus();
        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));

        const text = screen(testApp);
        expect(text).not.toContain("sticky");
        expect(text).toContain("second");
        expect(notifications.passive().map((n) => n.message)).toEqual(["second"]);
    });
});

describe("NotificationsComponent — dispose", () => {
    it("does not crash before attachHost", () => {
        const { component } = makeComponent();
        expect(() => {
            component.dispose();
        }).not.toThrow();
    });

    it("removes the question from the screen and stops listening to the service", () => {
        const { notifications, component } = makeComponent();
        const { testApp } = mountHost(component);
        notifications.show({ severity: "info", message: "ask?", modal: false, items: ["One"] });
        expect(component.getOpenAsk()).not.toBeNull();

        component.dispose();

        expect(component.getOpenAsk()).toBeNull();
        expect(screen(testApp)).not.toContain("ask?");

        expect(() => {
            notifications.show({ severity: "error", message: "after dispose", modal: false, items: [] });
        }).not.toThrow();
        expect(screen(testApp)).not.toContain("after dispose");
    });

    it("removes the passive stack: disposed toasts do not stay in the tree", () => {
        const { notifications, component } = makeComponent();
        const { testApp } = mountHost(component);
        notifications.show({ severity: "error", message: "sticky", modal: false, items: [] });
        expect(screen(testApp)).toContain("sticky");

        component.dispose();

        expect(screen(testApp)).not.toContain("sticky");
    });
});

describe("NotificationsComponent — binding label in the hint", () => {
    it("takes the key combination of the focus command's active binding", () => {
        const { notifications, component } = makeComponent("alt+m");
        const { testApp } = mountHost(component);

        notifications.show({ severity: "info", message: "ask?", modal: false, items: ["One"] });

        expect(screen(testApp)).toContain("Alt+M — reply");
    });

    it("without a binding it names the command — it can be found in the command palette", () => {
        const { notifications, component } = makeComponent();
        const { testApp } = mountHost(component);

        notifications.show({ severity: "info", message: "ask?", modal: false, items: ["One"] });

        expect(screen(testApp)).toContain("Notifications: Focus Message");
    });
});
