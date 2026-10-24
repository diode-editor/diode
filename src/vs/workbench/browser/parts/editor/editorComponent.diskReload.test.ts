import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { DISK_INDEX_CHUNK_SIZE } from "../../../../editor/common/model/diskTextBuffer.ts";
import type { ILargeFileOptions } from "../../../../editor/common/model/largeFileOptions.ts";
import type { IRandomAccessFileOpener } from "../../../../platform/files/common/iRandomAccessFile.ts";
import { nodeRandomAccessFileOpener } from "../../../../platform/files/node/nodeRandomAccessFile.ts";
import type { TextFileModel } from "../../../services/textfile/common/textFileModel.ts";

/** Above 1 MiB the file stays on disk; the line axis is left alone. */
const ON_DISK: ILargeFileOptions = { largeFileOptimizations: true, sizeThresholdMb: 1, lineCountThreshold: 10_000_000 };

const LINE = "2026-01-01T00:00:00.000Z INFO worker request handled path=/api/v1/items";

/** Longer than the first chunk (4 MiB), so the reload has a background pass and the line count grows under the view. */
function writeLog(path: string, bytes: number): number {
    const lines: string[] = [];
    let size = 0;
    for (let i = 0; size < bytes; i++) {
        const line = `${String(i)} ${LINE}\n`;
        lines.push(line);
        size += line.length;
    }
    fs.writeFileSync(path, lines.join(""));
    return lines.length;
}

function indexed(model: TextFileModel): Promise<void> {
    if (model.diskIndexing?.done !== false) return Promise.resolve();
    return new Promise((resolve) => {
        const subscription = model.onDidChangeDiskIndexing(() => {
            if (model.diskIndexing?.done !== true) return;
            subscription.dispose();
            resolve();
        });
    });
}

/**
 * An external change re-opens the document (a reload; follow is OpenPerformance 4.4), and the view keeps
 * its cursor the way it does for the in-memory reload: a cursor past the new end lands on the new end.
 * Found by the live run of PR #799 (QA pass, 2026-10-24).
 */
describe("EditorComponent — the document on disk reloaded after an external change", () => {
    let ws: ITempWorkspace;
    let pane: TextEditorPane<TextFileModel> | null = null;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-disk-reload-" });
    });

    afterEach(() => {
        pane?.dispose();
        pane = null;
        ws.dispose();
    });

    async function openAtEnd(opener: IRandomAccessFileOpener | undefined): Promise<{ path: string; lines: number }> {
        const path = ws.path("huge.log");
        const lines = writeLog(path, DISK_INDEX_CHUNK_SIZE + DISK_INDEX_CHUNK_SIZE / 2);
        pane = createEditorPane({ file: Uri.file(path), largeFileOptions: ON_DISK, randomAccessFiles: opener });
        await indexed(pane.model);
        expect(pane.lineCount).toBe(lines + 1);
        pane.viewState.cursorBottom();
        expect(pane.primaryCursorLine).toBe(lines);
        return { path, lines };
    }

    /**
     * Live run (22 MiB log, cursor on the last line, the file truncated to 21 MiB): after the reload the
     * cursor and the viewport sat on line 50 868 — the last line of the first chunk, where the flush
     * clamped them — and stayed there while the index grew to 262 017 lines. The in-memory reload clamps
     * to the end of the whole file; so must the one on disk.
     */
    it("a cursor on the last line stays on the last line after the file is truncated and reloaded", async () => {
        const { path, lines } = await openAtEnd(nodeRandomAccessFileOpener);
        expect(pane!.fileModel?.isOnDisk).toBe(true);

        // Cut the file in the middle of the second chunk: still above the threshold, still on disk.
        fs.truncateSync(path, DISK_INDEX_CHUNK_SIZE + DISK_INDEX_CHUNK_SIZE / 4);
        expect(pane!.revertToDisk()).toBe(true);
        expect(pane!.fileModel?.isOnDisk).toBe(true);
        await indexed(pane!.model);

        const lineCount = pane!.lineCount;
        expect(lineCount).toBeLessThan(lines);
        expect(pane!.primaryCursorLine).toBe(lineCount - 1);
        expect(pane!.viewState.scrollTop).toBeGreaterThan(0);
        expect(pane!.viewState.scrollTop + pane!.viewState.viewportHeight).toBeGreaterThanOrEqual(lineCount);
    });

    it("the in-memory reload is the reference: the cursor lands on the new last line", async () => {
        const { path, lines } = await openAtEnd(undefined);
        expect(pane!.fileModel?.isOnDisk).toBe(false);

        fs.truncateSync(path, DISK_INDEX_CHUNK_SIZE + DISK_INDEX_CHUNK_SIZE / 4);
        expect(pane!.revertToDisk()).toBe(true);

        const lineCount = pane!.lineCount;
        expect(lineCount).toBeLessThan(lines);
        expect(pane!.primaryCursorLine).toBe(lineCount - 1);
    });
});
