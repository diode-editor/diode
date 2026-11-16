import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import type { IFileIndexRequest } from "../common/fileSearch.ts";

import { FileSearchEngine } from "./fileSearchEngine.ts";

// A fake `rg` prints canned paths and hangs until killed: "walk in progress, part has
// arrived" without racing a real rg, which finishes first on a small tree.

describe.skipIf(process.platform === "win32")("FileSearchEngine: walk in progress (fake rg)", () => {
    let bin: ITempWorkspace;
    let engine: FileSearchEngine | null = null;

    beforeEach(() => {
        bin = createTempWorkspace({ prefix: "diode-filesearch-fake-rg-" });
    });

    afterEach(() => {
        engine?.dispose();
        engine = null;
        bin.dispose();
        vi.useRealTimers();
    });

    function request(cacheKey = "k"): IFileIndexRequest {
        return {
            cacheKey,
            folder: bin.dir,
            excludes: [],
            useIgnoreFiles: { local: true, parent: false, global: false },
        };
    }

    function fakeRg(lines: readonly string[], options: { hang?: boolean } = {}): string {
        const out = bin.writeFile("stdout.txt", lines.map((line) => `${line}\n`).join(""));
        const script = bin.writeFile(
            "rg",
            `#!/bin/sh\ncat '${out}'\n${options.hang === false ? "" : "exec sleep 30\n"}exit 0\n`,
        );
        fs.chmodSync(script, 0o755);
        return script;
    }

    async function paths(e: FileSearchEngine, cacheKey = "k"): Promise<string[]> {
        return (await e.query({ cacheKey, query: "", maxResults: 1000 })).matches.map((m) => m.relativePath);
    }

    async function waitForEntries(e: FileSearchEngine, count = 1, cacheKey = "k"): Promise<void> {
        await vi.waitFor(
            async () => {
                expect((await paths(e, cacheKey)).length).toBeGreaterThanOrEqual(count);
            },
            { interval: 5, timeout: 5000 },
        );
    }

    it("the index grows live while rg is still printing; the query says the walk is not complete", async () => {
        const e = (engine = new FileSearchEngine({ ripgrepPath: fakeRg(["a.ts", "src/b.ts"]) }));
        const pending = e.index(request());

        await waitForEntries(e, 2);
        expect(await e.query({ cacheKey: "k", query: "", maxResults: 10 })).toEqual({
            matches: [
                { relativePath: "a.ts", score: 0, matchedIndices: [] },
                { relativePath: "src/b.ts", score: 0, matchedIndices: [] },
            ],
            complete: false,
            limitHit: false,
        });

        e.clearCache("k");
        // Without kill, the hanging rg would hold the walk for 30 seconds and the test would time out.
        expect(await pending).toEqual({ limitHit: false });
    });

    it("a second index() for the same key joins the walk instead of starting another", async () => {
        const e = (engine = new FileSearchEngine({ ripgrepPath: fakeRg(["a.ts"], { hang: false }) }));
        const first = e.index(request());
        expect(e.index(request())).toBe(first);
        await first;
        expect(await paths(e)).toEqual(["a.ts"]);
    });

    it("a completed walk answers complete, and a second index() returns at once", async () => {
        const e = (engine = new FileSearchEngine({ ripgrepPath: fakeRg(["a.ts"], { hang: false }) }));
        await e.index(request());
        expect((await e.query({ cacheKey: "k", query: "a", maxResults: 10 })).complete).toBe(true);
        await e.index(request());
    });

    it("debounced onDidChangeIndex fires with the key on a timer mid-walk", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const e = (engine = new FileSearchEngine({ ripgrepPath: fakeRg(["a.ts", "b.ts"]) }));
        const fired: string[] = [];
        e.onDidChangeIndex((key) => fired.push(key));
        const pending = e.index(request());

        await waitForEntries(e, 2);
        expect(fired).toEqual([]);
        expect(vi.getTimerCount()).toBe(1);
        vi.advanceTimersByTime(50);
        expect(fired).toEqual(["k"]);

        e.clearCache("k");
        await pending;
    });

    it("the end of the walk fires at once, cancelling the pending timer", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const e = (engine = new FileSearchEngine({ ripgrepPath: fakeRg(["a.ts"], { hang: false }) }));
        const fired: string[] = [];
        e.onDidChangeIndex((key) => fired.push(key));

        await e.index(request());

        expect(fired).toEqual(["k"]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("clearCache() cancels a pending notify and forgets the index", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const e = (engine = new FileSearchEngine({ ripgrepPath: fakeRg(["a.ts"]) }));
        const fired: string[] = [];
        e.onDidChangeIndex((key) => fired.push(key));
        const pending = e.index(request());
        await waitForEntries(e);

        e.clearCache("k");
        expect(vi.getTimerCount()).toBe(0);
        await pending;
        expect(fired).toEqual([]);
        expect(await e.query({ cacheKey: "k", query: "", maxResults: 10 })).toEqual({
            matches: [],
            complete: false,
            limitHit: false,
        });
    });

    it("clearCache() of an unknown key is a no-op", () => {
        engine = new FileSearchEngine({ ripgrepPath: fakeRg([]) });
        expect(() => {
            engine?.clearCache("nope");
        }).not.toThrow();
    });

    it("keys are independent: clearing one leaves the other", async () => {
        const e = (engine = new FileSearchEngine({ ripgrepPath: fakeRg(["a.ts"], { hang: false }) }));
        await e.index(request("one"));
        await e.index(request("two"));
        e.clearCache("one");
        expect(await paths(e, "one")).toEqual([]);
        expect(await paths(e, "two")).toEqual(["a.ts"]);
    });

    it("a disposed engine holds no index", async () => {
        const e = (engine = new FileSearchEngine({ ripgrepPath: fakeRg(["a.ts"], { hang: false }) }));
        await e.index(request());
        e.dispose();
        expect(await e.query({ cacheKey: "k", query: "", maxResults: 10 })).toEqual({
            matches: [],
            complete: false,
            limitHit: false,
        });
    });

    it("dispose() mid-walk kills rg: the walk settles", async () => {
        const e = (engine = new FileSearchEngine({ ripgrepPath: fakeRg(["a.ts"]) }));
        const pending = e.index(request());
        await waitForEntries(e);

        e.dispose();
        await pending;
    });

    it("stops at the capacity: rg is killed and the index reports limitHit", async () => {
        // The fake rg hangs after printing: only the kill on the limit lets the walk end.
        const e = (engine = new FileSearchEngine({
            ripgrepPath: fakeRg(["a.ts", "b.ts", "c.ts", "d.ts"]),
            capacity: 2,
        }));
        expect(await e.index(request())).toEqual({ limitHit: true });
        expect(await e.query({ cacheKey: "k", query: "", maxResults: 10 })).toMatchObject({
            complete: true,
            limitHit: true,
        });
        expect(await paths(e)).toEqual(["a.ts", "b.ts"]);
    });

    it("the walk ends on `close`: lines that arrive after `exit` are in the index", async () => {
        // `rg` itself exits at once, while a child that inherited its stdout prints a line later.
        const script = bin.writeFile("rg", "#!/bin/sh\necho a.ts\n(sleep 0.3; echo late.ts) &\nexit 0\n");
        fs.chmodSync(script, 0o755);
        const e = (engine = new FileSearchEngine({ ripgrepPath: script }));

        await e.index(request());

        expect(await paths(e)).toEqual(["a.ts", "late.ts"]);
    });

    it("blank lines are not entries", async () => {
        const e = (engine = new FileSearchEngine({ ripgrepPath: fakeRg(["a.ts", "", "b.ts"], { hang: false }) }));
        await e.index(request());
        expect(await paths(e)).toEqual(["a.ts", "b.ts"]);
    });

    it("a missing rg gives an empty complete index, not a failure", async () => {
        const e = (engine = new FileSearchEngine({ ripgrepPath: bin.path("no-such-rg") }));
        expect(await e.index(request())).toEqual({ limitHit: false });
        expect(await e.query({ cacheKey: "k", query: "", maxResults: 10 })).toMatchObject({
            matches: [],
            complete: true,
        });
    });

    it("an rg that cannot be spawned at all (empty path) gives an empty complete index", async () => {
        const e = (engine = new FileSearchEngine({ ripgrepPath: "" }));
        expect(await e.index(request())).toEqual({ limitHit: false });
        expect((await e.query({ cacheKey: "k", query: "", maxResults: 10 })).complete).toBe(true);
    });
});
