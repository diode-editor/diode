import { describe, expect, it } from "vitest";

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
    it("операция диспетчера держит занятой свою секцию", async () => {
        const h = makeAccessor();
        const running = runGitOp(h.accessor, "commit");

        expect(h.progress.isBusy(SCM_CHANGES_VIEW_ID)).toBe(true);
        expect(h.progress.isBusy(SCM_GRAPH_VIEW_ID)).toBe(false);

        h.release();
        await running;
        expect(h.progress.isBusy()).toBe(false);
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
