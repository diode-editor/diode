// Configure Task (`_runConfigureTasks` эталона): пикер задач — свои задачи
// tasks.json и задачи провайдеров — и строка «Create tasks.json file from
// template» / «Open tasks.json file», пока своих задач нет. Своя задача —
// открыть tasks.json на её записи (`openConfig`); задача провайдера —
// дописать в tasks.json её кастомизацию и открыть файл на ней (`customize`);
// строка файла — шаблон (`_openTaskFile`). Правки текста — `tasksJsonEdits.ts`.

import { Uri } from "../../../../base/common/uri.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { type IFileService, IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type QuickInputService,
    QuickInputServiceDIToken,
} from "../../../browser/parts/quickinput/quickInputService.ts";
import { EditorServiceDIToken, type IEditorService } from "../../../services/editor/common/editorService.ts";
import {
    type NotificationService,
    NotificationServiceDIToken,
} from "../../../services/notification/browser/notificationService.ts";
import { compareTasks, isConfiguredTask, type ITask } from "../common/tasks.ts";
import {
    appendTaskEntry,
    applyTaskTemplate,
    customizationEntryOf,
    isWritableTasksJson,
    type ITasksJsonIndentation,
    taskEntryRange,
    tasksJsonHasTasks,
} from "../common/tasksJsonEdits.ts";
import { getTaskTemplates, type ITaskTemplate } from "../common/taskTemplates.ts";

import { type ITaskQuickPickEntry, type TaskService, TaskServiceDIToken } from "./taskService.ts";

export const CONFIGURE_TASK_PLACEHOLDER = "Select a task to configure";
export const CREATE_TASKS_JSON = "Create tasks.json file from template";
export const OPEN_TASKS_JSON = "Open tasks.json file";
export const TASK_TEMPLATE_PLACEHOLDER = "Select a Task Template";

/** Строка пикера: задача или «создать/открыть tasks.json». */
interface IConfigureTaskEntry extends ITaskQuickPickEntry {
    readonly tasksJson?: true;
}

interface IConfigureContext {
    readonly service: TaskService;
    readonly quickInput: QuickInputService;
    readonly configuration: IConfigurationService;
    readonly files: IFileService;
    readonly editors: IEditorService;
    readonly notifications: NotificationService;
}

export async function configureTaskCommand(accessor: ServiceAccessor): Promise<void> {
    const context: IConfigureContext = {
        service: accessor.get(TaskServiceDIToken),
        quickInput: accessor.get(QuickInputServiceDIToken),
        configuration: accessor.get(IConfigurationServiceDIToken),
        files: accessor.get(IFileServiceDIToken),
        editors: accessor.get(EditorServiceDIToken),
        notifications: accessor.get(NotificationServiceDIToken),
    };
    const { service } = context;
    const uri = service.tasksJsonUri();
    const [tasks, text] = await Promise.all([service.groupedTasks(), readText(context.files, uri)]);
    const sorted = [...tasks].sort(compareTasks);
    const entries: IConfigureTaskEntry[] = service.taskEntries(sorted);
    const needsCreateOrOpen = !sorted.some(isConfiguredTask);
    if (needsCreateOrOpen && uri !== undefined) {
        entries.push({ label: text === undefined ? CREATE_TASKS_JSON : OPEN_TASKS_JSON, tasksJson: true });
    }
    // Одна своя задача и ничего больше — сразу к ней, без пикера (как эталон).
    const entry =
        entries.length === 1 && !needsCreateOrOpen
            ? entries[0]
            : ((await context.quickInput.quickPick({ placeholder: CONFIGURE_TASK_PLACEHOLDER, items: entries })) as
                  | IConfigureTaskEntry
                  | undefined);
    if (entry === undefined || uri === undefined) return;
    if (entry.task !== undefined) {
        await (isConfiguredTask(entry.task)
            ? openConfig(context, uri, text, entry.task)
            : customize(context, uri, entry.task));
    } else {
        // Строка без задачи — только «Create/Open tasks.json file».
        await openTaskFile(context, uri);
    }
}

/** Своя задача (или уже кастомизированная): tasks.json на её записи. */
async function openConfig(context: IConfigureContext, uri: Uri, text: string | undefined, task: ITask): Promise<void> {
    // Stryker disable next-line StringLiteral,UnaryOperator: эквивалентный — своя задача прочитана из этого файла, у неё есть и текст, и индекс записи; фоллбэки — для типов
    await openAtEntry(context, uri, text ?? "", task.configIndex ?? -1);
}

/** Задача провайдера: её кастомизация — в конец `tasks`, файл — на ней (`customize` эталона). */
async function customize(context: IConfigureContext, uri: Uri, task: ITask): Promise<void> {
    const text = (await readText(context.files, uri)) ?? "";
    if (!isWritableTasksJson(text)) {
        context.notifications.show({
            severity: "warn",
            message:
                "The current task configuration has errors. Please fix the errors first before customizing a task.",
            modal: false,
            items: [],
        });
        return;
    }
    const appended = appendTaskEntry(text, customizationEntryOf(task), indentationOf(context.configuration));
    if (!(await writeTasksJson(context, uri, appended.text))) return;
    await openAtEntry(context, uri, appended.text, appended.index);
}

/** «Create/Open tasks.json file» (`_openTaskFile`): нет задач — шаблон; затем открыть файл. */
async function openTaskFile(context: IConfigureContext, uri: Uri): Promise<void> {
    const text = await readText(context.files, uri);
    // Битый файл не трогаем — человек увидит его как есть.
    if (text === undefined || (!tasksJsonHasTasks(text) && isWritableTasksJson(text))) {
        const template = (await context.quickInput.quickPick({
            placeholder: TASK_TEMPLATE_PLACEHOLDER,
            items: getTaskTemplates(),
        })) as ITaskTemplate | undefined;
        if (template === undefined) return;
        const next = applyTaskTemplate(text ?? "", template.content, indentationOf(context.configuration));
        if (!(await writeTasksJson(context, uri, next))) return;
    }
    await context.editors.openUri(uri);
}

/**
 * Записать tasks.json (каталог `.diode` — при нужде создать). Открытый с
 * несохранёнными правками файл не перезаписывается — ошибка эталона
 * (`errorTasksConfigurationFileDirty`); чистый открытый перечитывается сразу.
 */
async function writeTasksJson(context: IConfigureContext, uri: Uri, text: string): Promise<boolean> {
    const model = context.editors.textFileModels.get(uri);
    if (model?.isModified === true) {
        context.notifications.show({
            severity: "error",
            message:
                "Unable to write into tasks configuration file because the file has unsaved changes. Please save it first and then try again.",
            modal: false,
            items: [],
        });
        return false;
    }
    const folder = Uri.joinPath(uri, "..");
    if (!(await context.files.exists(folder))) await context.files.createFolder(folder);
    await context.files.writeFile(uri, new TextEncoder().encode(text));
    model?.revertToDisk();
    return true;
}

/** Открыть tasks.json с кареткой в начале записи `tasks[index]` и записью на экране. */
async function openAtEntry(context: IConfigureContext, uri: Uri, text: string, index: number): Promise<void> {
    await context.editors.openUri(uri);
    const range = taskEntryRange(text, index);
    const editor = context.editors.getActiveEditor();
    if (range === undefined || editor?.uri.toString() !== uri.toString()) return;
    const start = positionAt(text, range.start);
    editor.goToPosition(start.line, start.character);
    editor.revealRange({ start, end: positionAt(text, range.end) });
}

function positionAt(text: string, offset: number): { line: number; character: number } {
    const before = text.slice(0, offset);
    const lineStart = before.lastIndexOf("\n") + 1;
    return { line: before.split("\n").length - 1, character: offset - lineStart };
}

function indentationOf(configuration: IConfigurationService): ITasksJsonIndentation {
    return { insertSpaces: configuration.get("editor.insertSpaces"), tabSize: configuration.get("editor.tabSize") };
}

async function readText(files: IFileService, uri: Uri | undefined): Promise<string | undefined> {
    // Stryker disable next-line ConditionalExpression: эквивалентный — readFile(undefined) бросает, и catch ниже даёт тот же undefined; проверка — для типов
    if (uri === undefined) return undefined;
    try {
        return new TextDecoder().decode((await files.readFile(uri)).value);
        // Stryker disable next-line BlockStatement: эквивалентный — пустой catch тоже возвращает undefined
    } catch {
        return undefined;
    }
}
