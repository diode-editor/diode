import { describe, expect, it } from "vitest";

import { CommandRegistry, CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { ProgressService, ProgressServiceDIToken } from "../../../../platform/progress/common/progressService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { GIT_OP_COMMAND } from "../common/gitProtocol.ts";
import { SCM_CHANGES_VIEW_ID, SCM_GRAPH_VIEW_ID } from "../common/scmViews.ts";

import { scmGraphLoadMoreAction, scmGraphRefreshAction } from "./graphActions.ts";

function makeAccessor(commands: CommandRegistry, progress = new ProgressService()): ServiceAccessor {
    const services = new Map<unknown, unknown>([
        [CommandRegistryDIToken, commands],
        [ProgressServiceDIToken, progress],
    ]);
    return { get: (t: unknown) => services.get(t) } as unknown as ServiceAccessor;
}

describe("scmGraphRefreshAction", () => {
    it("delegates to git.refresh when the extension command is registered", () => {
        const commands = new CommandRegistry();
        let refreshed = 0;
        commands.register("git.refresh", () => {
            refreshed++;
        });
        scmGraphRefreshAction.run(makeAccessor(commands));
        expect(refreshed).toBe(1);
    });

    it("refresh progress is addressed to the GRAPH section", async () => {
        const commands = new CommandRegistry();
        let release!: () => void;
        commands.register("git.refresh", () => new Promise<void>((resolve) => (release = resolve)));
        const progress = new ProgressService({ delayMs: 0, minVisibleMs: 0, intervalMs: 100 });

        const running = scmGraphRefreshAction.run(makeAccessor(commands, progress)) as Promise<void>;
        // A zero show delay is still a timer: wait for a macrotask.
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(progress.isBusy(SCM_GRAPH_VIEW_ID)).toBe(true);
        expect(progress.isBusy(SCM_CHANGES_VIEW_ID)).toBe(false);
        expect(progress.viewProgress().get(SCM_GRAPH_VIEW_ID)?.title).toBe("Loading History…");

        release();
        await running;
        expect(progress.isBusy()).toBe(false);
        progress.dispose();
    });

    it("before the extension activates: neither the command nor progress", () => {
        const commands = new CommandRegistry();
        const progress = new ProgressService();
        expect(() => scmGraphRefreshAction.run(makeAccessor(commands, progress))).not.toThrow();
        // A spinner without an operation would lie: no extension, nothing to run.
        expect(progress.isBusy()).toBe(false);
    });
});

describe("scmGraphLoadMoreAction", () => {
    it("asks the extension to extend the history page", async () => {
        const ops: unknown[] = [];
        const services = new Map<unknown, unknown>([
            [ProgressServiceDIToken, new ProgressService()],
            [
                CommandRegistryDIToken,
                {
                    has: () => true,
                    execute: (id: string, payload: unknown) => {
                        expect(id).toBe(GIT_OP_COMMAND);
                        ops.push(payload);
                        return { ok: true };
                    },
                },
            ],
        ]);
        const accessor = { get: (t: unknown) => services.get(t) } as unknown as ServiceAccessor;

        await scmGraphLoadMoreAction.run(accessor);
        expect(ops).toEqual([{ op: "logLoadMore", params: undefined }]);
    });

    it("without the git extension: silent no-op, no notice in the status bar", async () => {
        const notices: string[] = [];
        const services = new Map<unknown, unknown>([
            [ProgressServiceDIToken, new ProgressService()],
            [CommandRegistryDIToken, { has: () => false, execute: () => undefined }],
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
        const accessor = { get: (t: unknown) => services.get(t) } as unknown as ServiceAccessor;

        await expect(scmGraphLoadMoreAction.run(accessor)).resolves.toBeUndefined();
        expect(notices).toEqual([]);
    });
});
