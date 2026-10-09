import { describe, expect, it, vi } from "vitest";

import { makeTask } from "../../../../../TestUtils/taskFixtures.ts";
import { buildTaskServiceHarness } from "../../../../../TestUtils/taskServiceHarness.ts";
import { CODICON_GLYPHS } from "../../../../base/common/codicons.generated.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";

import type { TaskService } from "./taskService.ts";
import { RUNNING_TASKS_STATUS_ID, TaskStatusBarContribution } from "./taskStatusBarContribution.ts";
import type { ITaskEvent } from "./terminalTaskSystem.ts";

// Сегмент `$(tools) N` бегущих задач (`TaskStatusBarContributions` эталона).

describe("TaskStatusBarContribution", () => {
    it("появляется с первой задачей, считает бегущие, исчезает с последней; клик — Show Running Tasks", async () => {
        const h = buildTaskServiceHarness();
        const bar = new StatusBarService(NULL_STATE_SERVICE);
        const commands = new CommandRegistry();
        const showTasks = vi.fn();
        commands.register("workbench.action.tasks.showTasks", showTasks);
        const contribution = new TaskStatusBarContribution(bar, h.service, commands);
        const entry = () => bar.entries().find((e) => e.id === RUNNING_TASKS_STATUS_ID);
        expect(entry()).toBeUndefined();

        void h.service.run(makeTask({ label: "a" }));
        await vi.waitFor(() => {
            expect(entry()?.text).toBe(`${CODICON_GLYPHS.tools ?? ""} 1`);
        });
        expect(entry()).toMatchObject({ name: "Running Tasks", alignment: "left", priority: 50 });
        void h.service.run(makeTask({ label: "b" }));
        await vi.waitFor(() => {
            expect(entry()?.text).toBe(`${CODICON_GLYPHS.tools ?? ""} 2`);
        });
        expect(bar.entries().filter((e) => e.id === RUNNING_TASKS_STATUS_ID)).toHaveLength(1);
        entry()?.onClick?.();
        expect(showTasks).toHaveBeenCalledTimes(1);

        await h.service.terminateAll();
        expect(entry()).toBeUndefined();
        void h.service.run(makeTask({ label: "c" }));
        await vi.waitFor(() => {
            expect(entry()?.text).toBe(`${CODICON_GLYPHS.tools ?? ""} 1`);
        });
        contribution.dispose();
        expect(entry()).toBeUndefined();
        h.dispose();
    });

    it("перемена без бегущих задач и без сегмента — ничего (сегмента нет)", () => {
        const bar = new StatusBarService(NULL_STATE_SERVICE);
        const events = new Emitter<ITaskEvent>();
        const tasks = { onDidStateChange: events.event, getActiveTasks: () => [] } as unknown as TaskService;
        const contribution = new TaskStatusBarContribution(bar, tasks, new CommandRegistry());
        expect(() => {
            events.fire({ kind: "changed" });
        }).not.toThrow();
        expect(bar.entries().some((e) => e.id === RUNNING_TASKS_STATUS_ID)).toBe(false);
        contribution.dispose();
    });
});
