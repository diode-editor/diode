import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../TestUtils/testConfigurationService.ts";
import { flushMicrotasks } from "../../../TestUtils/timing.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import {
    ENABLE_EDITING_LABEL,
    ENABLE_LARGE_FILE_EDITING_COMMAND_ID,
} from "../contrib/largeFile/browser/largeFileActions.ts";
import { LARGE_FILE_MESSAGE } from "../contrib/largeFile/browser/largeFileOptimizationsWarner.ts";
import { NotificationServiceDIToken } from "../services/notification/browser/notificationService.ts";

/**
 * The seams the unit tests can't see by design: the setting reaches the model, the tab is read-only
 * for the command system (`editorReadonly`), the toast is on the frame, and both doors out work.
 */
describe("Workbench — the large-file mode", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-large-file-wb-",
            files: { "big.log": "one\ntwo\nthree\nfour", "small.log": "one" },
        });
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            size: new Size(100, 30),
            configurationService: createTestConfigurationService({ "editor.largeFileLineCountThreshold": 3 }),
        });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function contextKeys() {
        return h.container.get(ContextKeyServiceDIToken);
    }

    function screen(): string {
        h.testApp.render();
        return h.testApp.backend.screenToString();
    }

    it("above the configured threshold: read-only tab, editorReadonly, the toast with the button", () => {
        h.workbench.openFile(ws.path("big.log"));
        h.workbench.focusEditor();
        const editor = h.activeEditor();

        expect(editor.isTooLargeForTokenization).toBe(true);
        expect(editor.readOnly).toBe(true);
        expect(contextKeys().get("editorReadonly")).toBe(true);
        editor.viewState.type("x");
        expect(editor.getText()).toBe("one\ntwo\nthree\nfour");

        const notifications = h.container.get(NotificationServiceDIToken);
        expect(notifications.current()?.message).toBe(`big.log: ${LARGE_FILE_MESSAGE}`);
        const text = screen();
        expect(text).toContain("big.log: opened read-only");
        expect(text).toContain(ENABLE_EDITING_LABEL);
    });

    it("the toast's button: the tab becomes writable and the command system sees it", async () => {
        h.workbench.openFile(ws.path("big.log"));
        h.workbench.focusEditor();
        const notifications = h.container.get(NotificationServiceDIToken);

        notifications.answer(notifications.current()!.id, 0);
        await flushMicrotasks();

        const editor = h.activeEditor();
        expect(editor.readOnly).toBe(false);
        expect(contextKeys().get("editorReadonly")).toBe(false);
        editor.viewState.type("x");
        expect(editor.getText()).toBe("xone\ntwo\nthree\nfour");
        expect(notifications.isEmpty()).toBe(true);
    });

    it("the command from the palette is the same door", () => {
        h.workbench.openFile(ws.path("big.log"));
        h.workbench.focusEditor();
        expect(contextKeys().get("editorReadonly")).toBe(true);

        h.commands.execute(ENABLE_LARGE_FILE_EDITING_COMMAND_ID);

        expect(h.activeEditor().readOnly).toBe(false);
        expect(contextKeys().get("editorReadonly")).toBe(false);
    });

    it("below the threshold: nothing of this", () => {
        h.workbench.openFile(ws.path("small.log"));
        h.workbench.focusEditor();

        expect(h.activeEditor().readOnly).toBe(false);
        expect(contextKeys().get("editorReadonly")).toBe(false);
        expect(h.container.get(NotificationServiceDIToken).isEmpty()).toBe(true);
    });
});
