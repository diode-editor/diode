import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../themes/common/themeService.ts";

import { DialogService } from "./dialogService.ts";

function makeHost() {
    const body = new BodyElement();
    const testApp = TestApp.create(body, new Size(80, 24));
    const service = new DialogService();
    service.attachHost(body);
    testApp.render();
    return { body, testApp, service };
}

const saveCallbacks = () => ({ onSave: vi.fn(), onDontSave: vi.fn(), onCancel: vi.fn() });

describe("DialogService — confirm save", () => {
    it("show opens the dialog centered, callbacks close it", () => {
        const { testApp, service } = makeHost();

        service.showConfirmSaveDialog("a.txt", saveCallbacks());
        testApp.render();

        const dialog = service.getOpenConfirmSaveDialog();
        expect(dialog).not.toBeNull();
        expect(testApp.querySelector("#confirmSaveDialog")).not.toBeNull();

        const cb = saveCallbacks();
        service.showConfirmSaveDialog("b.txt", cb);
        dialog!.onSave?.();
        expect(cb.onSave).toHaveBeenCalledOnce();
        expect(service.getOpenConfirmSaveDialog()).toBeNull();
    });

    it("showing again reuses the component and updates the file name", () => {
        const { testApp, service } = makeHost();

        service.showConfirmSaveDialog("first.txt", saveCallbacks());
        const first = service.getOpenConfirmSaveDialog();
        first!.onDontSave?.();

        service.showConfirmSaveDialog("second.txt", saveCallbacks());
        testApp.render();

        expect(service.getOpenConfirmSaveDialog()).toBe(first);
        expect(testApp.backend.screenToString()).toContain("second.txt?");
    });

    it("onCancel closes the dialog and calls the callback", () => {
        const { service } = makeHost();
        const cb = saveCallbacks();

        service.showConfirmSaveDialog("a.txt", cb);
        service.getOpenConfirmSaveDialog()!.onCancel?.();

        expect(cb.onCancel).toHaveBeenCalledOnce();
        expect(service.getOpenConfirmSaveDialog()).toBeNull();
    });

    it("confirmSave resolves with the user choice", async () => {
        const { service } = makeHost();

        const save = service.confirmSave("a.txt");
        service.getOpenConfirmSaveDialog()!.onSave?.();
        await expect(save).resolves.toBe("save");

        const dontSave = service.confirmSave("b.txt");
        service.getOpenConfirmSaveDialog()!.onDontSave?.();
        await expect(dontSave).resolves.toBe("dontSave");

        const cancel = service.confirmSave("c.txt");
        service.getOpenConfirmSaveDialog()!.onCancel?.();
        await expect(cancel).resolves.toBe("cancel");
    });
});

describe("DialogService — confirm", () => {
    it("onConfirm closes the dialog and calls the callback; the element leaves the tree", () => {
        const { testApp, service } = makeHost();
        const onConfirm = vi.fn();

        service.showConfirmDialog({ title: "Delete", message: "Sure?", confirmLabel: "Yes" }, { onConfirm });
        testApp.render();
        expect(testApp.querySelector("#confirmDialog")).not.toBeNull();

        service.getOpenConfirmDialog()!.onConfirm?.();
        testApp.render();

        expect(onConfirm).toHaveBeenCalledOnce();
        expect(service.getOpenConfirmDialog()).toBeNull();
        expect(testApp.querySelector("#confirmDialog")).toBeNull();
    });

    it("onCancel calls the optional callback, showing again replaces the dialog", () => {
        const { service } = makeHost();
        const onCancel = vi.fn();

        service.showConfirmDialog({ title: "A", message: "?", confirmLabel: "Yes" }, { onConfirm: vi.fn(), onCancel });
        const first = service.getOpenConfirmDialog();

        service.showConfirmDialog({ title: "B", message: "?", confirmLabel: "Yes" }, { onConfirm: vi.fn() });
        const second = service.getOpenConfirmDialog();

        expect(second).not.toBe(first);
        second!.onCancel?.();
        expect(onCancel).not.toHaveBeenCalled();
        expect(service.getOpenConfirmDialog()).toBeNull();
    });

    it("confirm resolves true on confirm and false on cancel", async () => {
        const { service } = makeHost();

        const confirmed = service.confirm({ title: "Discard", message: "Sure?", confirmLabel: "Discard" });
        service.getOpenConfirmDialog()!.onConfirm?.();
        await expect(confirmed).resolves.toBe(true);

        const cancelled = service.confirm({ title: "Discard", message: "Sure?", confirmLabel: "Discard" });
        service.getOpenConfirmDialog()!.onCancel?.();
        await expect(cancelled).resolves.toBe(false);
    });

    it("disposing the service does not break dialogs shown earlier", () => {
        const { service } = makeHost();
        service.showConfirmSaveDialog("a.txt", saveCallbacks());

        expect(() => {
            service.dispose();
        }).not.toThrow();
    });
});

describe("DialogService — about", () => {
    it("shows, closes on onClose and reuses the component", () => {
        const { testApp, service } = makeHost();

        service.showAboutDialog();
        testApp.render();
        const dialog = service.getOpenAboutDialog();
        expect(dialog).not.toBeNull();
        expect(testApp.querySelector("#aboutDialog")).not.toBeNull();

        dialog!.onClose?.();
        expect(service.getOpenAboutDialog()).toBeNull();

        service.showAboutDialog();
        expect(service.getOpenAboutDialog()).toBe(dialog);
    });
});

describe("DialogService — before the first show", () => {
    it("open dialog getters return null on a fresh service", () => {
        const service = new DialogService();

        expect(service.getOpenConfirmSaveDialog()).toBeNull();
        expect(service.getOpenConfirmDialog()).toBeNull();
        expect(service.getOpenAboutDialog()).toBeNull();
    });
});

describe("DialogService — host", () => {
    it("throws a clear error if no host is attached", () => {
        const service = new DialogService();

        expect(() => {
            service.showAboutDialog();
        }).toThrow(/attachHost/);
    });
});
