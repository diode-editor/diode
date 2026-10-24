import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { memoryFileOpener } from "../../../../../TestUtils/memoryRandomAccessFile.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createTestActiveEditorService } from "../../../../../TestUtils/testActiveEditorService.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { MAX_STRING_LENGTH } from "../../../../editor/common/model/diskTextBuffer.ts";
import type { ILargeFileOptions } from "../../../../editor/common/model/largeFileOptions.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { type WorkbenchContextKeys, WorkbenchContextKeysDIToken } from "../../../browser/workbenchContextKeys.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import {
    NotificationService,
    NotificationServiceDIToken,
} from "../../../services/notification/browser/notificationService.ts";

import {
    ENABLE_LARGE_FILE_EDITING_COMMAND_ID,
    LARGE_FILE_ACTIONS,
    TOO_LARGE_TO_EDIT_MESSAGE,
} from "./largeFileActions.ts";

const TINY: ILargeFileOptions = { largeFileOptimizations: true, sizeThresholdMb: 1, lineCountThreshold: 2 };

class FakeContextKeys {
    public updates = 0;
    public update(): void {
        this.updates++;
    }
}

describe("workbench.action.files.enableLargeFileEditing", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-large-file-actions-" });
    });
    afterEach(() => {
        ws.dispose();
    });

    function setup(editor: TextEditorPane | null) {
        const commands = new CommandRegistry();
        const contextKeys = new FakeContextKeys();
        const accessor = new Container();
        accessor.bind(EditorServiceDIToken, () => createTestActiveEditorService(editor));
        accessor.bind(WorkbenchContextKeysDIToken, () => contextKeys as unknown as WorkbenchContextKeys);
        const notifications = new NotificationService();
        accessor.bind(NotificationServiceDIToken, () => notifications);
        for (const action of LARGE_FILE_ACTIONS) registerAction(commands, new KeybindingRegistry(), accessor, action);
        return { commands, contextKeys, notifications };
    }

    function open(content: string): TextEditorPane {
        return createEditorPane({ largeFileOptions: TINY, file: Uri.file(ws.writeFile("doc.txt", content)) });
    }

    it("leaves the large-file mode of the active editor and recomputes the context keys", () => {
        const editor = open("1\n2\n3");
        const { commands, contextKeys } = setup(editor);
        expect(editor.readOnly).toBe(true);

        commands.execute(ENABLE_LARGE_FILE_EDITING_COMMAND_ID);

        expect(editor.model.isTooLargeForTokenization).toBe(false);
        expect(editor.readOnly).toBe(false);
        expect(contextKeys.updates).toBe(1);
        editor.dispose();
    });

    it("an ordinary file, a detached pane, no editor: a silent no-op", () => {
        const small = open("1");
        const { commands, contextKeys } = setup(small);
        commands.execute(ENABLE_LARGE_FILE_EDITING_COMMAND_ID);
        expect(contextKeys.updates).toBe(0);
        small.dispose();

        const detached = open("1\n2\n3");
        detached.detached = true;
        const detachedSetup = setup(detached);
        detachedSetup.commands.execute(ENABLE_LARGE_FILE_EDITING_COMMAND_ID);
        expect(detached.model.isTooLargeForTokenization).toBe(true);
        expect(detachedSetup.contextKeys.updates).toBe(0);
        detached.dispose();

        const none = setup(null);
        expect(() => none.commands.execute(ENABLE_LARGE_FILE_EDITING_COMMAND_ID)).not.toThrow();
    });

    it("a document on disk that no string can hold: the command warns and the tab stays read-only", () => {
        const editor = createEditorPane({
            largeFileOptions: { largeFileOptimizations: true, sizeThresholdMb: 1, lineCountThreshold: 1e6 },
            randomAccessFiles: memoryFileOpener({ size: MAX_STRING_LENGTH + 1 }),
            file: Uri.file(ws.writeFile("huge.log", "x".repeat(1024 * 1024 + 1))),
        });
        const { commands, contextKeys, notifications } = setup(editor);
        commands.execute(ENABLE_LARGE_FILE_EDITING_COMMAND_ID);
        expect(editor.readOnly).toBe(true);
        expect(contextKeys.updates).toBe(0);
        expect(notifications.passive()).toMatchObject([{ severity: "warn", message: TOO_LARGE_TO_EDIT_MESSAGE }]);
        editor.dispose();
    });
});
