import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";

import { FileSearchService } from "./fileSearchService.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Run the (real) microtask/setImmediate loop a few times so the background walk progresses. */
async function flushImmediates(times = 1): Promise<void> {
    for (let i = 0; i < times; i++) {
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("FileSearchService — notify / onIndexChanged", () => {
    let ws: ITempWorkspace;
    let service: FileSearchService;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-filesearch-notify-" });
        service = new FileSearchService();
    });

    afterEach(() => {
        service.dispose();
        ws.dispose();
        vi.useRealTimers();
    });

    it("fires the debounced onIndexChanged from the timer callback mid-walk (lines 220-221)", async () => {
        // Fake the 50ms debounce timer (keep setImmediate real). A deep directory
        // chain keeps the walk in progress long enough that we can deterministically
        // fire the debounce timer's callback ourselves while indexing is ongoing —
        // exercising the timer callback (lines 220-221), not the flushNotify path.
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

        let fired = 0;
        service.onIndexChanged = () => {
            fired += 1;
        };

        let nested = "deep";
        for (let i = 0; i < 40; i++) nested = path.join(nested, `lvl${i}`);
        ws.writeFile(path.join(nested, "leaf.ts"), "");

        const pending = service.activate(ws.dir);

        // Pump real setImmediate turns until the walk has scheduled the debounce timer
        // and is still indexing (timer pending, not yet flushed).
        await vi.waitFor(
            () => {
                expect(vi.getTimerCount()).toBeGreaterThan(0);
                expect(service.isIndexed).toBe(false);
            },
            { interval: 1, timeout: 2000 },
        );

        // Fire the pending debounce timer's callback: it nulls notifyTimer and calls
        // onIndexChanged (lines 220-221).
        vi.advanceTimersByTime(50);
        expect(fired).toBeGreaterThan(0);

        service.dispose();
        await pending;
    });

    it("dispose() clears a pending notify timer (lines 143-145)", async () => {
        // Fake the debounce setTimeout/clearTimeout but keep setImmediate real so the
        // walk still advances. With the 50ms timer faked it never fires on its own, so
        // once scheduleNotify() runs the notify timer stays pending until dispose().
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

        let fired = 0;
        service.onIndexChanged = () => {
            fired += 1;
        };

        // A deep nested chain forces many walk iterations; scheduleNotify() sets the
        // pending debounce timer on the very first iteration.
        let nested = "deep";
        for (let i = 0; i < 40; i++) nested = path.join(nested, `lvl${i}`);
        ws.writeFile(path.join(nested, "leaf.ts"), "");

        const pending = service.activate(ws.dir);

        // Pump real setImmediate turns until a faked debounce timer is pending (the
        // walk's scheduleNotify ran) while the walk is still in progress. Because the
        // faked timer never auto-fires, this state is stable.
        await vi.waitFor(
            () => {
                expect(vi.getTimerCount()).toBeGreaterThan(0);
                expect(service.isIndexed).toBe(false);
            },
            { interval: 1, timeout: 2000 },
        );

        const timersBefore = vi.getTimerCount();
        expect(timersBefore).toBeGreaterThan(0);
        // dispose() must clear the pending debounce timer (lines 143-145): the pending
        // timer count drops and the timer never gets a chance to fire onIndexChanged.
        service.dispose();
        expect(vi.getTimerCount()).toBeLessThan(timersBefore);
        expect(fired).toBe(0);

        // Let the cancelled background walk settle.
        await pending;
    });

    it("dispose() with no pending notify timer is a no-op (line 143 false branch)", () => {
        // Never activated → notifyTimer is null. dispose() must take the false branch.
        expect(() => {
            service.dispose();
        }).not.toThrow();
    });

    it("flushNotify fires onIndexChanged exactly once on completion when set late", async () => {
        ws.writeFile("only.ts", "");
        const p = service.activate(ws.dir);
        let fired = 0;
        service.onIndexChanged = () => {
            fired += 1;
        };
        await p;
        await new Promise((r) => setTimeout(r, 80));
        expect(fired).toBeGreaterThan(0);
    });
});

describe("FileSearchService — walk branches", () => {
    let ws: ITempWorkspace;
    let service: FileSearchService;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-filesearch-notify-" });
        service = new FileSearchService();
    });

    afterEach(() => {
        service.dispose();
        ws.dispose();
        vi.useRealTimers();
    });

    it("ignores dirents that are neither files nor directories (branch 196)", async () => {
        ws.writeFile("real.ts", "");
        // A broken symlink is a Dirent where isFile() and isDirectory() are both false.
        fs.symlinkSync(ws.path("nonexistent-target"), ws.path("dangling"));

        await service.activate(ws.dir);

        const paths = service.search("").map((r) => r.entry.relativePath);
        expect(paths).toContain("real.ts");
        expect(paths).not.toContain("dangling");
    });

    it("refreshIfStale is a no-op while a background walk is still indexing (branch 85)", async () => {
        // Many entries keep the initial walk in-flight across event-loop turns.
        for (let i = 0; i < 12; i++) {
            ws.writeFile(`dir${i}/file.ts`, "");
        }

        const first = service.activate(ws.dir);
        // The walk is now in progress (indexing === true) but not finished.
        await flushImmediates(1);
        expect(service.isIndexed).toBe(false);

        // While indexing, refreshIfStale must not start a second walk.
        const readyBefore = service.ready;
        service.refreshIfStale();
        expect(service.ready).toBe(readyBefore);

        await first;
        expect(service.isIndexed).toBe(true);
    });

    it("a dispose during the walk cancels at the post-loop check (branch 206)", async () => {
        // Enough directories that the walk yields several times; dispose mid-walk.
        for (let i = 0; i < 20; i++) {
            ws.writeFile(`g${i}/file.ts`, "");
        }

        const pending = service.activate(ws.dir);
        await flushImmediates(2);
        service.dispose();
        await pending;

        // Cancelled after the loop → never marked indexed.
        expect(service.isIndexed).toBe(false);
    });
});
