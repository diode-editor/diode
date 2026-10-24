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
import type { IRandomAccessFileOpener } from "../../../../platform/files/common/iRandomAccessFile.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { type WorkbenchContextKeys, WorkbenchContextKeysDIToken } from "../../../browser/workbenchContextKeys.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import {
    NotificationService,
    NotificationServiceDIToken,
} from "../../../services/notification/browser/notificationService.ts";

import {
    ENABLE_EDITING_REFUSALS,
    ENABLE_LARGE_FILE_EDITING_COMMAND_ID,
    LARGE_FILE_ACTIONS,
    TOGGLE_FOLLOW_TAIL_COMMAND_ID,
} from "./largeFileActions.ts";

/** Above 1 MiB the file stays on disk; the line axis is left alone. */
const ON_DISK: ILargeFileOptions = { largeFileOptimizations: true, sizeThresholdMb: 1, lineCountThreshold: 1e6 };

/** ~1.5 MiB of numbered lines: above the size threshold of {@link ON_DISK}. */
function bigLog(): string {
    return Array.from({ length: 30_000 }, (_, i) => `${String(i)} INFO worker request handled path=/api/v1/items`).join(
        "\n",
    );
}

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

    it("leaves the large-file mode of the active editor and recomputes the context keys", async () => {
        const editor = open("1\n2\n3");
        const { commands, contextKeys } = setup(editor);
        expect(editor.readOnly).toBe(true);

        await commands.execute(ENABLE_LARGE_FILE_EDITING_COMMAND_ID);

        expect(editor.model.isTooLargeForTokenization).toBe(false);
        expect(editor.readOnly).toBe(false);
        expect(contextKeys.updates).toBe(1);
        editor.dispose();
    });

    it("an ordinary file, a detached pane, no editor: a silent no-op", async () => {
        const small = open("1");
        const { commands, contextKeys } = setup(small);
        await commands.execute(ENABLE_LARGE_FILE_EDITING_COMMAND_ID);
        expect(contextKeys.updates).toBe(0);
        small.dispose();

        const detached = open("1\n2\n3");
        detached.detached = true;
        const detachedSetup = setup(detached);
        await detachedSetup.commands.execute(ENABLE_LARGE_FILE_EDITING_COMMAND_ID);
        expect(detached.model.isTooLargeForTokenization).toBe(true);
        expect(detachedSetup.contextKeys.updates).toBe(0);
        detached.dispose();

        const none = setup(null);
        expect(() => none.commands.execute(ENABLE_LARGE_FILE_EDITING_COMMAND_ID)).not.toThrow();
    });

    it("a document on disk streams into memory: the tab becomes editable, the keys recompute, no toast", async () => {
        const editor = createEditorPane({
            largeFileOptions: ON_DISK,
            randomAccessFiles: memoryFileOpener(),
            file: Uri.file(ws.writeFile("big.log", bigLog())),
        });
        const { commands, contextKeys, notifications } = setup(editor);
        expect(editor.fileModel?.isOnDisk).toBe(true);
        await commands.execute(ENABLE_LARGE_FILE_EDITING_COMMAND_ID);
        expect(editor.fileModel?.isOnDisk).toBe(false);
        expect(editor.readOnly).toBe(false);
        expect(contextKeys.updates).toBe(1);
        expect(notifications.passive()).toEqual([]);
        editor.dispose();
    });

    it("each refusal of the model is a warning toast of its own, and the tab stays read-only", async () => {
        const cases = [
            { reason: "too-large", randomAccessFiles: memoryFileOpener({ size: MAX_STRING_LENGTH + 1 }) },
            { reason: "out-of-memory", randomAccessFiles: memoryFileOpener(), memory: { availableBytes: () => 0 } },
            { reason: "read-failed", randomAccessFiles: refusingSecondOpen() },
        ] as const;
        for (const { reason, ...overrides } of cases) {
            const editor = createEditorPane({
                largeFileOptions: ON_DISK,
                ...overrides,
                file: Uri.file(ws.writeFile("huge.log", bigLog())),
            });
            const { commands, contextKeys, notifications } = setup(editor);
            await commands.execute(ENABLE_LARGE_FILE_EDITING_COMMAND_ID);
            expect(editor.readOnly).toBe(true);
            expect(contextKeys.updates).toBe(0);
            // A warning without buttons: there is nothing to retry from the toast.
            expect(notifications.passive()).toMatchObject([
                { severity: "warn", message: ENABLE_EDITING_REFUSALS[reason], items: [] },
            ]);
            editor.dispose();
        }
    });

    it("a load cancelled by a reload of the file says nothing", async () => {
        const opener = memoryFileOpener({ gated: true });
        const path = ws.writeFile("big.log", bigLog());
        const editor = createEditorPane({ largeFileOptions: ON_DISK, randomAccessFiles: opener, file: Uri.file(path) });
        const { commands, contextKeys, notifications } = setup(editor);
        const run = commands.execute(ENABLE_LARGE_FILE_EDITING_COMMAND_ID) as Promise<void>;
        // The reload reopens the document on disk; the pending stream read finds itself stale.
        editor.fileModel?.revertToDisk();
        for (const file of opener.opened) file.openGate();
        await run;
        expect(editor.readOnly).toBe(true);
        expect(contextKeys.updates).toBe(0);
        expect(notifications.passive()).toEqual([]);
        editor.dispose();
    });
});

/** Opens the first time (the document on disk) and refuses the second (the stream), as a file whose mode changed. */
function refusingSecondOpen(): IRandomAccessFileOpener {
    const opener = memoryFileOpener();
    return {
        open: (path) => {
            if (opener.opened.length > 0)
                throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
            return opener.open(path);
        },
    };
}

describe("workbench.action.editor.toggleFollowTail", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-toggle-follow-tail-" });
    });
    afterEach(() => {
        ws.dispose();
    });

    function setup(editor: TextEditorPane | null) {
        const commands = new CommandRegistry();
        const accessor = new Container();
        accessor.bind(EditorServiceDIToken, () => createTestActiveEditorService(editor));
        for (const action of LARGE_FILE_ACTIONS) registerAction(commands, new KeybindingRegistry(), accessor, action);
        return commands;
    }

    function openOnDisk(): TextEditorPane {
        const line = "2026-01-01T00:00:00.000Z INFO worker request handled path=/api/v1/items";
        const content = Array.from({ length: 18_000 }, (_, i) => `${String(i)} ${line}`).join("\n") + "\n";
        return createEditorPane({
            largeFileOptions: { largeFileOptimizations: true, sizeThresholdMb: 1, lineCountThreshold: 1e6 },
            randomAccessFiles: memoryFileOpener(),
            file: Uri.file(ws.writeFile("big.log", content)),
        });
    }

    it("toggles follow of the active document on disk: on moves the cursor to the end, off leaves it", () => {
        const editor = openOnDisk();
        const commands = setup(editor);
        // The palette shows the title; menus and the status bar the short one.
        expect(commands.getTitle(TOGGLE_FOLLOW_TAIL_COMMAND_ID)).toBe("File: Toggle Follow Tail of Large File");
        expect(LARGE_FILE_ACTIONS.find((action) => action.id === TOGGLE_FOLLOW_TAIL_COMMAND_ID)?.shortTitle).toBe(
            "Toggle Follow Tail",
        );
        expect(editor.viewState.followTail).toBe(false);

        commands.execute(TOGGLE_FOLLOW_TAIL_COMMAND_ID);
        expect(editor.viewState.followTail).toBe(true);
        expect(editor.viewState.selections[0].active.line).toBe(editor.model.document.lineCount - 1);

        commands.execute(TOGGLE_FOLLOW_TAIL_COMMAND_ID);
        expect(editor.viewState.followTail).toBe(false);
        expect(editor.viewState.selections[0].active.line).toBe(editor.model.document.lineCount - 1);
        editor.dispose();
    });

    it("a document in memory, a detached pane, no editor: a silent no-op", () => {
        const small = createEditorPane({ file: Uri.file(ws.writeFile("small.log", "1\n2\n3")) });
        setup(small).execute(TOGGLE_FOLLOW_TAIL_COMMAND_ID);
        expect(small.viewState.followTail).toBe(false);
        expect(small.viewState.selections[0].active.line).toBe(0);
        small.dispose();

        const detached = openOnDisk();
        detached.detached = true;
        setup(detached).execute(TOGGLE_FOLLOW_TAIL_COMMAND_ID);
        expect(detached.viewState.followTail).toBe(false);
        detached.dispose();

        expect(() => setup(null).execute(TOGGLE_FOLLOW_TAIL_COMMAND_ID)).not.toThrow();

        // A synthetic buffer (Output, a virtual document) has no file model.
        const synthetic = { detached: false, fileModel: null } as unknown as TextEditorPane;
        expect(() => setup(synthetic).execute(TOGGLE_FOLLOW_TAIL_COMMAND_ID)).not.toThrow();
    });
});
