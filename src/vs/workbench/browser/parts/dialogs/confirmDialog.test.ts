import { describe, expect, it, vi } from "vitest";

import { Point, Size } from "../../../../../../tuidom/common/geometryPromitives.ts";
import { TUIKeyboardEvent } from "../../../../../../tuidom/dom/events/tuiKeyboardEvent.ts";
import type { ButtonElement } from "../../../../../../tuidom/ui/button/buttonElement.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";

import { ConfirmDialog, type ConfirmDialogOptions } from "./confirmDialog.ts";

const theme = WorkbenchTheme.fromThemeFile(darkPlusTheme);

function mount(options: Partial<ConfirmDialogOptions> = {}) {
    const dialog = new ConfirmDialog({
        title: "Delete",
        message: "Delete «x.txt»?",
        confirmLabel: "Move to Trash",
        ...options,
    });
    const testApp = TestApp.createWithContent(dialog.view, new Size(80, 24));
    const buttons = testApp.querySelectorAll("ButtonElement") as ButtonElement[];
    return { dialog, testApp, buttons };
}

function sendToFocused(testApp: TestApp, key: string): void {
    testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key }));
}

describe("ConfirmDialog", () => {
    it("renders the title, message and button labels", () => {
        const { testApp } = mount({ message: ["line one", "line two"] });
        testApp.render();
        const screen = testApp.backend.screenToString();
        expect(screen).toContain("Delete");
        expect(screen).toContain("line one");
        expect(screen).toContain("line two");
        expect(screen).toContain("Move to Trash");
        expect(screen).toContain("Cancel");
    });

    it("focusDefault focuses Cancel by default", () => {
        const { dialog, testApp, buttons } = mount();
        dialog.focusDefault();
        expect(testApp.focusedElement).toBe(buttons[1]);
        expect(buttons[1].getLabel()).toBe("Cancel");
    });

    it("focusDefault focuses Confirm when requested", () => {
        const { dialog, testApp, buttons } = mount({ defaultButton: "confirm" });
        dialog.focusDefault();
        expect(testApp.focusedElement).toBe(buttons[0]);
    });

    it("Enter on the confirm button fires onConfirm", () => {
        const { dialog, testApp, buttons } = mount();
        const onConfirm = vi.fn();
        dialog.onConfirm = onConfirm;
        buttons[0].focus();
        sendToFocused(testApp, "Enter");
        expect(onConfirm).toHaveBeenCalledOnce();
    });

    it("Escape fires onCancel", () => {
        const { dialog, testApp } = mount();
        const onCancel = vi.fn();
        dialog.onCancel = onCancel;
        dialog.focusDefault();
        sendToFocused(testApp, "Escape");
        expect(onCancel).toHaveBeenCalledOnce();
    });

    it("Arrow keys move focus between the two buttons", () => {
        const { dialog, testApp, buttons } = mount();
        dialog.focusDefault(); // Cancel (index 1)
        sendToFocused(testApp, "ArrowLeft");
        expect(testApp.focusedElement).toBe(buttons[0]);
        sendToFocused(testApp, "ArrowRight");
        expect(testApp.focusedElement).toBe(buttons[1]);
    });

    it("uses a custom cancel label", () => {
        const { buttons } = mount({ confirmLabel: "Yes", cancelLabel: "No" });
        expect(buttons[0].getLabel()).toBe("Yes");
        expect(buttons[1].getLabel()).toBe("No");
    });

    it("Enter on the cancel button fires onCancel", () => {
        const { dialog, testApp, buttons } = mount();
        const onCancel = vi.fn();
        dialog.onCancel = onCancel;
        buttons[1].focus();
        sendToFocused(testApp, "Enter");
        expect(onCancel).toHaveBeenCalledOnce();
    });

    it("ArrowLeft on the first button and ArrowRight on the last are no-ops", () => {
        const { testApp, buttons } = mount();

        buttons[0].focus();
        sendToFocused(testApp, "ArrowLeft");
        expect(testApp.focusedElement).toBe(buttons[0]);

        buttons[1].focus();
        sendToFocused(testApp, "ArrowRight");
        expect(testApp.focusedElement).toBe(buttons[1]);
    });

    it("highlights the message in the theme's warning color when warning is set", () => {
        const { testApp } = mount({ message: "Danger zone", warning: true });
        testApp.render();

        const rows = testApp.backend.screenToString().split("\n");
        const y = rows.findIndex((row) => row.includes("Danger zone"));
        expect(y).toBeGreaterThanOrEqual(0);
        const x = rows[y].indexOf("Danger zone");

        expect(testApp.backend.getFgAt(new Point(x, y))).toBe(theme.getRequiredColor("editorWarning.foreground"));
    });
});
