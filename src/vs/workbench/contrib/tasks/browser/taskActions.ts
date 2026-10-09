// Команды задач (`task.contribution.ts` + `_registerCommands` эталона): Run
// Task, Rerun Last Task, Restart Running Task, Terminate Task, Show Running
// Tasks — с заголовками палитры эталона и пунктами меню Terminal.

import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import type { ITask } from "../common/tasks.ts";

import { pickTaskToRun } from "./taskQuickPick.ts";
import { TaskServiceDIToken } from "./taskService.ts";

/** Группы меню Terminal эталона (`TerminalMenuBarGroup`). */
export const TERMINAL_MENU_RUN_GROUP = "3_run";
export const TERMINAL_MENU_MANAGE_GROUP = "5_manage";

/** `TASK_RUNNING_STATE` эталона: пункты «управления» недоступны, пока ничего не бежит (серыми их меню не рисует). */
const TASK_RUNNING = "taskRunning";

/** Сбой запуска уже показан человеку сервисом — обещание команды не отклоняется. */
// Stryker disable next-line BlockStatement: эквивалентный — пустое тело тоже возвращает undefined
function ignore(): undefined {
    return undefined;
}

/**
 * Run Task (`_runTaskCommand`): без аргумента — пикер; строка — задача с этой
 * подписью, определение (`{ type, … }`) — задача провайдера по ключу; не нашлась
 * — пикер (с аргументом-определением — сразу на уровне его типа).
 */
export async function runTaskCommand(accessor: ServiceAccessor, arg?: unknown): Promise<void> {
    const service = accessor.get(TaskServiceDIToken);
    // Команда кончается запуском, а не задачей (долгая задача держала бы промис команды).
    const runInBackground = (task: ITask): void => {
        void service.run(task).catch(ignore);
    };
    const pickAndRun = async (type?: string): Promise<void> => {
        const task = await pickTaskToRun(
            service,
            accessor.get(QuickInputServiceDIToken),
            accessor.get(IConfigurationServiceDIToken),
            type,
        );
        if (task !== undefined) runInBackground(task);
    };
    const identifier = service.taskIdentifierOf(arg);
    if (identifier === undefined) {
        await pickAndRun();
        return;
    }
    // Stryker disable next-line ConditionalExpression,StringLiteral: эквивалентный — у строки-подписи `.type` и так undefined; проверка — для типов
    const type = typeof identifier === "string" ? undefined : identifier.type;
    const task = service.findTask(await service.groupedTasks(type), identifier);
    if (task === undefined) {
        await pickAndRun(type);
        return;
    }
    runInBackground(task);
}

export const runTaskAction: CommandAction = {
    id: "workbench.action.tasks.runTask",
    title: "Tasks: Run Task",
    menus: [{ menuId: MenuId.MenubarTerminalMenu, group: TERMINAL_MENU_RUN_GROUP, order: 1, title: "Run Task..." }],
    run(accessor, arg) {
        return runTaskCommand(accessor, arg);
    },
};

export const reRunTaskAction: CommandAction = {
    id: "workbench.action.tasks.reRunTask",
    title: "Tasks: Rerun Last Task",
    run(accessor) {
        return accessor.get(TaskServiceDIToken).rerun(() => runTaskCommand(accessor));
    },
};

/**
 * Restart Running Task (`_runRestartTaskCommand`): одна бегущая — она;
 * аргумент — подходящая бегущая; иначе пикер бегущих.
 */
async function restartTaskCommand(accessor: ServiceAccessor, arg: unknown): Promise<void> {
    const service = accessor.get(TaskServiceDIToken);
    const active = service.getActiveTasks();
    if (active.length === 1) {
        await service.restart(active[0]);
        return;
    }
    const identifier = service.taskIdentifierOf(arg);
    const matching = identifier === undefined ? undefined : service.findTask(active, identifier);
    if (matching !== undefined) {
        await service.restart(matching);
        return;
    }
    const entry = await service.pickTask(active, "Select the task to restart", { label: "No task to restart" });
    if (entry?.task !== undefined) await service.restart(entry.task);
}

export const restartTaskAction: CommandAction = {
    id: "workbench.action.tasks.restartTask",
    title: "Tasks: Restart Running Task",
    menus: [
        {
            menuId: MenuId.MenubarTerminalMenu,
            group: TERMINAL_MENU_MANAGE_GROUP,
            order: 2,
            title: "Restart Running Task...",
            enablement: TASK_RUNNING,
        },
    ],
    run(accessor, arg) {
        return restartTaskCommand(accessor, arg);
    },
};

/** Аргумент `'terminateAll'` и строка пикера «All Running Tasks» — остановить всё. */
export const TERMINATE_ALL = "terminateAll";

/**
 * Terminate Task (`_runTerminateCommand`): `'terminateAll'` — все; аргумент —
 * подходящая бегущая; иначе пикер бегущих со строкой «All Running Tasks».
 */
async function terminateTaskCommand(accessor: ServiceAccessor, arg: unknown): Promise<void> {
    const service = accessor.get(TaskServiceDIToken);
    if (arg === TERMINATE_ALL) {
        await service.terminateAll();
        return;
    }
    const active = service.getActiveTasks();
    const identifier = service.taskIdentifierOf(arg);
    const matching = identifier === undefined ? undefined : service.findTask(active, identifier);
    if (matching !== undefined) {
        await service.terminate(matching);
        return;
    }
    const entry = await service.pickTask(
        active,
        "Select a task to terminate",
        { label: "No task is currently running" },
        { label: "All Running Tasks", id: TERMINATE_ALL },
    );
    if (entry?.id === TERMINATE_ALL) await service.terminateAll();
    else if (entry?.task !== undefined) await service.terminate(entry.task);
}

export const terminateTaskAction: CommandAction = {
    id: "workbench.action.tasks.terminate",
    title: "Tasks: Terminate Task",
    menus: [
        {
            menuId: MenuId.MenubarTerminalMenu,
            group: TERMINAL_MENU_MANAGE_GROUP,
            order: 3,
            title: "Terminate Task...",
            enablement: TASK_RUNNING,
        },
    ],
    run(accessor, arg) {
        return terminateTaskCommand(accessor, arg);
    },
};

export const showTasksAction: CommandAction = {
    id: "workbench.action.tasks.showTasks",
    title: "Tasks: Show Running Tasks",
    menus: [
        {
            menuId: MenuId.MenubarTerminalMenu,
            group: TERMINAL_MENU_MANAGE_GROUP,
            order: 1,
            title: "Show Running Tasks...",
            enablement: TASK_RUNNING,
        },
    ],
    run(accessor) {
        return accessor.get(TaskServiceDIToken).showRunningTasks();
    },
};

/** Экшены задач. Фича отдаёт их одним массивом; регистрирует агрегатор (`WORKBENCH_ACTIONS`). */
export const TASKS_ACTIONS: readonly CommandAction[] = [
    runTaskAction,
    reRunTaskAction,
    restartTaskAction,
    terminateTaskAction,
    showTasksAction,
];
