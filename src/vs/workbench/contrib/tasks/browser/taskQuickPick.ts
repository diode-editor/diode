// Двухуровневый пикер Run Task (`taskQuickPick.ts` эталона): на первом уровне
// — задачи из tasks.json и по пункту на тип задач провайдеров, на втором —
// задачи выбранного типа и «Go back ↩». Разделителей групп у нашего пикера
// нет: подпись группы («configured», «contributed») стоит подсказкой справа у
// первой строки группы — там же, где эталон рисует метку разделителя.

import { renderCodicons } from "../../../../base/common/codicons.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import type { QuickInputService } from "../../../browser/parts/quickinput/quickInputService.ts";
import { compareTasks, type ITask } from "../common/tasks.ts";

import type { ITaskQuickPickEntry, TaskService } from "./taskService.ts";

export const RUN_TASK_PLACEHOLDER = "Select the task to run";
export const SHOW_ALL_TASKS = "Show All Tasks...";
export const GO_BACK = "Go back ↩";

/** Строка пикера: задача, тип второго уровня, «показать все» или «назад». */
interface IRunTaskEntry extends ITaskQuickPickEntry {
    readonly type?: string;
    readonly showAll?: true;
    readonly goBack?: true;
}

/** С подписью группы у первой строки (место разделителя эталона). */
function withGroupLabel(entries: readonly IRunTaskEntry[], label: string): IRunTaskEntry[] {
    return entries.map((entry, index) => (index === 0 ? { ...entry, hint: label } : entry));
}

/**
 * Показать Run Task и вернуть выбранную задачу (`TaskQuickPick.show`):
 * `startAtType` открывает сразу второй уровень. Одна задача в tasks.json и
 * `task.quickOpen.skip` — без пикера.
 */
export async function pickTaskToRun(
    service: TaskService,
    quickInput: QuickInputService,
    configuration: IConfigurationService,
    startAtType?: string,
): Promise<ITask | undefined> {
    if (startAtType !== undefined) return pickFromLevels(service, quickInput, startAtType);
    const configured = [...(await service.getWorkspaceTasks())].filter((task) => task.hide !== true).sort(compareTasks);
    if (configured.length === 1 && configuration.get("task.quickOpen.skip")) return configured[0];
    return pickFromLevels(service, quickInput, undefined, configured);
}

async function pickFromLevels(
    service: TaskService,
    quickInput: QuickInputService,
    type: string | undefined,
    configured?: readonly ITask[],
): Promise<ITask | undefined> {
    let level: string | undefined = type;
    for (;;) {
        const entry =
            level === undefined
                ? await pick(quickInput, await firstLevel(service, configured))
                : await pick(quickInput, await secondLevel(service, level));
        if (entry === undefined) return undefined;
        if (entry.task !== undefined) return entry.task;
        if (entry.goBack === true) level = undefined;
        else if (entry.showAll === true) level = SHOW_ALL_TASKS;
        else if (entry.type !== undefined) level = entry.type;
        else return undefined;
    }
}

async function pick(
    quickInput: QuickInputService,
    items: readonly IRunTaskEntry[],
): Promise<IRunTaskEntry | undefined> {
    return (await quickInput.quickPick({ placeholder: RUN_TASK_PLACEHOLDER, items })) as IRunTaskEntry | undefined;
}

/** Первый уровень (`getTopLevelEntries`): configured, затем типы и «Show All Tasks...». */
async function firstLevel(service: TaskService, configured?: readonly ITask[]): Promise<IRunTaskEntry[]> {
    const tasks =
        configured ?? [...(await service.getWorkspaceTasks())].filter((task) => task.hide !== true).sort(compareTasks);
    const entries: IRunTaskEntry[] = withGroupLabel(service.taskEntries(tasks), "configured");
    const types = service.taskTypes();
    if (types.length > 0) {
        const typeEntries: IRunTaskEntry[] = types.map((type) => ({
            label: renderCodicons(`$(folder) ${type}`),
            type,
        }));
        entries.push(...withGroupLabel(typeEntries, "contributed"), { label: SHOW_ALL_TASKS, showAll: true });
    }
    // У эталона здесь «Configure a Task» — его у нас нет (tasks.json Diode только читает).
    if (entries.length === 0) entries.push({ label: "No tasks found" });
    return entries;
}

/** Второй уровень (`doPickerSecondLevel`): задачи типа и «Go back ↩» либо все задачи. */
async function secondLevel(service: TaskService, type: string): Promise<IRunTaskEntry[]> {
    if (type === SHOW_ALL_TASKS) {
        return service.taskEntries((await service.tasks()).filter((task) => task.hide !== true).sort(compareTasks));
    }
    const tasks = (await service.tasks({ type })).filter((task) => task.hide !== true).sort(compareTasks);
    if (tasks.length === 0) return [{ label: `No ${type} tasks found. ${GO_BACK}`, goBack: true }];
    return [...service.taskEntries(tasks), { label: GO_BACK, goBack: true }];
}
