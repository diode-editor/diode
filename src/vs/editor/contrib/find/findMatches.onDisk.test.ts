import { describe, expect, it } from "vitest";

import { MemoryRandomAccessFile } from "../../../../TestUtils/memoryRandomAccessFile.ts";
import { DiskTextBuffer } from "../../common/model/diskTextBuffer.ts";
import { TextDocument } from "../../common/model/textDocument.ts";

import { findMatches } from "./findMatches.ts";

/** Upstream `findModel.ts`: the find stops collecting at this many matches and the widget shows "19999+". */
const UPSTREAM_MATCHES_LIMIT = 19999;

/**
 * Found by the live run of PR #799 (QA pass, 2026-10-24): `Ctrl+F` and one typed character (`q`) on the 2 GB
 * log (21.7 M lines, every line matches) killed the process after ~100 s — `node::OOMErrorHandler` in stderr —
 * because the find collects every match of the whole document into one array. Upstream bounds the collection
 * (`MATCHES_LIMIT`); a document on disk is exactly the one where an unbounded collection does not fit.
 * (The sync walk over the lines itself is OpenPerformance 4.3; the crash is not a question of speed.)
 */
describe("findMatches over a document on disk", () => {
    it("is bounded by the upstream limit: a query that matches every line of a huge file does not collect them all", async () => {
        const lines = UPSTREAM_MATCHES_LIMIT + 5_000;
        const text = Array.from({ length: lines }, (_, i) => `${String(i)} request handled`).join("\n") + "\n";
        const bytes = Buffer.from(text);
        const buffer = new DiskTextBuffer(new MemoryRandomAccessFile(bytes), { chunkSize: 64 * 1024 });
        const doc = new TextDocument(buffer);
        await new Promise<void>((resolve) => {
            buffer.onDidChangeIndexing(() => {
                if (buffer.indexing.done) resolve();
            });
            buffer.startIndexing();
        });
        expect(doc.lineCount).toBe(lines + 1);

        const matches = findMatches(doc, "q");
        expect(matches.length).toBeGreaterThan(0);
        expect(matches.length).toBeLessThanOrEqual(UPSTREAM_MATCHES_LIMIT);
        buffer.dispose();
    });
});
