import { describe, expect, it, vi } from "vitest";

import { Size } from "../../../../../../tuidom/common/geometryPromitives.ts";
import { BodyElement } from "../../../../../../tuidom/ui/body/bodyElement.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { DialogService } from "../../dialogs/browser/dialogService.ts";
import { darkPlusTheme } from "../../themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../themes/common/themeService.ts";

import type { IShutdownDirtyItem } from "./lifecycleService.ts";
import { LifecycleService } from "./lifecycleService.ts";

function makeServices() {
    const body = new BodyElement();
    const testApp = TestApp.create(body, new Size(80, 24));
    const dialogService = new DialogService();
    dialogService.attachHost(body);
    testApp.render();
    const lifecycle = new LifecycleService(dialogService);
    return { testApp, dialogService, lifecycle };
}

function dirtyItem(name: string, overrides: Partial<IShutdownDirtyItem> = {}): IShutdownDirtyItem {
    return {
        name,
        isStillDirty: () => true,
        save: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

describe("LifecycleService", () => {
    it("без участников (или без грязных элементов) зовёт onQuit синхронно", async () => {
        const { lifecycle } = makeServices();
        const onQuit = vi.fn();

        const request = lifecycle.requestQuit(onQuit);

        // До первого await: чистый выход не откладывается на микротаск.
        expect(onQuit).toHaveBeenCalledOnce();
        await request;
    });

    it("участник без грязных элементов не показывает диалогов", async () => {
        const { dialogService, lifecycle } = makeServices();
        const onQuit = vi.fn();
        lifecycle.registerShutdownParticipant({ collectDirty: () => [] });

        await lifecycle.requestQuit(onQuit);

        expect(dialogService.getOpenConfirmSaveDialog()).toBeNull();
        expect(onQuit).toHaveBeenCalledOnce();
    });

    it("Save сохраняет элемент и продолжает; последний ответ ведёт к onQuit", async () => {
        const { dialogService, lifecycle } = makeServices();
        const onQuit = vi.fn();
        const first = dirtyItem("a.txt");
        const second = dirtyItem("b.txt");
        lifecycle.registerShutdownParticipant({ collectDirty: () => [first, second] });

        const request = lifecycle.requestQuit(onQuit);

        dialogService.getOpenConfirmSaveDialog()!.onSave?.();
        await vi.waitFor(() => {
            expect(dialogService.getOpenConfirmSaveDialog()).not.toBeNull();
        });
        expect(first.save).toHaveBeenCalledOnce();
        expect(onQuit).not.toHaveBeenCalled();

        dialogService.getOpenConfirmSaveDialog()!.onDontSave?.();
        await request;

        expect(second.save).not.toHaveBeenCalled();
        expect(onQuit).toHaveBeenCalledOnce();
    });

    it("Cancel прерывает выход: onQuit не зовётся, остальных не спрашивают", async () => {
        const { dialogService, lifecycle } = makeServices();
        const onQuit = vi.fn();
        const second = dirtyItem("b.txt");
        lifecycle.registerShutdownParticipant({ collectDirty: () => [dirtyItem("a.txt"), second] });

        const request = lifecycle.requestQuit(onQuit);
        dialogService.getOpenConfirmSaveDialog()!.onCancel?.();
        await request;

        expect(onQuit).not.toHaveBeenCalled();
        expect(dialogService.getOpenConfirmSaveDialog()).toBeNull();
    });

    it("пропускает элементы, ставшие неактуальными, пока пользователь отвечал", async () => {
        const { dialogService, lifecycle } = makeServices();
        const onQuit = vi.fn();
        let secondStillDirty = true;
        const second = dirtyItem("b.txt", { isStillDirty: () => secondStillDirty });
        lifecycle.registerShutdownParticipant({ collectDirty: () => [dirtyItem("a.txt"), second] });

        const request = lifecycle.requestQuit(onQuit);
        // Пока открыт диалог по a.txt, b.txt перестаёт быть грязным (вкладку закрыли).
        secondStillDirty = false;
        dialogService.getOpenConfirmSaveDialog()!.onDontSave?.();
        await request;

        expect(second.save).not.toHaveBeenCalled();
        expect(onQuit).toHaveBeenCalledOnce();
    });

    it("опрашивает участников по очереди", async () => {
        const { dialogService, lifecycle } = makeServices();
        const onQuit = vi.fn();
        lifecycle.registerShutdownParticipant({ collectDirty: () => [dirtyItem("a.txt")] });
        lifecycle.registerShutdownParticipant({ collectDirty: () => [dirtyItem("b.txt")] });

        const request = lifecycle.requestQuit(onQuit);

        dialogService.getOpenConfirmSaveDialog()!.onDontSave?.();
        await vi.waitFor(() => {
            expect(dialogService.getOpenConfirmSaveDialog()).not.toBeNull();
        });
        dialogService.getOpenConfirmSaveDialog()!.onDontSave?.();
        await request;

        expect(onQuit).toHaveBeenCalledOnce();
    });
});
