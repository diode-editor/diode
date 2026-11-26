// Our picker has no group separators: the group label is a hint on the group's first
// row, where upstream draws the separator label.
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { type IProductIconService, NERD_FONT_ICONS } from "../../../../platform/theme/common/productIconService.ts";
import type { QuickInputService } from "../../../browser/parts/quickinput/quickInputService.ts";
import { compareTasks, type IConfiguringTask, type ITask } from "../common/tasks.ts";

import type { ITaskQuickPickEntry, TaskService } from "./taskService.ts";

export const RUN_TASK_PLACEHOLDER = "Select the task to run";
export const SHOW_ALL_TASKS = "Show All Tasks...";
export const GO_BACK = "Go back ↩";
export const CONFIGURE_A_TASK = "$(plus) Configure a Task";

interface IRunTaskEntry extends ITaskQuickPickEntry {
    readonly configuring?: IConfiguringTask;
    readonly type?: string;
    readonly showAll?: true;
    readonly goBack?: true;
    readonly configure?: true;
}

interface IConfiguredTasks {
    readonly tasks: readonly ITask[];
    readonly configuring: readonly IConfiguringTask[];
}

function withGroupLabel(entries: readonly IRunTaskEntry[], label: string): IRunTaskEntry[] {
    return entries.map((entry, index) => (index === 0 ? { ...entry, hint: label } : entry));
}

async function configuredTasks(service: TaskService): Promise<IConfiguredTasks> {
    const { tasks, configuring } = await service.getWorkspaceConfiguration();
    return {
        tasks: tasks.filter((task) => task.hide !== true),
        configuring: configuring.filter((entry) => entry.customization.hide !== true),
    };
}

/** `null` means "Configure a Task" was picked. A single task with `task.quickOpen.skip` skips the picker. */
export async function pickTaskToRun(
    service: TaskService,
    quickInput: QuickInputService,
    configuration: IConfigurationService,
    startAtType?: string,
    icons: IProductIconService = NERD_FONT_ICONS,
): Promise<ITask | null | undefined> {
    if (startAtType !== undefined) return pickFromLevels(service, quickInput, icons, startAtType);
    const configured = await configuredTasks(service);
    if (configured.tasks.length + configured.configuring.length === 1 && configuration.get("task.quickOpen.skip")) {
        const single = configured.configuring.at(0);
        return single === undefined ? configured.tasks[0] : service.resolveConfiguringTask(single);
    }
    return pickFromLevels(service, quickInput, icons, undefined, configured);
}

async function pickFromLevels(
    service: TaskService,
    quickInput: QuickInputService,
    icons: IProductIconService,
    type: string | undefined,
    configured?: IConfiguredTasks,
): Promise<ITask | null | undefined> {
    const pickLevel = async (level: string | undefined): Promise<IRunTaskEntry | undefined> =>
        pick(
            quickInput,
            level === undefined ? await firstLevel(service, icons, configured) : await secondLevel(service, level),
        );
    let level: string | undefined = type;
    // Escape leaves the picker.
    for (let entry = await pickLevel(level); entry !== undefined; entry = await pickLevel(level)) {
        if (entry.task !== undefined) return entry.task;
        if (entry.configuring !== undefined) return service.resolveConfiguringTask(entry.configuring);
        if (entry.configure === true) return null;
        if (entry.goBack === true) level = undefined;
        else if (entry.showAll === true) level = SHOW_ALL_TASKS;
        // What is left is a type row of the first level.
        else level = entry.type;
    }
    return undefined;
}

async function pick(
    quickInput: QuickInputService,
    items: readonly IRunTaskEntry[],
): Promise<IRunTaskEntry | undefined> {
    return (await quickInput.quickPick({ placeholder: RUN_TASK_PLACEHOLDER, items })) as IRunTaskEntry | undefined;
}

async function firstLevel(
    service: TaskService,
    icons: IProductIconService,
    configured?: IConfiguredTasks,
): Promise<IRunTaskEntry[]> {
    // Awaited either way: v8 counts the code after an `await` per resumption, a skipped one would leave the
    // branches below under-counted.
    const { tasks, configuring } = await (configured ?? configuredTasks(service));
    const configuredEntries: IRunTaskEntry[] = [
        ...service.taskEntries(tasks),
        ...configuring.map((entry) => ({ label: entry._label, configuring: entry })),
    ].sort((a, b) => a.label.localeCompare(b.label));
    if (configuredEntries.length === 0)
        configuredEntries.push({ label: icons.renderCodicons(CONFIGURE_A_TASK), configure: true });
    const entries: IRunTaskEntry[] = withGroupLabel(configuredEntries, "configured");
    const types = service.taskTypes();
    if (types.length > 0) {
        const typeEntries: IRunTaskEntry[] = types.map((type) => ({
            label: icons.renderCodicons(`$(folder) ${type}`),
            type,
        }));
        entries.push(...withGroupLabel(typeEntries, "contributed"), { label: SHOW_ALL_TASKS, showAll: true });
    }
    return entries;
}

async function secondLevel(service: TaskService, type: string): Promise<IRunTaskEntry[]> {
    if (type === SHOW_ALL_TASKS) {
        return service.taskEntries((await service.tasks()).filter((task) => task.hide !== true).sort(compareTasks));
    }
    const tasks = (await service.tasks({ type })).filter((task) => task.hide !== true).sort(compareTasks);
    if (tasks.length === 0) return [{ label: `No ${type} tasks found. ${GO_BACK}`, goBack: true }];
    return [...service.taskEntries(tasks), { label: GO_BACK, goBack: true }];
}
