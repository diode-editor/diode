import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { ProgressService, ProgressServiceDIToken } from "../../../../platform/progress/common/progressService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";

import { runGitOp } from "./gitOpClient.ts";

function makeAccessor(opts: {
    has?: boolean;
    execute?: () => unknown;
}): { accessor: ServiceAccessor; notices: string[] } {
    const notices: string[] = [];
    const services = new Map<unknown, unknown>([
        // Прогресс операций: транспортные швы просят его у контейнера.
        [ProgressServiceDIToken, new ProgressService()],
        [
            CommandRegistryDIToken,
            { has: () => opts.has !== false, execute: opts.execute ?? (() => ({ ok: true })) },
        ],
        [
            StatusBarServiceDIToken,
            {
                addEntry: (entry: { text: string }) => {
                    notices.push(entry.text);
                    return { dispose: () => undefined };
                },
            },
        ],
    ]);
    return {
        accessor: {
            get(token: unknown) {
                if (services.has(token)) return services.get(token);
                throw new Error("unexpected token");
            },
        } as unknown as ServiceAccessor,
        notices,
    };
}

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

describe("runGitOp", () => {
    it("расширение не активно — null без notice", async () => {
        const { accessor, notices } = makeAccessor({ has: false });
        expect(await runGitOp(accessor, "commit")).toBeNull();
        expect(notices).toEqual([]);
    });

    it("реджект канала и мусорный ответ — null", async () => {
        const rejected = makeAccessor({ execute: () => Promise.reject(new Error("closed")) });
        expect(await runGitOp(rejected.accessor, "commit")).toBeNull();

        const garbage = makeAccessor({ execute: () => "garbage" });
        expect(await runGitOp(garbage.accessor, "commit")).toBeNull();
    });

    it("ошибка операции — notice; silent подавляет", async () => {
        const failure = { ok: false, kind: "git-error", message: "boom" };
        const loud = makeAccessor({ execute: () => failure });
        expect(await runGitOp(loud.accessor, "commit")).toEqual(failure);
        expect(loud.notices).toEqual(["Git: boom"]);
        vi.runAllTimers(); // dispose notice — не бросает

        const silent = makeAccessor({ execute: () => failure });
        expect(await runGitOp(silent.accessor, "commit", undefined, { silent: true })).toEqual(failure);
        expect(silent.notices).toEqual([]);
    });
});
