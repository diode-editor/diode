import { type IdleDeadline, runWhenGlobalIdle } from "../../../base/common/async.ts";
import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { ITextDocument } from "../model/iTextDocument.ts";

/** Upstream `_MODEL_SYNC_LIMIT`, in characters. */
export const MODEL_SYNC_LIMIT = 50 * 1024 * 1024;

/** Lines scanned between two looks at the idle deadline. */
export const SCAN_BATCH_LINES = 256;

function nextIdle(): Promise<IdleDeadline> {
    return new Promise((resolve) => runWhenGlobalIdle(resolve));
}

/**
 * What upstream's built-in detectors do in a worker, here in idle slices: neither the first frame of a big file nor a
 * keystroke waits for the scan. `null` — a cancelled request or a newer text stopped it (the answer would be dropped),
 * or the document is above `syncLimit`: upstream's worker never gets such a model, so "Enable Editing" on a huge log
 * does not scan it at all.
 */
export async function scanDocumentInIdleSlices<T>(
    document: ITextDocument,
    versionId: number,
    token: ICancellationToken,
    syncLimit: number,
    scan: (from: number, to: number) => Iterable<T>,
): Promise<T[] | null> {
    if (document.getValueLength() > syncLimit) return null;
    const results: T[] = [];
    let line = 0;
    while (line < document.lineCount) {
        const idle = await nextIdle();
        if (token.isCancellationRequested || document.versionId !== versionId) return null;
        do {
            const to = Math.min(document.lineCount, line + SCAN_BATCH_LINES);
            // Not `push(...)`: a spread of hundreds of thousands of results overflows the call stack.
            for (const result of scan(line, to)) results.push(result);
            line = to;
        } while (line < document.lineCount && idle.timeRemaining() > 0);
    }
    return results;
}
