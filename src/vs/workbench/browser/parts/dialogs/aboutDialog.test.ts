import { describe, expect, it, vi } from "vitest";

import { Size } from "@tuidom/all/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/all/dom/events/tuiKeyboardEvent";
import type { ButtonElement } from "@tuidom/all/ui/button/buttonElement";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { VEXX_VERSION } from "../../../../base/common/version.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";

import { AboutDialog } from "./aboutDialog.ts";

function mount() {
    const themeService = new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme));
    const dialog = new AboutDialog();
    const testApp = TestApp.createWithContent(dialog.view, new Size(80, 24));
    const okButton = testApp.querySelector("ButtonElement") as ButtonElement;
    return { dialog, testApp, okButton };
}

describe("AboutDialog", () => {
    it("renders the app name, version, Node version and repo url", () => {
        const { testApp } = mount();
        testApp.render();
        const text = testApp.backend.screenToString();
        expect(text).toContain("Vexx");
        expect(text).toContain(`Version ${VEXX_VERSION}`);
        expect(text).toContain(`Node ${process.version}`);
        expect(text).toContain("github.com/tihonove/vexx");
    });

    it("focusDefault focuses the OK button", () => {
        const { dialog, testApp, okButton } = mount();
        dialog.focusDefault();
        expect(testApp.focusedElement).toBe(okButton);
        expect(okButton.getLabel()).toBe("OK");
    });

    it("Escape triggers onClose", () => {
        const { dialog } = mount();
        const onClose = vi.fn();
        dialog.onClose = onClose;
        dialog.focusDefault();

        dialog.view.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Escape" }));

        expect(onClose).toHaveBeenCalledOnce();
    });

    it("ignores other keys", () => {
        const { dialog } = mount();
        const onClose = vi.fn();
        dialog.onClose = onClose;

        dialog.view.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "ArrowDown" }));

        expect(onClose).not.toHaveBeenCalled();
    });

    it("activating the OK button triggers onClose", () => {
        const { dialog, testApp, okButton } = mount();
        const onClose = vi.fn();
        dialog.onClose = onClose;
        okButton.focus();

        testApp.focusedElement?.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));

        expect(onClose).toHaveBeenCalledOnce();
    });
});
