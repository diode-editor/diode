import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NULL_STATE_SERVICE } from "../../../platform/state/common/nullStateService.ts";
import { StatusBarService } from "../../services/statusbar/common/statusBarService.ts";

import { ProgressStatusBarAdapter } from "./progressStatusBarAdapter.ts";

describe("ProgressStatusBarAdapter", () => {
    let statusBar: StatusBarService;
    let adapter: ProgressStatusBarAdapter;

    const texts = (): string[] => statusBar.entries().map((e) => e.text);

    beforeEach(() => {
        vi.useFakeTimers();
        statusBar = new StatusBarService(NULL_STATE_SERVICE);
        adapter = new ProgressStatusBarAdapter(statusBar, 100);
    });

    afterEach(() => {
        adapter.dispose();
        vi.useRealTimers();
    });

    it("start adds an entry with a spinner, a timer tick advances the frame", () => {
        adapter.start(1, "TS: starting");
        expect(texts()).toEqual(["⠋ TS: starting"]);

        vi.advanceTimersByTime(100);
        expect(texts()).toEqual(["⠙ TS: starting"]);
        vi.advanceTimersByTime(100);
        expect(texts()).toEqual(["⠹ TS: starting"]);
    });

    it("report updates the message and accumulates percent clamped to 0–100", () => {
        adapter.start(1, "TS");
        adapter.report(1, "loading project");
        expect(texts()).toEqual(["⠋ TS · loading project"]);

        adapter.report(1, undefined, 30);
        expect(texts()).toEqual(["⠋ TS · loading project (30%)"]);

        adapter.report(1, "indexing", 50);
        expect(texts()).toEqual(["⠋ TS · indexing (80%)"]);

        adapter.report(1, undefined, 999);
        expect(texts()).toEqual(["⠋ TS · indexing (100%)"]);
    });

    it("end removes the entry and stops the timer; report/end for an unknown handle is a no-op", () => {
        adapter.start(1, "TS");
        adapter.end(1);
        expect(texts()).toEqual([]);

        // The timer is killed: a tick neither revives the entry nor throws.
        vi.advanceTimersByTime(500);
        expect(texts()).toEqual([]);

        adapter.report(1, "late");
        adapter.end(1);
        expect(texts()).toEqual([]);
    });

    it("parallel progresses are independent entries; a repeated start replaces", () => {
        adapter.start(1, "TS");
        adapter.start(2, "Go");
        expect(texts()).toEqual(["⠋ TS", "⠋ Go"]);

        adapter.end(1);
        expect(texts()).toEqual(["⠋ Go"]);

        adapter.start(2, "Go (restart)");
        expect(texts()).toEqual(["⠋ Go (restart)"]);
    });

    it("dispose clears all entries and timers; an empty title renders without a tail", () => {
        adapter.start(1, "");
        adapter.report(1, "message only");
        expect(texts()).toEqual(["⠋ message only"]);
        adapter.start(2, "B");

        adapter.dispose();
        expect(texts()).toEqual([]);
        vi.advanceTimersByTime(500);
        expect(texts()).toEqual([]);
    });
});
