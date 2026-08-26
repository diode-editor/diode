import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { ProgressService, ProgressServiceDIToken } from "../../../../platform/progress/common/progressService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { SCM_CHANGES_VIEW_ID, SCM_GRAPH_VIEW_ID } from "../common/scmViews.ts";

import { runGitOp } from "./gitOpClient.ts";
import { runGitTransport, STAGE_TRANSPORT_COMMAND } from "./stagingActions.ts";
import { runGitQuery } from "./syncActions.ts";

/**
 * Стенд продюсера прогресса: команда расширения зависает, пока тест не отпустит
 * её — так видно занятость именно во время операции, а не после.
 */
function makeAccessor(hasCommand = true): {
    accessor: ServiceAccessor;
    progress: ProgressService;
    release: () => void;
} {
    const progress = new ProgressService();
    let release!: () => void;
    const pending = new Promise<unknown>((resolve) => {
        release = () => resolve({ ok: true });
    });
    const services = new Map<unknown, unknown>([
        [ProgressServiceDIToken, progress],
        [CommandRegistryDIToken, { has: () => hasCommand, execute: () => pending }],
        [StatusBarServiceDIToken, { addEntry: () => ({ dispose: () => undefined }) }],
    ]);
    return {
        accessor: { get: (t: unknown) => services.get(t) } as unknown as ServiceAccessor,
        progress,
        release,
    };
}

describe("прогресс git-операций", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("операция диспетчера держит занятой свою секцию", async () => {
        const h = makeAccessor();
        const running = runGitOp(h.accessor, "commit");

        expect(h.progress.isBusy(SCM_CHANGES_VIEW_ID)).toBe(true);
        expect(h.progress.isBusy(SCM_GRAPH_VIEW_ID)).toBe(false);

        h.release();
        await running;
        expect(h.progress.isBusy()).toBe(false);
    });

    it("сетевая операция видна ещё и в статус-баре, обычная — только в секции", async () => {
        const network = makeAccessor();
        const pulling = runGitOp(network.accessor, "pull");
        vi.advanceTimersByTime(300);
        // Долгий pull видно, даже когда в сайдбаре открыт не Source Control.
        expect(network.progress.windowProgress()).toEqual({ spinner: "⠋", title: "Pulling…" });
        expect(network.progress.viewProgress().get(SCM_CHANGES_VIEW_ID)?.title).toBe("Pulling…");
        network.release();
        await pulling;

        const local = makeAccessor();
        const committing = runGitOp(local.accessor, "commit");
        vi.advanceTimersByTime(300);
        expect(local.progress.windowProgress()).toBeNull();
        expect(local.progress.viewProgress().get(SCM_CHANGES_VIEW_ID)?.title).toBe("Committing…");
        local.release();
        await committing;
    });

    it("догрузка истории адресована секции GRAPH", async () => {
        const h = makeAccessor();
        const running = runGitOp(h.accessor, "logLoadMore");

        expect(h.progress.isBusy(SCM_GRAPH_VIEW_ID)).toBe(true);
        expect(h.progress.isBusy(SCM_CHANGES_VIEW_ID)).toBe(false);

        h.release();
        await running;
    });

    it("стейджинг идёт своим транспортом и тоже даёт прогресс", async () => {
        const h = makeAccessor();
        const running = runGitTransport(h.accessor, STAGE_TRANSPORT_COMMAND, [Uri.file("/repo/app.ts")]);

        expect(h.progress.isBusy(SCM_CHANGES_VIEW_ID)).toBe(true);

        // Подпись берётся из имени операции, а его у транспорта надо достать из
        // id команды: иначе вместо «Staging…» будет нейтральное «Working…».
        vi.advanceTimersByTime(300);
        expect(h.progress.viewProgress().get(SCM_CHANGES_VIEW_ID)?.title).toBe("Staging…");

        h.release();
        await running;
        expect(h.progress.isBusy()).toBe(false);
    });

    it("read-only запрос расширения прогресса не поднимает", async () => {
        const h = makeAccessor();
        const running = runGitQuery(h.accessor, "refs");

        expect(h.progress.isBusy()).toBe(false);

        h.release();
        await running;
    });

    it("расширения нет — нет и прогресса", async () => {
        const h = makeAccessor(false);
        await runGitOp(h.accessor, "commit");
        expect(h.progress.isBusy()).toBe(false);
    });

    it("упавшая операция прогресс закрывает", async () => {
        const progress = new ProgressService();
        const services = new Map<unknown, unknown>([
            [ProgressServiceDIToken, progress],
            [
                CommandRegistryDIToken,
                {
                    has: () => true,
                    execute: () => Promise.reject(new Error("boom")),
                },
            ],
            [StatusBarServiceDIToken, { addEntry: () => ({ dispose: () => undefined }) }],
        ]);
        const accessor = { get: (t: unknown) => services.get(t) } as unknown as ServiceAccessor;

        await runGitOp(accessor, "commit");
        expect(progress.isBusy()).toBe(false);
    });
});
