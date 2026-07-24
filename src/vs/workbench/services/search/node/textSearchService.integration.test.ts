import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import type { IFileMatch, ISearchHandle, ITextSearchQuery } from "../common/textSearch.ts";

import { TextSearchService } from "./textSearchService.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function query(overrides: Partial<ITextSearchQuery> = {}): ITextSearchQuery {
    return {
        pattern: "foo",
        isRegExp: false,
        isCaseSensitive: false,
        isWholeWord: false,
        includes: [],
        excludes: [],
        ...overrides,
    };
}

/** Runs a search to completion, returning the streamed matches and the summary. */
async function runSearch(service: TextSearchService, q: ITextSearchQuery, folder: string) {
    const results: IFileMatch[] = [];
    const complete = await service.search(q, folder, (m) => results.push(m)).complete;
    return { results, complete };
}

/** Total matched spans across all streamed file results. */
function totalMatches(results: IFileMatch[]): number {
    return results.reduce((n, r) => n + r.matches.length, 0);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TextSearchService (against real ripgrep)", () => {
    let ws: ITempWorkspace;
    let service: TextSearchService;

    afterEach(() => {
        service.dispose();
        ws.dispose();
    });

    function setup(files: Record<string, string>): void {
        ws = createTempWorkspace({ prefix: "vexx-textsearch-" });
        for (const [name, content] of Object.entries(files)) ws.writeFile(name, content);
        service = new TextSearchService();
    }

    // ── Basic streaming ───────────────────────────────────────────────────────────

    it("streams matches and reports file/match counts", async () => {
        setup({ "a.ts": "const foo = 1\nlet bar = foo\n", "b.ts": "// nothing here\n" });
        const { results, complete } = await runSearch(service, query(), ws.dir);
        expect(complete.matchCount).toBe(2);
        expect(complete.fileCount).toBe(1);
        expect(totalMatches(results)).toBe(2);
    });

    it("reports absolute paths for matched files", async () => {
        setup({ "a.ts": "foo\n" });
        const { results } = await runSearch(service, query(), ws.dir);
        expect(results[0].absolutePath).toBe(path.join(ws.dir, "a.ts"));
    });

    it("completes with zero results when nothing matches", async () => {
        setup({ "a.ts": "nothing relevant\n" });
        const { results, complete } = await runSearch(service, query({ pattern: "zzz" }), ws.dir);
        expect(complete.matchCount).toBe(0);
        expect(complete.fileCount).toBe(0);
        expect(results).toEqual([]);
    });

    // ── Toggles ───────────────────────────────────────────────────────────────────

    it("honors the case-sensitive toggle", async () => {
        setup({ "a.ts": "Foo foo FOO\n" });
        const insensitive = await runSearch(service, query({ isCaseSensitive: false }), ws.dir);
        expect(insensitive.complete.matchCount).toBe(3);
        const sensitive = await runSearch(service, query({ isCaseSensitive: true }), ws.dir);
        expect(sensitive.complete.matchCount).toBe(1);
    });

    it("honors the whole-word toggle", async () => {
        setup({ "a.ts": "foo foobar barfoo\n" });
        const partial = await runSearch(service, query({ isWholeWord: false }), ws.dir);
        expect(partial.complete.matchCount).toBe(3);
        const whole = await runSearch(service, query({ isWholeWord: true }), ws.dir);
        expect(whole.complete.matchCount).toBe(1);
    });

    it("treats the query as a regex when the regex toggle is on", async () => {
        setup({ "a.ts": "foo1 foo2 fooX\n" });
        const { complete } = await runSearch(service, query({ pattern: "foo[0-9]", isRegExp: true }), ws.dir);
        expect(complete.matchCount).toBe(2);
    });

    it("treats regex metacharacters literally when the regex toggle is off", async () => {
        setup({ "a.ts": "a.b axb\n" });
        const { complete } = await runSearch(service, query({ pattern: "a.b" }), ws.dir);
        // Literal "a.b" matches only "a.b", not "axb".
        expect(complete.matchCount).toBe(1);
    });

    // ── Include / exclude globs ───────────────────────────────────────────────────

    it("restricts the search to include globs", async () => {
        setup({ "a.ts": "foo\n", "b.js": "foo\n" });
        const { complete } = await runSearch(service, query({ includes: ["*.ts"] }), ws.dir);
        expect(complete.fileCount).toBe(1);
    });

    it("skips files matching exclude globs", async () => {
        setup({ "a.ts": "foo\n", "b.ts": "foo\n" });
        const { complete } = await runSearch(service, query({ excludes: ["b.ts"] }), ws.dir);
        expect(complete.fileCount).toBe(1);
    });

    // ── Empty / invalid query ─────────────────────────────────────────────────────

    it("completes immediately with no results for an empty query", async () => {
        setup({ "a.ts": "foo\n" });
        const handle = service.search(query({ pattern: "" }), ws.dir, () => {});
        handle.cancel(); // no-op on an already-finished search
        expect(await handle.complete).toEqual({ matchCount: 0, fileCount: 0, limitHit: false });
    });

    // ── Cancellation & limit ──────────────────────────────────────────────────────

    it("stops at the result cap and flags limitHit", async () => {
        const manyLines = Array.from({ length: 10_050 }, () => "foo").join("\n") + "\n";
        setup({ "big.txt": manyLines });
        const { complete } = await runSearch(service, query(), ws.dir);
        expect(complete.limitHit).toBe(true);
        expect(complete.matchCount).toBeGreaterThanOrEqual(10_000);
    });

    it("ignores results that stream in after cancellation", async () => {
        // A large single file makes rg emit stdout across several chunks; cancelling
        // on the first result means later chunks arrive after the cancel flag is set.
        const manyLines = Array.from({ length: 20_000 }, () => "foo").join("\n") + "\n";
        setup({ "big.txt": manyLines });
        let handle: ISearchHandle;
        let seen = 0;
        handle = service.search(query(), ws.dir, () => {
            seen++;
            handle.cancel();
        });
        const complete = await handle.complete;
        // We cancelled almost immediately, so far fewer than all 20k matches surface.
        expect(seen).toBeLessThan(20_000);
        expect(complete.limitHit).toBe(false);
    });

    it("cancel() is idempotent and resolves the search", async () => {
        const manyLines = Array.from({ length: 5000 }, () => "foo").join("\n") + "\n";
        setup({ "big.txt": manyLines });
        const handle = service.search(query(), ws.dir, () => {});
        handle.cancel();
        handle.cancel();
        await expect(handle.complete).resolves.toMatchObject({ limitHit: false });
    });

    // ── Errors ────────────────────────────────────────────────────────────────────

    it("surfaces a ripgrep error (exit code 2) via complete.error", async () => {
        setup({ "a.ts": "foo\n" });
        // A malformed glob is rejected by ripgrep with a parse error on stderr.
        const { complete } = await runSearch(service, query({ includes: ["["] }), ws.dir);
        expect(complete.error).toBeTruthy();
    });

    it("surfaces a spawn failure when the rg binary is missing", async () => {
        ws = createTempWorkspace({ prefix: "vexx-textsearch-" });
        ws.writeFile("a.ts", "foo\n");
        service = new TextSearchService("/no/such/rg-binary");
        const { complete } = await runSearch(service, query(), ws.dir);
        expect(complete.error).toBeTruthy();
    });

    // ── Disposal ──────────────────────────────────────────────────────────────────

    it("kills in-flight searches on dispose", async () => {
        const manyLines = Array.from({ length: 5000 }, () => "foo").join("\n") + "\n";
        setup({ "big.txt": manyLines });
        const handle = service.search(query(), ws.dir, () => {});
        service.dispose();
        await expect(handle.complete).resolves.toBeDefined();
    });
});
