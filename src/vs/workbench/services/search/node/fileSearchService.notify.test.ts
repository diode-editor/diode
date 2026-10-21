import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";

import { FileSearchService } from "./fileSearchService.ts";

// A fake `rg` prints canned paths and hangs until killed: "walk in progress, part has
// arrived" without racing a real rg, which finishes first on a small tree.

describe.skipIf(process.platform === "win32")("FileSearchService: walk in progress (fake rg)", () => {
    let bin: ITempWorkspace;
    let service: FileSearchService | null = null;

    beforeEach(() => {
        bin = createTempWorkspace({ prefix: "diode-filesearch-fake-rg-" });
    });

    afterEach(() => {
        service?.dispose();
        service = null;
        bin.dispose();
        vi.useRealTimers();
    });

    function fakeRg(lines: readonly string[], options: { hang?: boolean } = {}): string {
        const out = bin.writeFile("stdout.txt", lines.map((line) => `${line}\n`).join(""));
        const script = bin.writeFile(
            "rg",
            `#!/bin/sh\ncat '${out}'\n${options.hang === false ? "" : "exec sleep 30\n"}exit 0\n`,
        );
        fs.chmodSync(script, 0o755);
        return script;
    }

    async function waitForEntries(s: FileSearchService): Promise<void> {
        await vi.waitFor(
            () => {
                expect(s.search("").length).toBeGreaterThan(0);
            },
            { interval: 5, timeout: 5000 },
        );
    }

    it("the index grows live while rg is still printing", async () => {
        const s = (service = new FileSearchService(NULL_CONFIGURATION_SERVICE, fakeRg(["a.ts", "src/b.ts"])));
        const pending = s.activate(bin.dir);

        await waitForEntries(s);
        expect(s.search("").map((r) => r.entry.relativePath)).toEqual(["a.ts", "src/b.ts"]);
        expect(s.isIndexed).toBe(false);

        s.dispose();
        await pending;
        expect(s.isIndexed).toBe(false);
    });

    it("debounced onIndexChanged fires on a timer mid-walk", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const s = (service = new FileSearchService(NULL_CONFIGURATION_SERVICE, fakeRg(["a.ts"])));
        let fired = 0;
        s.onIndexChanged(() => {
            fired += 1;
        });
        const pending = s.activate(bin.dir);

        await waitForEntries(s);
        expect(fired).toBe(0);
        vi.advanceTimersByTime(50);
        expect(fired).toBe(1);

        s.dispose();
        await pending;
    });

    it("dispose() cancels a pending notify: the subscriber does not get it", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const s = (service = new FileSearchService(NULL_CONFIGURATION_SERVICE, fakeRg(["a.ts"])));
        let fired = 0;
        s.onIndexChanged(() => {
            fired += 1;
        });
        const pending = s.activate(bin.dir);
        await waitForEntries(s);
        expect(vi.getTimerCount()).toBe(1);

        s.dispose();
        expect(vi.getTimerCount()).toBe(0);
        await pending;
        expect(fired).toBe(0);
    });

    it("dispose() mid-walk kills rg: `ready` settles", async () => {
        const s = (service = new FileSearchService(NULL_CONFIGURATION_SERVICE, fakeRg(["a.ts"])));
        const pending = s.activate(bin.dir);
        await waitForEntries(s);

        s.dispose();
        // Without kill, the hanging rg would hold `ready` for 30 seconds and the test would time out.
        await pending;
        expect(s.isIndexed).toBe(false);
    });

    it("a new walk kills the previous rg and does not mix their output", async () => {
        const s = (service = new FileSearchService(NULL_CONFIGURATION_SERVICE, fakeRg(["old.ts"])));
        const first = s.activate(bin.dir);
        await waitForEntries(s);

        // The previous rg hangs: unless it is killed, `first` never settles.
        fakeRg(["new.ts"], { hang: false });
        const second = s.activate(bin.dir);
        await Promise.all([first, second]);

        expect(s.isIndexed).toBe(true);
        expect(s.search("").map((r) => r.entry.relativePath)).toEqual(["new.ts"]);
    });

    /**
     * Exits 300 ms after SIGTERM and records starts in `starts`, so the previous walk ends
     * after the new one starts. One script serves both walks — a file a running `sh` reads cannot be rewritten.
     */
    function slowExitRg(): { rg: string; starts: () => number } {
        const out = bin.writeFile("stdout.txt", "a.ts\n");
        const starts = bin.path("starts");
        const script = bin.writeFile(
            "rg",
            `#!/bin/sh\necho started >> '${starts}'\ntrap 'sleep 0.3; exit 0' TERM\ncat '${out}'\nwhile :; do sleep 0.05; done\n`,
        );
        fs.chmodSync(script, 0o755);
        return {
            rg: script,
            starts: () => (fs.existsSync(starts) ? fs.readFileSync(starts, "utf8").split("\n").length - 1 : 0),
        };
    }

    /** Starts walk A, then walk B on top of it, and waits until A finishes dying (B is still running). */
    async function supersededWalk(s: FileSearchService, starts: () => number): Promise<{ second: Promise<void> }> {
        const first = s.activate(bin.dir);
        await vi.waitFor(() => {
            expect(starts()).toBe(1);
        });
        const second = s.activate(bin.dir);
        await vi.waitFor(() => {
            expect(starts()).toBe(2);
        });
        await first;
        // Wrapped in an object: a promise returned from an async function would be unwrapped,
        // and the caller would wait for B to end instead of A.
        return { second };
    }

    it("the end of a killed walk does not reset `indexing` of the running one", async () => {
        const { rg, starts } = slowExitRg();
        const s = (service = new FileSearchService(NULL_CONFIGURATION_SERVICE, rg));
        const { second } = await supersededWalk(s, starts);

        // The index was never completed, so it is stale by time; refreshIfStale declines
        // only because walk B is still `indexing`.
        const readyBefore = s.ready;
        s.refreshIfStale();
        expect(s.ready).toBe(readyBefore);
        expect(starts()).toBe(2);

        s.dispose();
        await second;
    });

    it("dispose() before the walk starts does not launch rg", async () => {
        const { rg, starts } = slowExitRg();
        const s = (service = new FileSearchService(NULL_CONFIGURATION_SERVICE, rg));
        const pending = s.activate(bin.dir);
        // The walk is deferred to setImmediate — dispose before it. An rg started after
        // dispose would have no one to kill it, and `pending` would never settle.
        s.dispose();
        await pending;

        expect(starts()).toBe(0);
        expect(s.isIndexed).toBe(false);
    });

    it("the end of a killed walk does not forget the running rg: dispose kills it", async () => {
        const { rg, starts } = slowExitRg();
        const s = (service = new FileSearchService(NULL_CONFIGURATION_SERVICE, rg));
        const { second } = await supersededWalk(s, starts);

        // A forgotten rg of walk B would run forever, and `second` would never settle.
        s.dispose();
        await second;
        expect(s.isIndexed).toBe(false);
    });

    it("refreshIfStale does not start a second walk while the first is running", async () => {
        const s = (service = new FileSearchService(NULL_CONFIGURATION_SERVICE, fakeRg(["a.ts"])));
        const pending = s.activate(bin.dir);
        await waitForEntries(s);

        const readyBefore = s.ready;
        s.refreshIfStale();
        expect(s.ready).toBe(readyBefore);

        s.dispose();
        await pending;
    });

    it("the walk ends on `close`: lines that arrive after `exit` are in the index", async () => {
        // `rg` itself exits at once, while a child that inherited its stdout prints
        // a line later: `exit` has fired, `close` has not yet.
        const script = bin.writeFile("rg", "#!/bin/sh\necho a.ts\n(sleep 0.3; echo late.ts) &\nexit 0\n");
        fs.chmodSync(script, 0o755);
        const s = (service = new FileSearchService(NULL_CONFIGURATION_SERVICE, script));

        await s.activate(bin.dir);

        expect(s.search("").map((r) => r.entry.relativePath)).toEqual(["a.ts", "late.ts"]);
    });

    it("a missing rg gives an empty index, not a failure", async () => {
        const s = (service = new FileSearchService(NULL_CONFIGURATION_SERVICE, bin.path("no-such-rg")));
        await s.activate(bin.dir);

        expect(s.isIndexed).toBe(true);
        expect(s.search("")).toHaveLength(0);
    });
});

describe("FileSearchService — notify", () => {
    let ws: ITempWorkspace;
    let service: FileSearchService;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-filesearch-notify-" });
        service = new FileSearchService(NULL_CONFIGURATION_SERVICE);
    });

    afterEach(() => {
        service.dispose();
        ws.dispose();
    });

    it("dispose() with no pending notify timer is a no-op", () => {
        // Never activated: dispose() takes the `notifyTimer === null` branch.
        expect(() => {
            service.dispose();
        }).not.toThrow();
    });

    it("flushNotify fires onIndexChanged on completion when subscribed late", async () => {
        ws.writeFile("only.ts", "");
        const p = service.activate(ws.dir);
        let fired = 0;
        service.onIndexChanged(() => {
            fired += 1;
        });
        await p;
        // Not "exactly 1": under load the debounce timer may fire before `close`.
        expect(fired).toBeGreaterThan(0);
    });

    it("does not index a broken symlink", async () => {
        ws.writeFile("real.ts", "");
        fs.symlinkSync(ws.path("nonexistent-target"), ws.path("dangling"));

        await service.activate(ws.dir);

        expect(service.search("").map((r) => r.entry.relativePath)).toEqual(["real.ts"]);
    });
});
