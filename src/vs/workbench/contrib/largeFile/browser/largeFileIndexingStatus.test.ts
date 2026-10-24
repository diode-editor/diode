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

import { INDEXING_STATUS_ID, indexingStatusText, LargeFileIndexingStatus } from "./largeFileIndexingStatus.ts";

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

describe("LargeFileIndexingStatus", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-large-file-indexing-status-" });
    });
    afterEach(() => {
        ws.dispose();
    });

    /** The file reports twice its bytes and the pass waits for the test: the first screen is at 50%. */
    function openGated(name = "big.log") {
        const content = bigLog();
        const opener = memoryFileOpener({ size: 2 * Buffer.byteLength(content), gated: true });
        const editor = createEditorPane({
            largeFileOptions: ON_DISK,
            randomAccessFiles: opener,
            file: Uri.file(ws.writeFile(name, content)),
        });
        return { editor, file: opener.opened[0] };
    }

    function setup(initial: TextEditorPane | null) {
        const editors = fakeEditors(initial);
        const statusBar = new StatusBarService(NULL_STATE_SERVICE);
        const status = new LargeFileIndexingStatus(editors.service, statusBar);
        const entry = () => statusBar.entries().find((candidate) => candidate.id === INDEXING_STATUS_ID) ?? null;
        return { ...editors, statusBar, status, entry };
    }

    it("shows the percentage of the active document's index and goes away when the pass ends", async () => {
        const { editor, file } = openGated();
        const { entry, status } = setup(editor);
        expect(entry()).toMatchObject({ text: "Indexing 50%", alignment: "left" });
        expect(entry()?.name).toBeUndefined();

        file.release();
        await new Promise((resolve) => setImmediate(resolve));
        expect(editor.fileModel?.diskIndexing?.done).toBe(true);
        expect(entry()).toBeNull();
        status.dispose();
        editor.dispose();
    });

    it("follows the active editor: an in-memory file, a detached pane or no editor hide it", () => {
        const big = openGated();
        const small = createEditorPane({ file: Uri.file(ws.writeFile("small.log", "one")) });
        const { entry, activate, status } = setup(null);
        expect(entry()).toBeNull();

        activate(big.editor);
        expect(entry()?.text).toBe("Indexing 50%");
        activate(small);
        expect(entry()).toBeNull();
        activate(big.editor);
        expect(entry()?.text).toBe("Indexing 50%");
        big.editor.detached = true;
        activate(big.editor);
        expect(entry()).toBeNull();
        activate(null);
        expect(entry()).toBeNull();

        status.dispose();
        big.editor.dispose();
        small.dispose();
    });

    it("dispose removes the entry and stops following the model", async () => {
        const { editor, file } = openGated();
        const { entry, status, statusBar } = setup(editor);
        expect(entry()).not.toBeNull();
        let changes = 0;
        statusBar.onDidChangeEntries(() => changes++);
        status.dispose();
        expect(entry()).toBeNull();
        expect(changes).toBe(1);
        file.release();
        await new Promise((resolve) => setImmediate(resolve));
        expect(changes).toBe(1);
        editor.dispose();
    });

    it("repaints only when the percentage moves, updating the one entry in place", () => {
        const progress = new Emitter<void>();
        let indexing = { indexedBytes: 10, totalBytes: 1000, done: false };
        const model = {
            onDidChangeDiskIndexing: progress.event,
            get diskIndexing() {
                return indexing;
            },
        };
        const editor = { detached: false, fileModel: model } as unknown as TextEditorPane;
        const { entry, status, statusBar } = setup(editor);
        let changes = 0;
        statusBar.onDidChangeEntries(() => changes++);
        expect(entry()?.text).toBe("Indexing 1%");

        // Still 1%: the bar is left alone.
        indexing = { indexedBytes: 15, totalBytes: 1000, done: false };
        progress.fire();
        expect(changes).toBe(0);

        indexing = { indexedBytes: 500, totalBytes: 1000, done: false };
        progress.fire();
        expect(changes).toBe(1);
        expect(entry()?.text).toBe("Indexing 50%");
        expect(statusBar.entries().filter((candidate) => candidate.id === INDEXING_STATUS_ID)).toHaveLength(1);
        status.dispose();
    });

    it("indexingStatusText floors the percentage and treats an empty file as done", () => {
        expect(indexingStatusText(0, 100)).toBe("Indexing 0%");
        expect(indexingStatusText(999, 1000)).toBe("Indexing 99%");
        expect(indexingStatusText(1000, 1000)).toBe("Indexing 100%");
        expect(indexingStatusText(5, 0)).toBe("Indexing 100%");
        // 0/0 would be NaN.
        expect(indexingStatusText(0, 0)).toBe("Indexing 100%");
    });
});
