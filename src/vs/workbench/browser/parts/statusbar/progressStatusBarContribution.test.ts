import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProgressService } from "../../../../platform/progress/common/progressService.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";

import { ProgressStatusBarContribution } from "./progressStatusBarContribution.ts";

describe("ProgressStatusBarContribution", () => {
    let progress: ProgressService;
    let statusBar: StatusBarService;
    let contribution: ProgressStatusBarContribution;

    beforeEach(() => {
        vi.useFakeTimers();
        progress = new ProgressService({ delayMs: 300, minVisibleMs: 500, intervalMs: 100 });
        statusBar = new StatusBarService(NULL_STATE_SERVICE);
        contribution = new ProgressStatusBarContribution(progress, statusBar);
    });

    afterEach(() => {
        contribution.dispose();
        progress.dispose();
        vi.useRealTimers();
    });

    function texts(): string[] {
        return statusBar.entries().map((entry) => entry.text);
    }

    it("window-прогресс появляется записью со спиннером и снимается", async () => {
        let done!: () => void;
        const running = progress.withProgress({ location: "window", title: "Pushing…" }, () =>
            new Promise<void>((resolve) => {
                done = resolve;
            }),
        );
        expect(texts()).toEqual([]);

        vi.advanceTimersByTime(300);
        expect(texts()).toEqual(["⠋ Pushing…"]);
        vi.advanceTimersByTime(100);
        expect(texts()).toEqual(["⠙ Pushing…"]);

        done();
        await running;
        vi.advanceTimersByTime(500);
        expect(texts()).toEqual([]);
    });

    it("прогресс секции статус-бар не трогает", () => {
        void progress.withProgress(
            { location: "view", viewId: "workbench.scm.changes", title: "Committing…" },
            () => new Promise<void>(() => {}),
        );
        vi.advanceTimersByTime(1000);
        expect(texts()).toEqual([]);
    });

    it("dispose снимает живую запись", () => {
        void progress.withProgress({ location: "window", title: "Fetching…" }, () => new Promise<void>(() => {}));
        vi.advanceTimersByTime(300);
        expect(texts()).toHaveLength(1);

        contribution.dispose();
        expect(texts()).toEqual([]);
    });
});
