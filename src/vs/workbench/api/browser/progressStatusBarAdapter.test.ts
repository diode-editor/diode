import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NULL_STATE_SERVICE } from "../../../platform/state/common/nullStateService.ts";
import { StatusBarService } from "../../services/statusbar/common/statusBarService.ts";

import { ProgressStatusBarAdapter } from "./progressStatusBarAdapter.ts";

// Мост withProgress → статус-бар: запись со спиннером живёт от start до end,
// report обновляет сообщение/процент, таймеры не переживают end/dispose.

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

    it("start добавляет запись со спиннером, тик таймера крутит кадр", () => {
        adapter.start(1, "TS: starting");
        expect(texts()).toEqual(["◐ TS: starting"]);

        vi.advanceTimersByTime(100);
        expect(texts()).toEqual(["◓ TS: starting"]);
        vi.advanceTimersByTime(100);
        expect(texts()).toEqual(["◑ TS: starting"]);
    });

    it("report обновляет сообщение и накапливает процент с клампом 0–100", () => {
        adapter.start(1, "TS");
        adapter.report(1, "loading project");
        expect(texts()).toEqual(["◐ TS · loading project"]);

        adapter.report(1, undefined, 30);
        expect(texts()).toEqual(["◐ TS · loading project (30%)"]);

        adapter.report(1, "indexing", 50);
        expect(texts()).toEqual(["◐ TS · indexing (80%)"]);

        adapter.report(1, undefined, 999);
        expect(texts()).toEqual(["◐ TS · indexing (100%)"]);
    });

    it("end снимает запись и глушит таймер; report/end по неизвестному handle — no-op", () => {
        adapter.start(1, "TS");
        adapter.end(1);
        expect(texts()).toEqual([]);

        // Таймер убит: тик не воскрешает запись и не падает.
        vi.advanceTimersByTime(500);
        expect(texts()).toEqual([]);

        adapter.report(1, "late");
        adapter.end(1);
        expect(texts()).toEqual([]);
    });

    it("параллельные прогрессы — независимые записи; повторный start замещает", () => {
        adapter.start(1, "TS");
        adapter.start(2, "Go");
        expect(texts()).toEqual(["◐ TS", "◐ Go"]);

        adapter.end(1);
        expect(texts()).toEqual(["◐ Go"]);

        // Повторный start того же handle — защитная замена, а не дубль.
        adapter.start(2, "Go (restart)");
        expect(texts()).toEqual(["◐ Go (restart)"]);
    });

    it("dispose гасит все записи и таймеры; пустой title рендерится без хвоста", () => {
        adapter.start(1, "");
        adapter.report(1, "message only");
        expect(texts()).toEqual(["◐ message only"]);
        adapter.start(2, "B");

        adapter.dispose();
        expect(texts()).toEqual([]);
        vi.advanceTimersByTime(500);
        expect(texts()).toEqual([]);
    });
});
