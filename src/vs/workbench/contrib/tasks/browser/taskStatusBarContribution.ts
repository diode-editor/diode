import { renderCodicons } from "../../../../base/common/codicons.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { type CommandRegistry, CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type IStatusBarEntryHandle,
    type StatusBarService,
    StatusBarServiceDIToken,
} from "../../../services/statusbar/common/statusBarService.ts";

import { type TaskService, TaskServiceDIToken } from "./taskService.ts";

export const TaskStatusBarContributionDIToken = token<TaskStatusBarContribution>("TaskStatusBarContribution");

/** Id сегмента — как у эталона (`status.runningTasks`), под ним его прячут в меню полосы. */
export const RUNNING_TASKS_STATUS_ID = "status.runningTasks";

/**
 * Сегмент бегущих задач (`TaskStatusBarContributions` эталона): `$(tools) N`,
 * пока бежит хоть одна задача; клик — Show Running Tasks. Подсказки
 * («Show Running Tasks») у записей статус-бара Diode нет. Прогресс «Building...»
 * эталона завязан на группу build с матчерами — их нет, и его тоже нет.
 */
export class TaskStatusBarContribution extends Disposable {
    public static dependencies = [StatusBarServiceDIToken, TaskServiceDIToken, CommandRegistryDIToken] as const;

    private handle: IStatusBarEntryHandle | null = null;

    public constructor(
        private readonly statusBar: StatusBarService,
        private readonly tasks: TaskService,
        private readonly commands: CommandRegistry,
    ) {
        super();
        this.register(
            tasks.onDidStateChange((event) => {
                // Stryker disable next-line ConditionalExpression,EqualityOperator: эквивалентный — пересчёт идемпотентен, «changed» лишь сокращает лишние
                if (event.kind === "changed") this.update();
            }),
        );
        this.register({
            dispose: () => {
                this.handle?.dispose();
            },
        });
    }

    private update(): void {
        const count = this.tasks.getActiveTasks().length;
        if (count === 0) {
            this.handle?.dispose();
            this.handle = null;
            return;
        }
        const text = renderCodicons(`$(tools) ${String(count)}`);
        if (this.handle !== null) {
            this.handle.update({ text });
            return;
        }
        this.handle = this.statusBar.addEntry({
            id: RUNNING_TASKS_STATUS_ID,
            name: "Running Tasks",
            text,
            alignment: "left",
            // Рядом с Problems, как у эталона (`location: status.problems, priority 50`).
            priority: 50,
            onClick: () => {
                void this.commands.execute("workbench.action.tasks.showTasks");
            },
        });
    }
}
