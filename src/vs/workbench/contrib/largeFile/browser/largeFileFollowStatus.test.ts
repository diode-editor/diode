import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { memoryFileOpener } from "../../../../../TestUtils/memoryRandomAccessFile.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ILargeFileOptions } from "../../../../editor/common/model/largeFileOptions.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";

import { FOLLOW_OFF_TEXT, FOLLOW_ON_TEXT, FOLLOW_STATUS_ID, LargeFileFollowStatus } from "./largeFileFollowStatus.ts";

const ON_DISK: ILargeFileOptions = { largeFileOptimizations: true, sizeThresholdMb: 1, lineCountThreshold: 1_000_000 };

/** ~1.5 MiB: above the 1 MiB threshold of {@link ON_DISK}. */
function bigLog(): string {
    const line = "2026-01-01T00:00:00.000Z INFO worker request handled path=/api/v1/items";
    return Array.from({ length: 18_000 }, (_, i) => `${String(i)} ${line}`).join("\n") + "\n";
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

describe("LargeFileFollowStatus", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-large-file-follow-status-" });
    });
    afterEach(() => {
        ws.dispose();
    });

    function openOnDisk(name = "big.log"): TextEditorPane {
        return createEditorPane({
            largeFileOptions: ON_DISK,
            randomAccessFiles: memoryFileOpener(),
            file: Uri.file(ws.writeFile(name, bigLog())),
        });
    }

    function setup(initial: TextEditorPane | null) {
        const editors = fakeEditors(initial);
        const statusBar = new StatusBarService(NULL_STATE_SERVICE);
        const status = new LargeFileFollowStatus(editors.service, statusBar);
        const entry = () => statusBar.entries().find((candidate) => candidate.id === FOLLOW_STATUS_ID) ?? null;
        return { ...editors, statusBar, status, entry };
    }

    it("shows the follow state of the active document on disk and tracks the cursor", () => {
        const editor = openOnDisk();
        const { entry, status } = setup(editor);
        // The literal texts and id: the e2e scenario and the user read them.
        expect(entry()).toMatchObject({
            id: "status.largeFile.followTail",
            text: "Follow: Off",
            alignment: "right",
            name: "Follow Tail",
        });

        editor.viewState.cursorBottom();
        expect(entry()?.text).toBe("Follow: On");
        editor.viewState.cursorUp();
        expect(entry()?.text).toBe(FOLLOW_OFF_TEXT);
        status.dispose();
        editor.dispose();
    });

    it("a click toggles: on puts the cursor at the end, off leaves it there", () => {
        const editor = openOnDisk();
        const { entry, status } = setup(editor);
        entry()?.onClick?.();
        expect(editor.viewState.followTail).toBe(true);
        expect(editor.viewState.selections[0].active.line).toBe(editor.model.document.lineCount - 1);
        expect(entry()?.text).toBe(FOLLOW_ON_TEXT);

        entry()?.onClick?.();
        expect(editor.viewState.followTail).toBe(false);
        expect(editor.viewState.selections[0].active.line).toBe(editor.model.document.lineCount - 1);
        expect(entry()?.text).toBe(FOLLOW_OFF_TEXT);
        status.dispose();
        editor.dispose();
    });

    it("follows the active editor: an in-memory file, a detached pane or no editor hide it; a new editor gets its own entry", () => {
        const big = openOnDisk();
        const other = openOnDisk("other.log");
        const small = createEditorPane({ file: Uri.file(ws.writeFile("small.log", "one")) });
        const { entry, activate, status } = setup(null);
        expect(entry()).toBeNull();

        activate(big);
        expect(entry()?.text).toBe(FOLLOW_OFF_TEXT);
        activate(small);
        expect(entry()).toBeNull();
        activate(other);
        entry()?.onClick?.();
        expect(other.viewState.followTail).toBe(true);
        expect(big.viewState.followTail).toBe(false);
        activate(big);
        expect(entry()?.text).toBe(FOLLOW_OFF_TEXT);
        big.detached = true;
        activate(big);
        expect(entry()).toBeNull();
        activate(null);
        expect(entry()).toBeNull();

        status.dispose();
        big.dispose();
        other.dispose();
        small.dispose();
    });

    it("switching straight between two documents on disk: the entry and its click belong to the new one", () => {
        const first = openOnDisk();
        const second = openOnDisk("second.log");
        const { entry, activate, status } = setup(first);
        activate(second);
        // The first editor is no longer listened to.
        first.viewState.cursorBottom();
        expect(entry()?.text).toBe(FOLLOW_OFF_TEXT);
        entry()?.onClick?.();
        expect(second.viewState.followTail).toBe(true);
        expect(entry()?.text).toBe(FOLLOW_ON_TEXT);
        status.dispose();
        first.dispose();
        second.dispose();
    });

    it("Enable Editing takes the document off the disk: the entry goes", async () => {
        const editor = openOnDisk();
        const { entry, status } = setup(editor);
        expect(entry()).not.toBeNull();
        expect(await editor.model.enableEditing()).toBeNull();
        expect(editor.fileModel?.isOnDisk).toBe(false);
        expect(entry()).toBeNull();
        status.dispose();
        editor.dispose();
    });

    it("dispose removes the entry and stops following the view", () => {
        const editor = openOnDisk();
        const { entry, status, statusBar } = setup(editor);
        let changes = 0;
        statusBar.onDidChangeEntries(() => changes++);
        status.dispose();
        expect(entry()).toBeNull();
        expect(changes).toBe(1);
        editor.viewState.cursorBottom();
        expect(changes).toBe(1);
        editor.dispose();
    });

    it("updates the one entry in place", () => {
        const editor = openOnDisk();
        const { status, statusBar } = setup(editor);
        editor.viewState.cursorBottom();
        editor.viewState.cursorUp();
        expect(statusBar.entries().filter((candidate) => candidate.id === FOLLOW_STATUS_ID)).toHaveLength(1);
        status.dispose();
        editor.dispose();
    });
});
