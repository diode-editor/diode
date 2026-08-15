import { describe, expect, it, vi } from "vitest";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
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
    it("show открывает диалог по центру, колбэки закрывают его", () => {
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

    it("повторный показ переиспользует компонент и обновляет имя файла", () => {
        const { testApp, service } = makeHost();

        service.showConfirmSaveDialog("first.txt", saveCallbacks());
        const first = service.getOpenConfirmSaveDialog();
        first!.onDontSave?.();

        service.showConfirmSaveDialog("second.txt", saveCallbacks());
        testApp.render();

        expect(service.getOpenConfirmSaveDialog()).toBe(first);
        expect(testApp.backend.screenToString()).toContain("second.txt?");
    });

    it("onCancel закрывает диалог и зовёт колбэк", () => {
        const { service } = makeHost();
        const cb = saveCallbacks();

        service.showConfirmSaveDialog("a.txt", cb);
        service.getOpenConfirmSaveDialog()!.onCancel?.();

        expect(cb.onCancel).toHaveBeenCalledOnce();
        expect(service.getOpenConfirmSaveDialog()).toBeNull();
    });

    it("confirmSave резолвится выбором пользователя", async () => {
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
    it("onConfirm закрывает диалог и зовёт колбэк; элемент уходит из дерева", () => {
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

    it("onCancel зовёт опциональный колбэк, повторный показ заменяет диалог", () => {
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

    it("confirm резолвится true по подтверждению и false по отмене", async () => {
        const { service } = makeHost();

        const confirmed = service.confirm({ title: "Discard", message: "Sure?", confirmLabel: "Discard" });
        service.getOpenConfirmDialog()!.onConfirm?.();
        await expect(confirmed).resolves.toBe(true);

        const cancelled = service.confirm({ title: "Discard", message: "Sure?", confirmLabel: "Discard" });
        service.getOpenConfirmDialog()!.onCancel?.();
        await expect(cancelled).resolves.toBe(false);
    });

    it("dispose сервиса не роняет диалоги, показанные ранее", () => {
        const { service } = makeHost();
        service.showConfirmSaveDialog("a.txt", saveCallbacks());

        expect(() => {
            service.dispose();
        }).not.toThrow();
    });
});

describe("DialogService — about", () => {
    it("показывает, закрывает по onClose и переиспользует компонент", () => {
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

describe("DialogService — до первого показа", () => {
    it("геттеры открытых диалогов отдают null на свежем сервисе", () => {
        const service = new DialogService();

        expect(service.getOpenConfirmSaveDialog()).toBeNull();
        expect(service.getOpenConfirmDialog()).toBeNull();
        expect(service.getOpenAboutDialog()).toBeNull();
    });
});

describe("DialogService — host", () => {
    it("бросает понятную ошибку, если host не прикреплён", () => {
        const service = new DialogService();

        expect(() => {
            service.showAboutDialog();
        }).toThrow(/attachHost/);
    });
});
