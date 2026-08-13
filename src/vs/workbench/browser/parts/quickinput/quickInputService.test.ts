import { describe, expect, it } from "vitest";

import { Size } from "@tuidom/all/common/geometryPromitives";
import { TUIMouseEvent } from "@tuidom/all/dom/events/tuiMouseEvent";
import { BodyElement } from "@tuidom/all/ui/body/bodyElement";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";

import { QuickInputComponent } from "./quickInputComponent.ts";
import { QuickInputService } from "./quickInputService.ts";

function createService(): {
    service: QuickInputService;
    component: QuickInputComponent;
    body: BodyElement;
    testApp: TestApp;
} {
    const component = new QuickInputComponent();
    const service = new QuickInputService(component);
    const body = new BodyElement();
    const testApp = TestApp.create(body, new Size(80, 24));
    component.attachHost(body);
    return { service, component, body, testApp };
}

function outsideClick(body: BodyElement): void {
    body.dispatchEvent(
        new TUIMouseEvent("mousedown", { screenX: 0, screenY: 0, localX: 0, localY: 0, button: "left" }),
    );
}

describe("QuickInputService.input", () => {
    it("opens a visible overlay", () => {
        const { service, body } = createService();
        void service.input({ title: "Save As" });
        expect(body.overlayLayer.hasVisibleItems()).toBe(true);
    });

    it("resolves with the seeded value on Enter", async () => {
        const { service, testApp } = createService();
        const result = service.input({ value: "hello.txt" });
        testApp.sendKey("Enter");
        await expect(result).resolves.toBe("hello.txt");
    });

    it("resolves with the typed value on Enter", async () => {
        const { service, testApp } = createService();
        const result = service.input({});
        testApp.sendKey("a");
        testApp.sendKey("b");
        testApp.sendKey("Enter");
        await expect(result).resolves.toBe("ab");
    });

    it("resolves undefined on Escape", async () => {
        const { service, testApp } = createService();
        const result = service.input({});
        testApp.sendKey("Escape");
        await expect(result).resolves.toBeUndefined();
    });

    it("resolves undefined on an outside click", async () => {
        const { service, body } = createService();
        const result = service.input({});
        outsideClick(body);
        await expect(result).resolves.toBeUndefined();
    });

    it("blocks Enter while validation fails, then accepts once valid", async () => {
        const { service, body, testApp } = createService();
        const result = service.input({
            value: "",
            validateInput: (v) => (v.trim() === "" ? "Please enter a file name" : null),
        });

        // Seeded value is empty → invalid → Enter is a no-op, overlay stays open.
        testApp.sendKey("Enter");
        expect(body.overlayLayer.hasVisibleItems()).toBe(true);

        testApp.sendKey("x");
        testApp.sendKey("Enter");
        await expect(result).resolves.toBe("x");
    });

    it("supersedes a previous open prompt (resolves it undefined)", async () => {
        const { service, testApp } = createService();
        const first = service.input({ value: "one" });
        const second = service.input({ value: "two" });

        await expect(first).resolves.toBeUndefined();

        testApp.sendKey("Enter");
        await expect(second).resolves.toBe("two");
    });

    it("input() without an attached host is a no-op for positioning", () => {
        // No attachHost() → host is null and there is no overlay session.
        const component = new QuickInputComponent();
        const service = new QuickInputService(component);
        // input() reaches updatePosition, which early-returns without throwing.
        expect(() => void service.input({ value: "x" })).not.toThrow();
        // preferredWidth keeps its default since positioning was skipped.
        expect(component.view.preferredWidth).toBe(60);
        // Без сессии компонент считается закрытым.
        expect(component.isOpen()).toBe(false);
    });
});
