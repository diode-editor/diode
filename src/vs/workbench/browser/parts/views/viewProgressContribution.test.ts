import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProgressService } from "../../../../platform/progress/common/progressService.ts";

import { ViewProgressContribution } from "./viewProgressContribution.ts";
import type { ViewsService } from "./viewsService.ts";

const CHANGES = "workbench.scm.changes";
const GRAPH = "workbench.scm.graph";

/** Записывает, какой кадр контрибуция положила в какую секцию. */
function fakeViews(): { views: ViewsService; frames: Map<string, string | null>; calls: number } {
    const state = { frames: new Map<string, string | null>(), calls: 0 };
    const views = {
        setViewSpinner: (viewId: string, frame: string | null) => {
            state.frames.set(viewId, frame);
            state.calls++;
        },
    } as unknown as ViewsService;
    return { views, get frames() { return state.frames; }, get calls() { return state.calls; } };
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

    it("раскладывает кадры по секциям и снимает их у закончивших", async () => {
        const target = fakeViews();
        const contribution = new ViewProgressContribution(progress, target.views);

        let done!: () => void;
        const running = progress.withProgress({ location: "view", viewId: CHANGES, title: "Committing…" }, () =>
            new Promise<void>((resolve) => {
                done = resolve;
            }),
        );

        // До задержки показа кадра нет — заголовок не трогаем вовсе.
        expect(target.frames.size).toBe(0);

        vi.advanceTimersByTime(300);
        expect(target.frames.get(CHANGES)).toBe("◐");
        vi.advanceTimersByTime(100);
        expect(target.frames.get(CHANGES)).toBe("◓");

        done();
        await running;
        vi.advanceTimersByTime(500);
        // Сервис про операцию забыл — снять спиннер обязана контрибуция.
        expect(target.frames.get(CHANGES)).toBeNull();

        // И снять ровно один раз: секция, с которой спиннер уже снят, больше не
        // должна попадать в раскладку кадров.
        const callsAfterRemoval = target.calls;
        vi.advanceTimersByTime(1000);
        expect(target.calls).toBe(callsAfterRemoval);

        contribution.dispose();
    });

    it("секции независимы", async () => {
        const target = fakeViews();
        const contribution = new ViewProgressContribution(progress, target.views);

        let doneGraph!: () => void;
        const graph = progress.withProgress({ location: "view", viewId: GRAPH, title: "Refreshing…" }, () =>
            new Promise<void>((resolve) => {
                doneGraph = resolve;
            }),
        );
        vi.advanceTimersByTime(300);
        expect(target.frames.get(GRAPH)).toBe("◐");
        expect(target.frames.has(CHANGES)).toBe(false);

        doneGraph();
        await graph;
        vi.advanceTimersByTime(500);
        expect(target.frames.get(GRAPH)).toBeNull();

        contribution.dispose();
    });

    it("window-прогресс заголовков не трогает", () => {
        const target = fakeViews();
        const contribution = new ViewProgressContribution(progress, target.views);

        void progress.withProgress({ location: "window", title: "Fetching…" }, () => new Promise<void>(() => {}));
        vi.advanceTimersByTime(1000);
        expect(target.calls).toBe(0);

        contribution.dispose();
    });

    it("после dispose кадры больше не раскладываются", () => {
        const target = fakeViews();
        const contribution = new ViewProgressContribution(progress, target.views);
        contribution.dispose();

        void progress.withProgress({ location: "view", viewId: CHANGES, title: "Committing…" }, () => new Promise<void>(() => {}));
        vi.advanceTimersByTime(1000);
        expect(target.calls).toBe(0);
    });
});
