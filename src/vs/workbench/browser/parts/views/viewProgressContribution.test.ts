import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProgressService } from "../../../../platform/progress/common/progressService.ts";

import { ViewProgressContribution } from "./viewProgressContribution.ts";
import type { ViewsService } from "./viewsService.ts";

const CHANGES = "workbench.scm.changes";
const GRAPH = "workbench.scm.graph";

function fakeViews(): { views: ViewsService; frames: Map<string, string | null>; calls: number } {
    const state = { frames: new Map<string, string | null>(), calls: 0 };
    const views = {
        setViewSpinner: (viewId: string, frame: string | null) => {
            state.frames.set(viewId, frame);
            state.calls++;
        },
    } as unknown as ViewsService;
    return {
        views,
        get frames() {
            return state.frames;
        },
        get calls() {
            return state.calls;
        },
    };
}

describe("ViewProgressContribution", () => {
    let progress: ProgressService;

    beforeEach(() => {
        vi.useFakeTimers();
        progress = new ProgressService({ delayMs: 300, minVisibleMs: 500, intervalMs: 100 });
    });

    afterEach(() => {
        progress.dispose();
        vi.useRealTimers();
    });

    it("distributes frames to sections and removes them from finished ones", async () => {
        const target = fakeViews();
        const contribution = new ViewProgressContribution(progress, target.views);

        let done!: () => void;
        const running = progress.withProgress(
            { location: "view", viewId: CHANGES, title: "Committing…" },
            () =>
                new Promise<void>((resolve) => {
                    done = resolve;
                }),
        );

        // Before the show delay there is no spinner frame, so the header isn't touched at all.
        expect(target.frames.size).toBe(0);

        vi.advanceTimersByTime(300);
        expect(target.frames.get(CHANGES)).toBe("⠋");
        vi.advanceTimersByTime(100);
        expect(target.frames.get(CHANGES)).toBe("⠙");

        done();
        await running;
        vi.advanceTimersByTime(500);
        // The service has forgotten the operation; removing the spinner is the contribution's job.
        expect(target.frames.get(CHANGES)).toBeNull();

        // And remove it exactly once: the next operation (in another section) must not
        // clear the spinner again on the one that finished long ago.
        const callsAfterRemoval = target.calls;
        let doneGraph!: () => void;
        const graph = progress.withProgress(
            { location: "view", viewId: GRAPH, title: "Refreshing…" },
            () =>
                new Promise<void>((resolve) => {
                    doneGraph = resolve;
                }),
        );
        vi.advanceTimersByTime(300);
        expect(target.frames.get(GRAPH)).toBe("⠋");
        // Exactly one call, for the GRAPH frame; CHANGES is not touched again.
        expect(target.calls).toBe(callsAfterRemoval + 1);

        doneGraph();
        await graph;
        vi.advanceTimersByTime(500);

        contribution.dispose();
    });

    it("sections are independent", async () => {
        const target = fakeViews();
        const contribution = new ViewProgressContribution(progress, target.views);

        let doneGraph!: () => void;
        const graph = progress.withProgress(
            { location: "view", viewId: GRAPH, title: "Refreshing…" },
            () =>
                new Promise<void>((resolve) => {
                    doneGraph = resolve;
                }),
        );
        vi.advanceTimersByTime(300);
        expect(target.frames.get(GRAPH)).toBe("⠋");
        expect(target.frames.has(CHANGES)).toBe(false);

        doneGraph();
        await graph;
        vi.advanceTimersByTime(500);
        expect(target.frames.get(GRAPH)).toBeNull();

        contribution.dispose();
    });

    it("window progress does not touch headers", () => {
        const target = fakeViews();
        const contribution = new ViewProgressContribution(progress, target.views);

        void progress.withProgress({ location: "window", title: "Fetching…" }, () => new Promise<void>(() => {}));
        vi.advanceTimersByTime(1000);
        expect(target.calls).toBe(0);

        contribution.dispose();
    });

    it("after dispose frames are no longer distributed", () => {
        const target = fakeViews();
        const contribution = new ViewProgressContribution(progress, target.views);
        contribution.dispose();

        void progress.withProgress(
            { location: "view", viewId: CHANGES, title: "Committing…" },
            () => new Promise<void>(() => {}),
        );
        vi.advanceTimersByTime(1000);
        expect(target.calls).toBe(0);
    });
});
