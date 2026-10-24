import { Disposable } from "../../../../base/common/lifecycle.ts";
import { type CommandRegistry, CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type IProductIconService,
    NERD_FONT_ICONS,
    ProductIconServiceDIToken,
} from "../../../../platform/theme/common/productIconService.ts";
import {
    type IStatusBarEntryHandle,
    type StatusBarService,
    StatusBarServiceDIToken,
} from "../../../services/statusbar/common/statusBarService.ts";

import { type TaskService, TaskServiceDIToken } from "./taskService.ts";

export const TaskStatusBarContributionDIToken = token<TaskStatusBarContribution>("TaskStatusBarContribution");

/** The id under which the status bar menu hides the entry. */
export const RUNNING_TASKS_STATUS_ID = "status.runningTasks";

/** Upstream's "Building..." progress relies on a build group with matchers; we have none, so no progress either. */
export class TaskStatusBarContribution extends Disposable {
    public static dependencies = [
        StatusBarServiceDIToken,
        TaskServiceDIToken,
        CommandRegistryDIToken,
        ProductIconServiceDIToken,
    ] as const;

    private handle: IStatusBarEntryHandle | null = null;

    public constructor(
        private readonly statusBar: StatusBarService,
        private readonly tasks: TaskService,
        private readonly commands: CommandRegistry,
        private readonly icons: IProductIconService = NERD_FONT_ICONS,
    ) {
        super();
        this.register(
            // With no running task there is no segment, and update keeps it that way.
            icons.onDidChange(() => {
                this.update();
            }),
        );
        this.register(
            tasks.onDidStateChange((event) => {
                // Stryker disable next-line ConditionalExpression,EqualityOperator: equivalent: update is idempotent, "changed" trims extra ones
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
        const text = this.icons.renderCodicons(`$(tools) ${String(count)}`);
        if (this.handle !== null) {
            this.handle.update({ text });
            return;
        }
        this.handle = this.statusBar.addEntry({
            id: RUNNING_TASKS_STATUS_ID,
            name: "Running Tasks",
            text,
            alignment: "left",
            // Next to Problems, as upstream (`location: status.problems, priority 50`).
            priority: 50,
            onClick: () => {
                void this.commands.execute("workbench.action.tasks.showTasks");
            },
        });
    }
}
