import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import {
    KeybindingRegistryDIToken,
    parseKeybinding,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";

import { QuickInputServiceDIToken } from "./quickInputService.ts";

/**
 * A modal dialog over an open picker owns the keyboard: upstream's dialog stops every keydown at the window in the
 * capture phase, so no keybinding reaches the picker behind it. An unrelated binding is already swallowed here.
 */
describe("user bindings on quick input commands behind a modal dialog", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(async () => {
        ws = createTempWorkspace({ prefix: "diode-qi-modal-", files: { "alpha.txt": "Alpha" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(80, 24) });
        await h.workbench.activate();
        await h.workbench.fileIndexReady;
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function screen(): string {
        h.testApp.render();
        return h.testApp.backend.screenToString();
    }

    function bind(key: string, command: string): void {
        h.container.get(KeybindingRegistryDIToken).register(parseKeybinding(key), command, undefined, "user");
    }

    async function openPickerUnderModal(): Promise<{ settled: () => boolean }> {
        let settled = false;
        void h.container
            .get(QuickInputServiceDIToken)
            .quickPick({ items: [{ label: "under-one" }, { label: "under-two" }] })
            .then(() => {
                settled = true;
            });
        h.container.get(NotificationServiceDIToken).show({
            severity: "warn",
            message: "Modal question",
            modal: true,
            items: ["Yes"],
        });
        await flushMicrotasks();
        expect(screen()).toContain("Modal question");
        expect(settled).toBe(false);
        return { settled: () => settled };
    }

    it("accept does not answer the picker hidden behind the dialog", async () => {
        bind("f7", "workbench.action.acceptSelectedQuickOpenItem");
        const picker = await openPickerUnderModal();
        h.testApp.sendKey("F7");
        await flushMicrotasks();
        expect(picker.settled()).toBe(false);
        expect(screen()).toContain("under-one");
    });

    it("close does not close the picker hidden behind the dialog", async () => {
        bind("f8", "workbench.action.closeQuickOpen");
        const picker = await openPickerUnderModal();
        h.testApp.sendKey("F8");
        await flushMicrotasks();
        expect(picker.settled()).toBe(false);
        expect(screen()).toContain("under-one");
    });
});
