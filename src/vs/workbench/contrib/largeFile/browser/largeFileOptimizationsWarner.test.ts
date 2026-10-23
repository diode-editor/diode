import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ILargeFileOptions } from "../../../../editor/common/model/largeFileOptions.ts";
import type { WorkbenchContextKeys } from "../../../browser/workbenchContextKeys.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { NotificationService } from "../../../services/notification/browser/notificationService.ts";

import { ENABLE_EDITING_LABEL } from "./largeFileActions.ts";
import { LARGE_FILE_MESSAGE, LargeFileOptimizationsWarner } from "./largeFileOptimizationsWarner.ts";

const TINY: ILargeFileOptions = { largeFileOptimizations: true, sizeThresholdMb: 1, lineCountThreshold: 2 };

class FakeContextKeys {
    public updates = 0;
    public update(): void {
        this.updates++;
    }
}

function fakeEditors(initial: TextEditorPane | null) {
    const emitter = new Emitter<TextEditorPane | null>();
    let active = initial;
    const service = {
        getActiveEditor: () => active,
        onActiveEditorChanged: emitter.event,
    } as unknown as IEditorService;
    return {
        service,
        activate: (editor: TextEditorPane | null) => {
            active = editor;
            emitter.fire(editor);
        },
    };
}

describe("LargeFileOptimizationsWarner", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-large-file-warner-" });
    });
    afterEach(() => {
        ws.dispose();
    });

    function open(name: string, content: string): TextEditorPane {
        return createEditorPane({ largeFileOptions: TINY, file: Uri.file(ws.writeFile(name, content)) });
    }

    function setup(initial: TextEditorPane | null) {
        const editors = fakeEditors(initial);
        const notifications = new NotificationService();
        const contextKeys = new FakeContextKeys();
        const warner = new LargeFileOptimizationsWarner(
            editors.service,
            notifications,
            contextKeys as unknown as WorkbenchContextKeys,
        );
        return { ...editors, notifications, contextKeys, warner };
    }

    it("the file active at creation gets the toast: a question with the one button", () => {
        const editor = open("big.log", "1\n2\n3");
        const { notifications } = setup(editor);

        const toast = notifications.current();
        expect(toast?.severity).toBe("info");
        expect(toast?.modal).toBe(false);
        expect(toast?.message).toBe(`big.log: ${LARGE_FILE_MESSAGE}`);
        expect(toast?.items).toEqual([ENABLE_EDITING_LABEL]);
        expect(notifications.passive()).toEqual([]);
        editor.dispose();
    });

    it("the button leaves the mode and recomputes the context keys; closing the toast does not", async () => {
        const editor = open("big.log", "1\n2\n3");
        const { notifications, contextKeys } = setup(editor);
        const toast = notifications.current();

        notifications.dismiss(toast!.id);
        await flushMicrotasks();
        expect(editor.model.isTooLargeForTokenization).toBe(true);
        expect(contextKeys.updates).toBe(0);

        const other = open("other.log", "1\n2\n3");
        const second = setup(other);
        second.notifications.answer(second.notifications.current()!.id, 0);
        await flushMicrotasks();
        expect(other.model.isTooLargeForTokenization).toBe(false);
        expect(other.readOnly).toBe(false);
        expect(second.contextKeys.updates).toBe(1);
        editor.dispose();
        other.dispose();
    });

    it("once per model: a second tab of the same file, or activating it again, is silent", () => {
        const editor = open("big.log", "1\n2\n3");
        const { notifications, activate, warner } = setup(null);
        expect(notifications.isEmpty()).toBe(true);

        activate(editor);
        expect(notifications.queuedCount() + 1).toBe(1);
        activate(null);
        activate(editor);
        expect(notifications.current()).not.toBeNull();
        expect(notifications.queuedCount()).toBe(0);

        warner.dispose();
        editor.dispose();
    });

    it("an ordinary file and a detached pane get nothing", () => {
        const small = open("small.log", "1");
        const { notifications, activate } = setup(small);
        expect(notifications.isEmpty()).toBe(true);

        const detached = open("big.log", "1\n2\n3");
        detached.detached = true;
        activate(detached);
        expect(notifications.isEmpty()).toBe(true);
        small.dispose();
        detached.dispose();
    });
});
