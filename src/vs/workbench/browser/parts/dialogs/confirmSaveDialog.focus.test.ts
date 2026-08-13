import { describe, expect, it, vi } from "vitest";

import { Size } from "@tuidom/all/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/all/dom/events/tuiKeyboardEvent";
import type { ButtonElement } from "@tuidom/all/ui/button/buttonElement";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";

import { ConfirmSaveDialog } from "./confirmSaveDialog.ts";

function mount(filename = "test.ts") {
    const themeService = new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme));
    const dialog = new ConfirmSaveDialog(filename);
    const testApp = TestApp.createWithContent(dialog.view, new Size(80, 24));
    const buttons = testApp.querySelectorAll("ButtonElement") as ButtonElement[];
    return { dialog, testApp, buttons };
}

function sendToFocused(testApp: TestApp, key: string): void {
    testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key }));
}

describe("ConfirmSaveDialog — focus navigation", () => {
    it("focusDefault focuses the Save button", () => {
        const { dialog, testApp, buttons } = mount();
        dialog.focusDefault();
        expect(testApp.focusedElement).toBe(buttons[2]);
        expect(buttons[2].getLabel()).toBe("Save");
    });

    it("ArrowLeft moves focus toward the first button and stops at the edge", () => {
        const { dialog, testApp, buttons } = mount();
        dialog.focusDefault(); // Save (index 2)

        sendToFocused(testApp, "ArrowLeft");
        expect(testApp.focusedElement).toBe(buttons[1]); // Cancel

        sendToFocused(testApp, "ArrowLeft");
        expect(testApp.focusedElement).toBe(buttons[0]); // Don't Save

        sendToFocused(testApp, "ArrowLeft");
        expect(testApp.focusedElement).toBe(buttons[0]); // stays at the left edge
    });

    it("ArrowRight moves focus toward the last button and stops at the edge", () => {
        const { testApp, buttons } = mount();
        buttons[0].focus(); // Don't Save (index 0)

        sendToFocused(testApp, "ArrowRight");
        expect(testApp.focusedElement).toBe(buttons[1]);

        sendToFocused(testApp, "ArrowRight");
        expect(testApp.focusedElement).toBe(buttons[2]);

        sendToFocused(testApp, "ArrowRight");
        expect(testApp.focusedElement).toBe(buttons[2]); // stays at the right edge
    });
});

describe("ConfirmSaveDialog — actions", () => {
    it("Escape triggers onCancel", () => {
        const { dialog, testApp } = mount();
        const onCancel = vi.fn();
        dialog.onCancel = onCancel;
        dialog.focusDefault();

        sendToFocused(testApp, "Escape");

        expect(onCancel).toHaveBeenCalledOnce();
    });

    it("Enter on each button fires the matching callback", () => {
        const { dialog, testApp, buttons } = mount();
        const onSave = vi.fn();
        const onDontSave = vi.fn();
        const onCancel = vi.fn();
        dialog.onSave = onSave;
        dialog.onDontSave = onDontSave;
        dialog.onCancel = onCancel;

        buttons[0].focus();
        sendToFocused(testApp, "Enter");
        expect(onDontSave).toHaveBeenCalledOnce();

        buttons[1].focus();
        sendToFocused(testApp, "Enter");
        expect(onCancel).toHaveBeenCalledOnce();

        buttons[2].focus();
        sendToFocused(testApp, "Enter");
        expect(onSave).toHaveBeenCalledOnce();
    });
});

describe("ConfirmSaveDialog — keydown dispatched directly to the dialog view", () => {
    it("handles ArrowLeft when the dialog view itself is the event target", () => {
        const { dialog, testApp, buttons } = mount();
        dialog.focusDefault(); // Save (index 2)

        // Dispatch on the dialog view directly (target phase) rather than via the focused button.
        dialog.view.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "ArrowLeft" }));

        expect(testApp.focusedElement).toBe(buttons[1]); // Cancel
    });

    it("triggers onCancel on Escape dispatched directly to the dialog view", () => {
        const { dialog } = mount();
        const onCancel = vi.fn();
        dialog.onCancel = onCancel;
        dialog.focusDefault();

        dialog.view.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Escape" }));

        expect(onCancel).toHaveBeenCalledOnce();
    });
});

describe("ConfirmSaveDialog — filename display", () => {
    it("setFilename updates the rendered filename", () => {
        const { dialog, testApp } = mount("a.ts");
        dialog.setFilename("renamed.ts");
        testApp.render();
        expect(testApp.backend.screenToString()).toContain("renamed.ts?");
    });

    it("truncates an overly long filename with a leading ellipsis", () => {
        const longName = "x".repeat(100) + "-tail.ts";
        const { testApp } = mount(longName);
        testApp.render();
        const text = testApp.backend.screenToString();
        expect(text).toContain("...");
        expect(text).toContain("-tail.ts?");
        expect(text).not.toContain("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
    });
});
