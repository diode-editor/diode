import { afterEach, describe, expect, it, vi } from "vitest";

import type * as async from "../../../../base/common/async.ts";
import type { IdleDeadline } from "../../../../base/common/async.ts";
import { CancellationTokenSource } from "../../../../base/common/cancellation.ts";
import type { IColorInformation } from "../../../common/languages/iColorSource.ts";
import { TextDocument } from "../../../common/model/textDocument.ts";

import { COLOR_SCAN_BATCH_LINES, DefaultDocumentColorProvider } from "./defaultDocumentColorProvider.ts";

/** Idle slices the test hands out by hand, each with the time it has left. */
const slices: ((idle: IdleDeadline) => void)[] = [];

vi.mock("../../../../base/common/async.ts", async (importOriginal) => ({
    ...(await importOriginal<typeof async>()),
    runWhenGlobalIdle: (callback: (idle: IdleDeadline) => void) => {
        slices.push(callback);
        return { dispose: () => {} };
    },
}));

async function runSlice(timeRemaining: number): Promise<void> {
    await vi.waitFor(() => {
        expect(slices).not.toHaveLength(0);
    });
    slices.shift()!({ didTimeout: true, timeRemaining: () => timeRemaining });
}

/** Colors on the first line, the first line of the second batch and the last line. */
function document(): TextDocument {
    const lines = Array.from({ length: 2 * COLOR_SCAN_BATCH_LINES + 1 }, () => "x");
    lines[0] = "#f00";
    lines[COLOR_SCAN_BATCH_LINES] = "a #0f0";
    lines[2 * COLOR_SCAN_BATCH_LINES] = "b rgb(0, 0, 255)";
    return new TextDocument(lines.join("\n"));
}

function scan(doc: TextDocument, token = new CancellationTokenSource().token): Promise<IColorInformation[] | null> {
    return new DefaultDocumentColorProvider().provideDocumentColors(
        { uri: "file:///a.txt", languageId: "plaintext", versionId: doc.versionId, document: doc },
        token,
    );
}

function starts(colors: IColorInformation[] | null): unknown {
    return colors?.map((color) => [color.range.start, color.range.end]);
}

describe("DefaultDocumentColorProvider", () => {
    afterEach(() => {
        slices.length = 0;
    });

    it("a slice with time left scans every batch, in document coordinates", async () => {
        const doc = document();
        const result = scan(doc);
        await runSlice(10);

        expect(starts(await result)).toEqual([
            [
                { line: 0, character: 0 },
                { line: 0, character: 4 },
            ],
            [
                { line: COLOR_SCAN_BATCH_LINES, character: 2 },
                { line: COLOR_SCAN_BATCH_LINES, character: 6 },
            ],
            [
                { line: 2 * COLOR_SCAN_BATCH_LINES, character: 2 },
                { line: 2 * COLOR_SCAN_BATCH_LINES, character: 16 },
            ],
        ]);
        expect(slices).toEqual([]);
    });

    it("a slice out of time yields after one batch and the next slice goes on", async () => {
        const doc = document();
        let done = false;
        const result = scan(doc).then((colors) => {
            done = true;
            return colors;
        });
        await runSlice(0);
        await runSlice(0);
        expect(done).toBe(false);
        await runSlice(0);

        expect(await result).toHaveLength(3);
    });

    it("a cancelled request stops between slices and answers null", async () => {
        const source = new CancellationTokenSource();
        const result = scan(document(), source.token);
        await runSlice(0);
        source.cancel();
        await runSlice(0);

        expect(await result).toBeNull();
        expect(slices).toEqual([]);
    });

    it("an edit between slices stops the scan: the lines it would read have moved", async () => {
        const doc = document();
        const result = scan(doc);
        await runSlice(0);
        doc.applyEdits([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: " " }]);
        await runSlice(0);

        expect(await result).toBeNull();
    });

    it("an empty document has one line and is scanned like any other", async () => {
        const result = scan(new TextDocument(""));
        await runSlice(0);

        expect(await result).toEqual([]);
    });
});
