import { describe, expect, it, vi } from "vitest";

import { MemoryRandomAccessFile } from "../../../../TestUtils/memoryRandomAccessFile.ts";
import type { IRange } from "../../common/core/iRange.ts";
import { DiskTextBuffer } from "../../common/model/diskTextBuffer.ts";
import type { ITextDocument } from "../../common/model/iTextDocument.ts";
import { TextDocument } from "../../common/model/textDocument.ts";

import { BackgroundFind, type IBackgroundFindProgress, type IGrowingDocument } from "./backgroundFind.ts";
import { findTextMatches, type ITextMatchOptions, MATCHES_LIMIT } from "./findMatches.ts";

const PLAIN: ITextMatchOptions = { matchCase: false, wholeWord: false };

/** The slices run when the test says so. */
function manualScheduler() {
    const pending: (() => void)[] = [];
    return {
        schedule: (slice: () => void) => {
            pending.push(slice);
        },
        /** Runs the slices queued so far, and the ones they queue, until the queue is empty. */
        /** Bounded: a mutant that stalls the walk fails the test's `done` assertion instead of timing out. */
        drain: () => {
            for (let i = 0; i < 100_000 && pending.length > 0; i++) pending.shift()!();
        },
        step: () => {
            pending.shift()?.();
        },
        get queued() {
            return pending.length;
        },
    };
}

function lines(count: number, text: (i: number) => string): string {
    return Array.from({ length: count }, (_, i) => text(i)).join("\n");
}

interface IStarted {
    find: BackgroundFind;
    reports: IBackgroundFindProgress[];
    scheduler: ReturnType<typeof manualScheduler>;
}

function start(
    document: ITextDocument,
    query: string,
    startLine: number,
    extra: { sliceLines?: number; sliceChars?: number; growth?: IGrowingDocument; reportIntervalMs?: number } = {},
    options = PLAIN,
): IStarted {
    const scheduler = manualScheduler();
    const reports: IBackgroundFindProgress[] = [];
    const find = new BackgroundFind(document, query, options, (progress) => reports.push(progress), {
        startLine,
        schedule: scheduler.schedule,
        reportIntervalMs: 0,
        ...extra,
    });
    find.start();
    return { find, reports, scheduler };
}

function isSorted(matches: readonly IRange[]): boolean {
    return matches.every(
        (match, i) =>
            i === 0 ||
            matches[i - 1].start.line < match.start.line ||
            (matches[i - 1].start.line === match.start.line && matches[i - 1].end.character <= match.start.character),
    );
}

describe("BackgroundFind", () => {
    it("walks the document in slices between frames and ends with the same matches as the sync walk, in document order", () => {
        const doc = new TextDocument(lines(20, (i) => `foo ${String(i)} foo`));
        const { find, reports, scheduler } = start(doc, "foo", 7, { sliceLines: 3 });

        // The first slice ran at once: its matches are in before the first frame.
        expect(reports).toHaveLength(1);
        expect(reports[0].done).toBe(false);
        expect(reports[0].matches[0].start).toEqual({ line: 7, character: 0 });
        expect(find.done).toBe(false);

        scheduler.drain();
        const last = reports[reports.length - 1];
        expect(last.done).toBe(true);
        expect(find.done).toBe(true);
        expect(last.matches).toEqual(findTextMatches(doc, "foo", PLAIN));
        for (const report of reports) expect(isSorted(report.matches)).toBe(true);
        // Progress is monotonic and every report is a new array.
        for (let i = 1; i < reports.length; i++) {
            expect(reports[i].matches.length).toBeGreaterThanOrEqual(reports[i - 1].matches.length);
            expect(reports[i].matches).not.toBe(reports[i - 1].matches);
        }
    });

    it("starts at the cursor's line: the lines after it come first, the ones before it after the wrap", () => {
        const doc = new TextDocument(lines(10, (i) => `line ${String(i)}`));
        const { reports, scheduler } = start(doc, "line", 6, { sliceLines: 2 });
        expect(reports[0].matches.map((m) => m.start.line)).toEqual([6, 7]);
        expect(reports[0].wrapped).toBe(false);
        scheduler.step();
        expect(reports[reports.length - 1].matches.map((m) => m.start.line)).toEqual([6, 7, 8, 9]);
        // The lines after the start are all seen: a match after the cursor cannot turn up any more.
        expect(reports[reports.length - 1].wrapped).toBe(true);
        scheduler.step();
        // The wrap: lines 0..1 go in front, the list stays in document order.
        expect(reports[reports.length - 1].matches.map((m) => m.start.line)).toEqual([0, 1, 6, 7, 8, 9]);
        scheduler.drain();
        expect(reports[reports.length - 1].matches.map((m) => m.start.line)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(reports[reports.length - 1].done).toBe(true);
    });

    it("a start line past the end is clamped; a start at the top needs no wrap", () => {
        const doc = new TextDocument(lines(5, (i) => `x${String(i)}`));
        const clamped = start(doc, "x", 99, { sliceLines: 100 });
        expect(clamped.reports[0].matches.map((m) => m.start.line)).toEqual([4]);
        clamped.scheduler.drain();
        expect(clamped.reports[clamped.reports.length - 1].matches.map((m) => m.start.line)).toEqual([0, 1, 2, 3, 4]);

        const top = start(doc, "x", 0, { sliceLines: 100 });
        expect(top.reports[0]).toMatchObject({ done: true });
        expect(top.reports[0].matches).toHaveLength(5);
        expect(top.scheduler.queued).toBe(0);
    });

    it("a slice ends early by characters: one long line is a slice of its own", () => {
        const doc = new TextDocument(["a".repeat(100), "a", "a", "a"].join("\n"));
        const { reports, scheduler } = start(doc, "aaa", 0, { sliceLines: 100, sliceChars: 50 });
        // Line 0 alone filled the character budget.
        expect(reports[0].matches.every((m) => m.start.line === 0)).toBe(true);
        expect(scheduler.queued).toBe(1);
        scheduler.drain();
        expect(reports[reports.length - 1].done).toBe(true);
    });

    it("stops collecting at the upstream limit and walks no further", () => {
        const doc = new TextDocument(lines(MATCHES_LIMIT + 500, () => "q"));
        let read = 0;
        const counting: ITextDocument = new Proxy(doc, {
            get(target, property, receiver) {
                if (property === "getLineContent") {
                    return (line: number) => {
                        read++;
                        return target.getLineContent(line);
                    };
                }
                return Reflect.get(target, property, receiver) as unknown;
            },
        });
        const { reports, scheduler } = start(counting, "q", 0, { sliceLines: 1000 });
        scheduler.drain();
        const last = reports[reports.length - 1];
        expect(last.done).toBe(true);
        expect(last.matches).toHaveLength(MATCHES_LIMIT);
        expect(read).toBe(MATCHES_LIMIT);
    });

    it("the limit counts both passes: the wrap stops where the total reaches it", () => {
        const doc = new TextDocument(lines(MATCHES_LIMIT + 10, () => "q"));
        const { reports, scheduler } = start(doc, "q", 20, { sliceLines: 100_000 });
        scheduler.drain();
        const last = reports[reports.length - 1];
        expect(last.done).toBe(true);
        expect(last.matches).toHaveLength(MATCHES_LIMIT);
        expect(isSorted(last.matches)).toBe(true);
        // 19 989 lines from line 20 on, then the 10 lines of the top the limit still allows.
        expect(last.matches[0].start.line).toBe(0);
        expect(last.matches[9].start.line).toBe(9);
        expect(last.matches[10].start.line).toBe(20);
    });

    it("honours matchCase and wholeWord like the sync walk", () => {
        const doc = new TextDocument("Foo foo foobar FOO\nfoo");
        const options: ITextMatchOptions = { matchCase: true, wholeWord: true };
        const { reports, scheduler } = start(doc, "foo", 0, {}, options);
        scheduler.drain();
        expect(reports[reports.length - 1].matches).toEqual(findTextMatches(doc, "foo", options));
        expect(reports[reports.length - 1].matches.map((m) => m.start)).toEqual([
            { line: 0, character: 4 },
            { line: 1, character: 0 },
        ]);
    });

    it("an empty query is done at once with no matches", () => {
        const doc = new TextDocument("foo");
        const { find, reports, scheduler } = start(doc, "", 0);
        expect(find.done).toBe(true);
        expect(reports).toEqual([{ matches: [], done: true, wrapped: true }]);
        expect(scheduler.queued).toBe(0);
    });

    it("a query without matches reports the empty progress of the first slice and then the end", () => {
        const doc = new TextDocument(lines(10, (i) => `line ${String(i)}`));
        const { reports, scheduler } = start(doc, "zzz", 0, { sliceLines: 4 });
        expect(reports).toEqual([{ matches: [], done: false, wrapped: false }]);
        scheduler.drain();
        expect(reports).toEqual([
            { matches: [], done: false, wrapped: false },
            { matches: [], done: true, wrapped: true },
        ]);
    });

    it("dispose stops the walk: a slice scheduled before it does nothing, no report follows", () => {
        const doc = new TextDocument(lines(10, (i) => `line ${String(i)}`));
        const { find, reports, scheduler } = start(doc, "line", 0, { sliceLines: 2 });
        expect(scheduler.queued).toBe(1);
        find.dispose();
        scheduler.drain();
        expect(reports).toHaveLength(1);
        expect(find.done).toBe(false);
    });

    it("throttles the progress: the first match goes out at once, then at the interval, and the end always", () => {
        const doc = new TextDocument(lines(10, (i) => `line ${String(i)}`));
        const { reports, scheduler } = start(doc, "line", 0, { sliceLines: 2, reportIntervalMs: 60_000 });
        scheduler.drain();
        expect(reports).toHaveLength(2);
        expect(reports[0]).toMatchObject({ done: false });
        expect(reports[0].matches).toHaveLength(2);
        expect(reports[1].done).toBe(true);
        expect(reports[1].matches).toHaveLength(10);
    });

    describe("over a document that grows while the walk runs (the index of a document on disk)", () => {
        /** Lines arrive in chunks of 10 when the test releases a read; the file reports twice its bytes. */
        function growing(count: number) {
            const text = lines(count, (i) => `row ${String(i).padStart(4, "0")}`) + "\n";
            const bytes = Buffer.from(text);
            const file = new MemoryRandomAccessFile(bytes, { size: bytes.length * 2, gated: true });
            const buffer = new DiskTextBuffer(file, { chunkSize: "row 0000\n".length * 10 });
            buffer.startIndexing();
            const doc = new TextDocument(buffer);
            const growth: IGrowingDocument = {
                isGrowing: () => !buffer.indexing.done,
                onDidGrow: buffer.onDidChangeIndexing,
            };
            return { doc, file, buffer, growth };
        }

        async function released(file: MemoryRandomAccessFile): Promise<void> {
            file.release();
            await new Promise((resolve) => setImmediate(resolve));
        }

        it("what was found before the pause for the index goes out even inside the report interval", () => {
            const { doc, buffer, growth } = growing(35);
            expect(doc.lineCount).toBe(10);
            const { find, reports, scheduler } = start(doc, "row", 0, {
                sliceLines: 3,
                growth,
                reportIntervalMs: 60_000,
            });
            scheduler.drain();
            expect(find.done).toBe(false);
            const last = reports[reports.length - 1];
            expect(last.done).toBe(false);
            expect(last.matches).toHaveLength(10);
            buffer.dispose();
        });

        it("waits at the indexed end for more lines and ends when the index does", async () => {
            const { doc, file, buffer, growth } = growing(35);
            expect(doc.lineCount).toBe(10);
            const { find, reports, scheduler } = start(doc, "row", 0, { sliceLines: 100, growth });
            scheduler.drain();
            // The indexed lines are in; the walk is not over.
            expect(reports[reports.length - 1]).toMatchObject({ done: false });
            expect(reports[reports.length - 1].matches).toHaveLength(10);
            expect(find.done).toBe(false);

            await released(file);
            expect(doc.lineCount).toBe(20);
            scheduler.drain();
            expect(reports[reports.length - 1].matches).toHaveLength(20);
            expect(find.done).toBe(false);

            await released(file);
            await released(file);
            // The file reports more bytes than it has: the pass ends when a read comes back empty.
            await released(file);
            expect(buffer.indexing.done).toBe(true);
            scheduler.drain();
            expect(find.done).toBe(true);
            expect(reports[reports.length - 1].done).toBe(true);
            expect(reports[reports.length - 1].matches).toHaveLength(35);
            buffer.dispose();
        });

        it("a walk that started in the middle covers the lines that arrive after its wrap", async () => {
            const { doc, file, buffer, growth } = growing(25);
            const { find, reports, scheduler } = start(doc, "row", 5, { sliceLines: 100, growth });
            scheduler.drain();
            expect(reports[reports.length - 1].matches.map((m) => m.start.line)).toEqual([
                0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
            ]);
            expect(find.done).toBe(false);
            file.openGate();
            await new Promise<void>((resolve) => {
                buffer.onDidChangeIndexing(() => {
                    if (buffer.indexing.done) resolve();
                });
            });
            scheduler.drain();
            expect(find.done).toBe(true);
            expect(reports[reports.length - 1].matches.map((m) => m.start.line)).toEqual(
                Array.from({ length: 25 }, (_, i) => i),
            );
            buffer.dispose();
        });

        it("dispose while waiting for growth drops the subscription: later growth runs no slice", async () => {
            const { doc, file, buffer, growth } = growing(25);
            const { find, reports, scheduler } = start(doc, "row", 0, { sliceLines: 100, growth });
            scheduler.drain();
            find.dispose();
            const seen = reports.length;
            await released(file);
            scheduler.drain();
            expect(reports).toHaveLength(seen);
            expect(find.done).toBe(false);
            buffer.dispose();
        });

        it("the limit ends the walk even while the document is still growing", async () => {
            const text = lines(MATCHES_LIMIT + 100, () => "q") + "\n";
            const bytes = Buffer.from(text);
            const file = new MemoryRandomAccessFile(bytes, { size: bytes.length * 2, gated: true });
            const buffer = new DiskTextBuffer(file, { chunkSize: bytes.length });
            buffer.startIndexing();
            const doc = new TextDocument(buffer);
            const growth: IGrowingDocument = {
                isGrowing: () => !buffer.indexing.done,
                onDidGrow: buffer.onDidChangeIndexing,
            };
            const { find, reports, scheduler } = start(doc, "q", 0, { sliceLines: 100_000, growth });
            scheduler.drain();
            expect(find.done).toBe(true);
            expect(reports[reports.length - 1].matches).toHaveLength(MATCHES_LIMIT);
            expect(buffer.indexing.done).toBe(false);
            buffer.dispose();
        });
    });
});

describe("BackgroundFind — slice and report boundaries", () => {
    it("the character budget is inclusive: a line that fills it exactly ends the slice", () => {
        const doc = new TextDocument(["a".repeat(50), "b"].join("\n"));
        const { reports, scheduler } = start(doc, "b", 0, { sliceLines: 100, sliceChars: 50 });
        expect(reports[0]).toMatchObject({ done: false });
        expect(reports[0].matches).toEqual([]);
        scheduler.drain();
        expect(reports[reports.length - 1].matches).toHaveLength(1);
    });

    it("with the default interval: the first matches go out at once even after an empty slice, later counts wait for the interval", () => {
        vi.useFakeTimers();
        try {
            const doc = new TextDocument(lines(10, (i) => (i < 2 ? "none" : `line ${String(i)}`)));
            const scheduler = manualScheduler();
            const reports: IBackgroundFindProgress[] = [];
            const find = new BackgroundFind(doc, "line", PLAIN, (progress) => reports.push(progress), {
                startLine: 0,
                schedule: scheduler.schedule,
                sliceLines: 2,
            });
            find.start();
            expect(reports).toEqual([{ matches: [], done: false, wrapped: false }]);
            vi.advanceTimersByTime(10);
            scheduler.step(); // lines 2..3: the first matches, reported at once
            expect(reports).toHaveLength(2);
            expect(reports[1].matches).toHaveLength(2);
            vi.advanceTimersByTime(50);
            scheduler.step(); // lines 4..5: within the interval, no report
            expect(reports).toHaveLength(2);
            vi.advanceTimersByTime(60);
            scheduler.step(); // lines 6..7: the interval has passed
            expect(reports).toHaveLength(3);
            expect(reports[2]).toMatchObject({ done: false });
            expect(reports[2].matches).toHaveLength(6);
            scheduler.step(); // lines 8..9: the end always reports
            expect(reports).toHaveLength(4);
            expect(reports[3]).toMatchObject({ done: true });
            expect(reports[3].matches).toHaveLength(8);
        } finally {
            vi.useRealTimers();
        }
    });
});
